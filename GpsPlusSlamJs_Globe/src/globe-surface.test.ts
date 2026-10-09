/**
 * Why this test matters: the globe's surface rests on settings a later edit
 * could flip without any visible error on a desktop:
 * - the imagery is the COMMITTED Blue Marble pyramid (local, no network),
 *   in the 4326 layout the pyramid was cut to, textured onto the tiles;
 * - the library's unlit tile material is swapped for a lit one that keeps
 *   each tile's own texture (a shared map, or none, would paint one tile
 *   everywhere, or nothing), so the sun makes a day and a night side;
 * - the lit copies are freed when their tile unloads, and never the
 *   texture, which the overlay owns and releases itself;
 * - (M3) every lit copy carries the surface patch; the three global maps
 *   are loaded from the registry as colour or as data, wrap in longitude,
 *   and reach the shader only through the shared uniforms; and one call
 *   points both the light and the shader at the sun.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  GLOBE_SURFACE,
  createGlobeImagery,
  createGlobeSurface,
  firstLookStep,
  disposeLitMaterials,
  litCopy,
  tileMeshes,
  useLitMaterial,
} from "./globe-surface.js";
import {
  GLOBE_SURFACE_CACHE_KEY,
  applyGlobeSurface,
  createGlobeSurfaceUniforms,
} from "./globe-surface-material.js";
import { GLOBE_SOURCES, type GlobeSource } from "./globe-sources.js";
import { celestialToEcefQuaternion } from "./globe-stars.js";

/**
 * Node has no image loader: a blank texture per map, the calls, and the
 * load and error callbacks, so a test can finish (or fail) each map.
 */
function stubLoader(): {
  loadTexture: (
    source: GlobeSource,
    onLoad: () => void,
    onError: () => void,
  ) => THREE.Texture;
  loaded: GlobeSource[];
  finish: (() => void)[];
  fail: (() => void)[];
} {
  const loaded: GlobeSource[] = [];
  const finish: (() => void)[] = [];
  const fail: (() => void)[] = [];
  return {
    loaded,
    finish,
    fail,
    loadTexture: (source, onLoad, onError) => {
      loaded.push(source);
      finish.push(onLoad);
      fail.push(onError);
      return new THREE.Texture();
    },
  };
}

describe("createGlobeImagery", () => {
  // Why (review 2026-10-03-1835 major 4 with the release): one imagery
  // overlay shared by the globe's tiles and the relief's tiles let a
  // release of one carrier free imagery the other was still composing
  // ("drawImage: the image source is detached", in the phone and planted
  // smokes). Each carrier gets its own overlay of the SAME imagery: same
  // url, projection and levels.
  it("makes a new overlay of the globe's imagery on every call", () => {
    const a = createGlobeImagery();
    const b = createGlobeImagery();
    expect(a).not.toBe(b);
    const sourceOf = (o: unknown) =>
      (
        o as {
          imageSource: { url: string; levels: number; projection: string };
        }
      ).imageSource;
    for (const o of [a, b]) {
      expect(sourceOf(o).url).toBe(GLOBE_SURFACE.imageryUrl);
      expect(sourceOf(o).levels).toBe(GLOBE_SURFACE.levels);
      expect(sourceOf(o).projection).toBe(GLOBE_SURFACE.overlayProjection);
    }
    const globe = createGlobeSurface(stubLoader());
    expect(globe.overlay).not.toBe(a);
    expect(sourceOf(globe.overlay).url).toBe(GLOBE_SURFACE.imageryUrl);
    globe.dispose();
  });
});

describe("createGlobeSurface", () => {
  // Why (review 2026-10-03-1835 minor 10 and nit 3): a page with a
  // relief compiles the band (its own program key); the plain globe does
  // not. The sky fill reads the sun by role: the surface keeps the sun
  // light's radiance (colour x intensity) in a uniform every time the sun
  // is set, so a changed intensity reaches the fill.
  it("compiles the band only when asked, and keeps the sun's radiance for the fill", () => {
    const plain = createGlobeSurface(stubLoader());
    expect(plain.template.customProgramCacheKey()).toBe(
      GLOBE_SURFACE_CACHE_KEY,
    );
    const band = createGlobeSurface(stubLoader(), { band: true });
    expect(band.template.customProgramCacheKey()).toBe(
      `${GLOBE_SURFACE_CACHE_KEY}-band`,
    );
    band.sun.intensity = 3;
    band.sun.color.setRGB(1, 0.5, 0.25);
    band.setSun(new THREE.Vector3(0, 0, 2));
    expect(band.surfaceUniforms.uSunRadiance.value.toArray()).toEqual([
      3, 1.5, 0.75,
    ]);
    plain.dispose();
    band.dispose();
  });

  // The phone's memory: the tiles' cache is capped (about 90 level-3 tiles
  // with mips are ~31 MB, plan §7.4), and the library unloads past it.
  it("caps the tile cache at the budget", () => {
    const globe = createGlobeSurface(stubLoader());
    expect(globe.tiles.lruCache.maxBytesSize).toBe(GLOBE_SURFACE.cacheBytes);
    expect(GLOBE_SURFACE.cacheBytes).toBe(64 * 1024 * 1024);
    // The library evicts only down to its FLOOR (default 0.3 GB): a floor
    // above the cap means that once nothing is pending the cache never
    // shrinks back under the cap (LRUCache.unloadUnusedContent).
    expect(globe.tiles.lruCache.minBytesSize).toBe(
      GLOBE_SURFACE.cacheFloorBytes,
    );
    expect(GLOBE_SURFACE.cacheFloorBytes).toBe(48 * 1024 * 1024);
    expect(GLOBE_SURFACE.cacheFloorBytes).toBeLessThan(
      GLOBE_SURFACE.cacheBytes,
    );
    globe.dispose();
  });

  it("textures the ellipsoid from the committed 4326 Blue Marble pyramid", () => {
    const globe = createGlobeSurface(stubLoader());
    const plugin = globe.plugin;
    expect(plugin.projection).toBe("ellipsoid");
    // The overlay resolves its scheme only when it initialises, so the
    // options passed are what is pinned.
    expect(globe.options.overlayProjection).toBe("EPSG:4326");
    expect(globe.options.applyOverlayTexture).toBe(true);
    expect(GLOBE_SURFACE.imageryUrl).toBe(
      "/globe-assets/blue-marble-4326/{z}/{x}/{y}.webp",
    );
    // Levels 0-5 are committed (level 4: DEC-FB2-4; level 5: round-4
    // plan 2026-09-28-2105 DEC-GL4-3): six levels.
    expect(globe.options.levels).toBe(6);
    expect(plugin.overlay).toBe(globe.overlay);
    // The plugin has no name, so it is found in the renderer's own list.
    const registered = (globe.tiles as unknown as { plugins: object[] })
      .plugins;
    expect(registered).toContain(plugin);
    globe.dispose();
  });

  it("starts with no models and no tile errors, and adds its group to nothing", () => {
    const globe = createGlobeSurface(stubLoader());
    expect(globe.state()).toEqual({
      models: 0,
      tileErrors: 0,
      cachedBytes: 0,
      pendingTiles: 0,
      loadedTiles: 0,
      refusedTiles: 0,
      mapsLoaded: 0,
      mapErrors: 0,
      mapsTotal: 2,
      firstLookReady: false,
    });
    // The credits line reads this: every source drawn is the registry's.
    expect(globe.activeSources()).toEqual(GLOBE_SOURCES.map((s) => s.id));
    expect(globe.group.parent).toBeNull();
    globe.dispose();
  });

  it("loads the two global maps from the registry, as colour or data, wrapping in longitude", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    const equirect = GLOBE_SOURCES.filter((s) => s.kind === "equirect");
    expect(loader.loaded.filter((s) => s.kind === "equirect")).toEqual(
      equirect,
    );
    const u = globe.surfaceUniforms;
    const bySource = {
      "black-marble": u.uNight.value,
      clouds: u.uClouds.value,
    } as const;
    for (const source of equirect) {
      const texture = bySource[source.id as keyof typeof bySource];
      expect(texture.colorSpace).toBe(
        source.colorSpace === "srgb"
          ? THREE.SRGBColorSpace
          : THREE.NoColorSpace,
      );
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    }
    // The clouds are read as numbers (coverage).
    expect(u.uClouds.value.colorSpace).toBe(THREE.NoColorSpace);
    expect(u.uNight.value.colorSpace).toBe(THREE.SRGBColorSpace);
    // The grey cloud map goes to the GPU as one channel (round-3 plan
    // 2026-10-08-2345 M1): at 4096 x 2048 that is 8 MB, not 32, on a phone.
    expect(u.uClouds.value.format).toBe(THREE.RedFormat);
    expect(u.uNight.value.format).toBe(THREE.RGBAFormat);
    globe.dispose();
  });

  // Why (round-5 F1a, DEC-GL5-9): the relief carrier's tiles must wear the
  // SAME look and read the SAME uniforms as the globe's own (one sun, one
  // set of maps), so the globe hands out the template it patched.
  it("hands out the patched template its tiles are lit copies of", () => {
    const globe = createGlobeSurface(stubLoader());
    expect(globe.template).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(globe.template.roughness).toBe(0.9);
    expect(globe.template.customProgramCacheKey()).not.toBe(
      new THREE.MeshStandardMaterial().customProgramCacheKey(),
    );
    globe.dispose();
  });

  // Why (round-2 plan 2026-10-07-2350 DEC-FR2-6; the owner: "the globe is
  // plain blue for a second before its texture loads"): until a tile's
  // imagery arrives the sphere under the sky was untextured (measured: 7 s
  // of one blue in a smoke). The pyramid's level 0, the whole Earth in two
  // tiles, loads with the global maps, long before the tile renderer asks.
  it("loads the imagery's level 0 as the first look, ready once both halves are in", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    const u = globe.surfaceUniforms;
    const paths = loader.loaded.map((s) => s.path);
    expect(paths).toContain("/globe-assets/blue-marble-4326/0/0/0.webp");
    expect(paths).toContain("/globe-assets/blue-marble-4326/0/1/0.webp");
    expect(u.uDayWest.value.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(u.uDayEast.value.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(u.uDayReady.value).toBe(0);
    const west = paths.indexOf("/globe-assets/blue-marble-4326/0/0/0.webp");
    const east = paths.indexOf("/globe-assets/blue-marble-4326/0/1/0.webp");
    loader.finish[west]!();
    expect(u.uDayReady.value).toBe(0);
    loader.finish[east]!();
    expect(u.uDayReady.value).toBe(1);
    // Ready to show once the cloud map is in too (round-3 plan M1).
    expect(globe.state().firstLookReady).toBe(false);
    loader.finish[loader.loaded.findIndex((s) => s.id === "clouds")]!();
    expect(globe.state().firstLookReady).toBe(true);
    // Not counted with the global maps: the loading label is about those.
    expect(globe.state().mapsTotal).toBe(2);
    globe.dispose();
  });

  // Why (DEC-FR2-6, measured in the browser): the tile renderer draws a
  // tile only once its imagery is in, so before that there is no sphere at
  // all, only the atmosphere's veil over black. The first look is a sphere
  // of its own, a fraction under the ellipsoid in the tiles' frame, in the
  // surface's own material without a map (so it shows the level 0, lit and
  // clouded as the tiles are), drawn until the globe can draw its view.
  it("draws the first look on a sphere of its own until the globe can draw its view", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    loader.finish[loader.loaded.findIndex((s) => s.id === "clouds")]!();
    const look = globe.firstLook;
    expect(look.parent?.parent).toBe(globe.group);
    // Hidden until an update decides (R4/R5 milestone review: a page that
    // never calls update, the terrain lab, drew it under its relief, where
    // its crack check counts the background as a crack).
    expect(look.visible).toBe(false);
    // A camera high up (the first look ends for good below 2,000 km).
    const highCamera = new THREE.PerspectiveCamera();
    highCamera.position.set(30_000_000, 0, 0);
    // Shown only once its images are in (before, a plain white ball).
    globe.update(highCamera, {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(2, 2),
    } as unknown as THREE.WebGLRenderer);
    expect(look.visible).toBe(false);
    globe.surfaceUniforms.uDayReady.value = 1;
    globe.update(highCamera, {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(2, 2),
    } as unknown as THREE.WebGLRenderer);
    expect(look.visible).toBe(true);
    const material = look.material as THREE.MeshStandardMaterial;
    expect(material.map).toBeNull();
    expect(material.customProgramCacheKey()).toBe(
      globe.template.customProgramCacheKey(),
    );
    // A fraction under the ellipsoid: the tiles cover it wherever drawn.
    const r = globe.tiles.ellipsoid.radius;
    expect(look.scale.x).toBeLessThan(r.x);
    expect(look.scale.x).toBeGreaterThan(r.x * 0.995);
    expect(look.scale.z / look.scale.x).toBeCloseTo(r.z / r.x, 9);
    globe.dispose();
  });

  // Why (round-3 plan M1, the full browser run 2026-10-09): the first look
  // shows the Earth as the tiles will, clouds included. The 2,048 map used
  // to arrive with the two halves; the 4,096 map (1.25 MB, decoded off the
  // thread) arrived after them, so the first look at Bern was cloudless and
  // the clouds popped in (centre 49,84,106 against 180,211,250 once the
  // tiles drew). It now waits for the cloud map too; a cloud map that fails
  // does not hold it back (a failure keeps the plain look).
  it("shows the first look only once the cloud map is in too, or has failed", () => {
    const highCamera = new THREE.PerspectiveCamera();
    highCamera.position.set(30_000_000, 0, 0);
    const renderer = {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(2, 2),
    } as unknown as THREE.WebGLRenderer;
    for (const ending of ["finish", "fail"] as const) {
      const loader = stubLoader();
      const globe = createGlobeSurface(loader);
      const at = (path: string) =>
        loader.loaded.findIndex((s) => s.path === path);
      loader.finish[at("/globe-assets/blue-marble-4326/0/0/0.webp")]!();
      loader.finish[at("/globe-assets/blue-marble-4326/0/1/0.webp")]!();
      globe.update(highCamera, renderer);
      expect(globe.firstLook.visible, ending).toBe(false);
      expect(globe.state().firstLookReady, ending).toBe(false);
      loader[ending][loader.loaded.findIndex((s) => s.id === "clouds")]!();
      globe.update(highCamera, renderer);
      expect(globe.firstLook.visible, ending).toBe(true);
      expect(globe.state().firstLookReady, ending).toBe(true);
      globe.dispose();
    }
  });

  // Why (the full browser run, 2026-10-08): the first look is for the start
  // only. Shown again whenever the globe could not draw its view (zooming out
  // of the band), it filled the very holes the handover's positive control
  // must see. Once the globe has drawn its whole view, it is done for good.
  it("shows the first look only before the globe has first drawn its whole view", () => {
    const high = GLOBE_SURFACE.firstLookFloorM * 2;
    const low = GLOBE_SURFACE.firstLookFloorM / 2;
    const step = (
      done: boolean,
      imagesIn: boolean,
      drawn: boolean,
      h: number,
    ) => firstLookStep(done, imagesIn, drawn, h);
    expect(step(false, false, false, high)).toEqual({
      done: false,
      shown: false,
    });
    expect(step(false, true, false, high)).toEqual({
      done: false,
      shown: true,
    });
    expect(step(false, true, true, high)).toEqual({ done: true, shown: false });
    // Done stays done, whatever the globe does later.
    expect(step(true, true, false, high)).toEqual({ done: true, shown: false });
    // And it ends for good once the camera goes low (the band and the relief
    // take the pixels there; kept on, it drew a whole sphere under the relief
    // every frame: a city dive recorded 9 frames, not more than 10, and the
    // stencil fill's cost smoke ran out of time).
    expect(step(false, true, false, low)).toEqual({ done: true, shown: false });
    // An altitude not known (a camera still at the Earth's centre on the
    // first frame reads 0) decides nothing.
    for (const h of [0, -1, Number.NaN]) {
      expect(step(false, true, false, h), String(h)).toEqual({
        done: false,
        shown: true,
      });
    }
  });

  it("frees the first look's two images on dispose", () => {
    const globe = createGlobeSurface(stubLoader());
    const west = vi.spyOn(globe.surfaceUniforms.uDayWest.value, "dispose");
    const east = vi.spyOn(globe.surfaceUniforms.uDayEast.value, "dispose");
    globe.dispose();
    expect(west).toHaveBeenCalled();
    expect(east).toHaveBeenCalled();
  });

  it("keeps the plain look if a half of the first look fails", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    const paths = loader.loaded.map((s) => s.path);
    loader.finish[
      paths.indexOf("/globe-assets/blue-marble-4326/0/0/0.webp")
    ]!();
    loader.fail[paths.indexOf("/globe-assets/blue-marble-4326/0/1/0.webp")]!();
    expect(globe.surfaceUniforms.uDayReady.value).toBe(0);
    expect(globe.state().mapErrors).toBe(0);
    globe.dispose();
  });

  // The loading label and the tests wait on these: a map still downloading
  // must not read as "loaded", and a failed one must reach the error box.
  it("counts the global maps as they load and as they fail", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    loader.finish[0]!();
    loader.fail[1]!();
    const s = globe.state();
    expect([s.mapsLoaded, s.mapErrors, s.mapsTotal]).toEqual([1, 1, 2]);
    globe.dispose();
  });

  // Phase 5 rotates tiles.group (ReorientationPlugin): the sun is an ECEF
  // direction, so the light must turn with the tiles, or the terminator and
  // the glint would be drawn for the wrong sun.
  it("turns the light with the tile group, the uniform staying in ECEF", () => {
    const globe = createGlobeSurface(stubLoader());
    globe.tiles.group.rotation.set(0.3, -1.1, 0.7);
    globe.tiles.group.position.set(10, 20, 30);
    globe.tiles.group.updateMatrix();
    const ecef = new THREE.Vector3(0.2, -0.5, 0.84).normalize();
    globe.setSun(ecef);
    const expected = ecef
      .clone()
      .applyQuaternion(globe.tiles.group.quaternion)
      .normalize();
    const toLight = globe.sun.position
      .clone()
      .sub(globe.sun.target.position)
      .normalize();
    expect(toLight.distanceTo(expected)).toBeLessThan(1e-12);
    expect(globe.sun.target.parent).toBe(globe.group);
    expect(globe.surfaceUniforms.uSunEcef.value.distanceTo(ecef)).toBeLessThan(
      1e-12,
    );
    globe.dispose();
  });

  // Why (round-6 plan 2026-10-04-1050 G6-2): the clouds move off the ground
  // onto their own shell only as far as the page asks (the relief's share of
  // the band, so the orbit keeps the approved painted look); every other
  // page keeps them painted, as before. The shell sits in the tiles' ECEF
  // frame wherever the tiles are placed, and its share takes exactly that
  // much paint out of the ground's colour.
  it("splits the clouds between the paint and the shell by a share, the shell in the tiles' frame", () => {
    const globe = createGlobeSurface(stubLoader());
    const u = globe.surfaceUniforms;
    expect(globe.cloudShell.mesh.visible).toBe(false);
    expect(u.uCloudInSurface.value).toBe(1);
    globe.setCloudShellShare(0.25);
    expect(globe.cloudShell.mesh.visible).toBe(true);
    expect(globe.cloudShell.share()).toBe(0.25);
    expect(u.uCloudInSurface.value).toBe(0.75);
    globe.setCloudShellShare(1);
    expect(u.uCloudInSurface.value).toBe(0);
    expect(() => globe.setCloudShellShare(1.5)).toThrow(RangeError);
    globe.cloudShell.setHeightM(9_000);
    globe.tiles.group.rotation.set(0.3, -1.1, 0.7);
    globe.tiles.group.position.set(10, 20, 30);
    globe.tiles.group.updateMatrix();
    globe.setSun(new THREE.Vector3(1, 0, 0));
    globe.group.updateMatrixWorld(true);
    // A point on the shell's equator (local x) lands where the tiles put the
    // ECEF point (a + h, 0, 0).
    const shellPoint = new THREE.Vector3(1, 0, 0).applyMatrix4(
      globe.cloudShell.mesh.matrixWorld,
    );
    const tilesPoint = new THREE.Vector3(6_378_137 + 9_000, 0, 0).applyMatrix4(
      globe.tiles.group.matrixWorld,
    );
    expect(shellPoint.distanceTo(tilesPoint)).toBeLessThan(1e-3);
    globe.setCloudShellShare(0);
    expect(u.uCloudInSurface.value).toBe(1);
    expect(globe.cloudShell.mesh.visible).toBe(false);
    globe.dispose();
  });

  // Why (round-2 plan 2026-10-07-2350 DEC-FR2-5): the flat cloud layer
  // fades with altitude; both its forms (the paint and the shell) and the
  // water's cloud mask fade together, never the global cloud opacity (the
  // volume reads that too).
  it("fades both of the clouds' forms, and the glint's cloud mask, by a flat share", () => {
    const globe = createGlobeSurface(stubLoader());
    const u = globe.surfaceUniforms;
    expect(u.uCloudFlat.value).toBe(1);
    globe.setCloudShellShare(0.25, 0.5);
    expect(globe.cloudShell.share()).toBe(0.125);
    expect(u.uCloudInSurface.value).toBe(0.375);
    expect(u.uCloudFlat.value).toBe(0.5);
    const opacity = u.uCloudOpacity.value;
    globe.setCloudShellShare(0.25);
    expect(u.uCloudFlat.value).toBe(1);
    expect(u.uCloudOpacity.value).toBe(opacity);
    expect(() => globe.setCloudShellShare(0.25, 1.5)).toThrow(RangeError);
    globe.dispose();
  });

  // Stream F review, finding 4: the stars' frame left out the tile group's
  // placement, which the sun's light includes, so once phase 5 re-centres
  // the tiles the stars would wheel against the sun. The celestial rotation
  // must carry the sun's celestial direction onto the light's direction in
  // the world, whatever the tiles' and the group's placements.
  it("turns the celestial frame into the world exactly as the sun's light is turned", () => {
    const globe = createGlobeSurface(stubLoader());
    const outer = new THREE.Group();
    outer.add(globe.group);
    outer.rotation.set(0.3, -0.7, 1.1);
    globe.group.rotation.set(-0.2, 0.5, 0.1);
    globe.tiles.group.rotation.set(-0.4, 0.2, 0.9);
    globe.tiles.group.updateMatrix();
    outer.updateMatrixWorld(true);
    const theta = 1.234;
    const sunEcef = new THREE.Vector3(0.3, -0.8, 0.5).normalize();
    globe.setSun(sunEcef);
    const lightWorld = globe.sun.position
      .clone()
      .sub(globe.sun.target.position)
      .transformDirection(globe.group.matrixWorld);
    // The sun's celestial direction: its ECEF direction turned back by the
    // sidereal angle.
    const sunCelestial = sunEcef
      .clone()
      .applyQuaternion(celestialToEcefQuaternion(theta).invert());
    const world = sunCelestial.applyQuaternion(globe.celestialToWorld(theta));
    expect(world.distanceTo(lightWorld)).toBeLessThan(1e-9);
    globe.dispose();
  });

  // Review 2026-10-01, m4: the cloud shading compares the clouds' screen
  // gradient with the sun's direction on screen, via the VIEW matrix, which
  // maps WORLD directions; the ECEF sun is only the world's while every
  // group above the tiles is unturned. The surface keeps a world-space sun,
  // turned exactly as the light is, on setSun and on every update.
  it("keeps a world-space sun turned as the light is, for the cloud shading", () => {
    const globe = createGlobeSurface(stubLoader());
    vi.spyOn(globe.tiles, "update").mockImplementation(() => {});
    const outer = new THREE.Group();
    outer.add(globe.group);
    outer.rotation.set(0.3, -0.7, 1.1);
    globe.group.rotation.set(-0.2, 0.5, 0.1);
    globe.tiles.group.rotation.set(-0.4, 0.2, 0.9);
    globe.tiles.group.updateMatrix();
    outer.updateMatrixWorld(true);
    const sunEcef = new THREE.Vector3(0.3, -0.8, 0.5).normalize();
    globe.setSun(sunEcef);
    const expected = sunEcef
      .clone()
      .transformDirection(globe.tiles.group.matrixWorld);
    const u = globe.surfaceUniforms.uSunWorld.value;
    expect(u.distanceTo(expected)).toBeLessThan(1e-9);
    // A group moved after setSun is followed on the next update.
    outer.rotation.set(1.0, 0.2, -0.4);
    outer.updateMatrixWorld(true);
    const renderer = {
      getSize: (v: THREE.Vector2) => v.set(100, 100),
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(100, 100),
    } as unknown as THREE.WebGLRenderer;
    globe.update(new THREE.PerspectiveCamera(), renderer);
    const moved = sunEcef
      .clone()
      .transformDirection(globe.tiles.group.matrixWorld);
    expect(u.distanceTo(moved)).toBeLessThan(1e-9);
    globe.dispose();
  });

  // The library's setResolutionFromRenderer reads renderer.getSize(), in
  // CSS pixels: at DPR 2 the tiles refined to 2 device pixels of error, one
  // level coarser than the pyramid was sized for (plan §7.2), exactly on the
  // phones the owner judges sharpness on. Refinement uses DEVICE pixels.
  it("refines to the drawing buffer's pixels, not CSS pixels", () => {
    const globe = createGlobeSurface(stubLoader());
    const setResolution = vi.spyOn(globe.tiles, "setResolution");
    vi.spyOn(globe.tiles, "update").mockImplementation(() => {});
    const camera = new THREE.PerspectiveCamera();
    const renderer = {
      getSize: (v: THREE.Vector2) => v.set(412, 915),
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(824, 1830),
    } as unknown as THREE.WebGLRenderer;
    globe.update(camera, renderer);
    expect(setResolution).toHaveBeenCalledWith(camera, 824, 1830);
    globe.dispose();
  });

  it("points the light and the shader at the same sun, with one call", () => {
    const globe = createGlobeSurface(stubLoader());
    expect(globe.sun.parent).toBe(globe.group);
    // Beside the tiles, not under them: the tile group never refreshes a
    // child's world matrix, so a light there would light nothing.
    expect(globe.sun.parent).not.toBe(globe.tiles.group);
    expect(globe.tiles.group.parent).toBe(globe.group);
    // The owner's sun intensity (round-4 plan DEC-GL4-1), not phase 1's π.
    expect(GLOBE_SURFACE.sunIntensity).toBe(5);
    expect(globe.sun.intensity).toBe(GLOBE_SURFACE.sunIntensity);
    globe.setSun(new THREE.Vector3(0, 3, 4));
    const toLight = globe.sun.position
      .clone()
      .sub(globe.sun.target.position)
      .normalize();
    expect(toLight.distanceTo(new THREE.Vector3(0, 0.6, 0.8))).toBeLessThan(
      1e-12,
    );
    expect(
      globe.surfaceUniforms.uSunEcef.value.distanceTo(toLight),
    ).toBeLessThan(1e-12);
    for (const bad of [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Number.NaN, 0, 1),
    ]) {
      expect(() => globe.setSun(bad)).toThrow(RangeError);
    }
    globe.dispose();
  });
});

function tileModel(maps: (THREE.Texture | null)[]): THREE.Group {
  const model = new THREE.Group();
  const nested = new THREE.Group();
  maps.forEach((map, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ map }),
    );
    (i % 2 ? nested : model).add(mesh);
  });
  model.add(nested, new THREE.Object3D());
  return model;
}

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

describe("litCopy and tileMeshes (shared with the relief carrier)", () => {
  // Why (review 2026-10-02-1235 minor 8, DEC-H3): the globe's tiles and the relief's
  // both need "a clone of the template with its compile hooks" and "every
  // mesh under a tile model"; one implementation each, used by both.
  it("clones the template with its compile hooks and program key", () => {
    const template = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    const hook = () => {};
    template.onBeforeCompile = hook;
    template.customProgramCacheKey = () => "k";
    const lit = litCopy(template);
    expect(lit).not.toBe(template);
    expect(lit.roughness).toBe(0.7);
    expect(lit.onBeforeCompile).toBe(hook);
    expect(lit.customProgramCacheKey()).toBe("k");
  });

  it("finds every mesh under a model", () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh();
    const b = new THREE.Mesh();
    const inner = new THREE.Group();
    inner.add(b);
    root.add(a, inner, new THREE.Object3D());
    expect(tileMeshes(root)).toEqual([a, b]);
  });
});

describe("useLitMaterial", () => {
  it("gives every mesh a lit copy that keeps its own texture", () => {
    const maps = [new THREE.Texture(), new THREE.Texture(), null];
    const model = tileModel(maps);
    const before = meshes(model).map(
      (m) => (m.material as THREE.MeshBasicMaterial).map,
    );
    const template = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const owned = new WeakSet<THREE.Material>();
    useLitMaterial(model, template, owned);
    meshes(model).forEach((mesh, i) => {
      const lit = mesh.material as THREE.MeshStandardMaterial;
      expect(lit).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(lit).not.toBe(template);
      expect(lit.roughness).toBe(0.9);
      expect(lit.map).toBe(before[i]);
      expect(owned.has(lit)).toBe(true);
    });
  });

  // Material.copy does not carry onBeforeCompile: a clone without it would
  // draw the plain surface, with no lights, glint or clouds, and no error.
  it("gives every copy the template's surface patch and program key", () => {
    const template = new THREE.MeshStandardMaterial();
    applyGlobeSurface(
      template,
      createGlobeSurfaceUniforms({
        night: new THREE.Texture(),
        clouds: new THREE.Texture(),
      }),
    );
    const model = tileModel([new THREE.Texture(), null]);
    useLitMaterial(model, template, new WeakSet());
    for (const mesh of meshes(model)) {
      const lit = mesh.material as THREE.MeshStandardMaterial;
      expect(lit.onBeforeCompile).toBe(template.onBeforeCompile);
      expect(lit.customProgramCacheKey()).toBe(GLOBE_SURFACE_CACHE_KEY);
    }
  });
});

describe("disposeLitMaterials", () => {
  it("frees the lit copies it made, never their textures", () => {
    const map = new THREE.Texture();
    const freeMap = vi.spyOn(map, "dispose");
    const model = tileModel([map, map]);
    const owned = new WeakSet<THREE.Material>();
    useLitMaterial(model, new THREE.MeshStandardMaterial(), owned);
    const lit = meshes(model).map((m) => m.material as THREE.Material);
    const frees = lit.map((m) => vi.spyOn(m, "dispose"));
    disposeLitMaterials(model, owned);
    for (const free of frees) expect(free).toHaveBeenCalledTimes(1);
    expect(freeMap).not.toHaveBeenCalled();
  });

  // Why (review 2026-10-03-2017 H4): the surface hands its retired lit
  // copies to a retirer that keeps the latest alive, so the globe's
  // program survives a release of all its tiles.
  it("hands the lit copies to a retirer when given one", () => {
    const model = tileModel([new THREE.Texture(), new THREE.Texture()]);
    const owned = new WeakSet<THREE.Material>();
    useLitMaterial(model, new THREE.MeshStandardMaterial(), owned);
    const lit = meshes(model).map((m) => m.material as THREE.Material);
    const frees = lit.map((m) => vi.spyOn(m, "dispose"));
    const retired: THREE.Material[] = [];
    disposeLitMaterials(model, owned, (m) => retired.push(m));
    expect(retired).toEqual(lit);
    for (const free of frees) expect(free).not.toHaveBeenCalled();
  });

  it("leaves materials it did not make alone", () => {
    const model = tileModel([null]);
    const foreign = meshes(model)[0]!.material as THREE.Material;
    const free = vi.spyOn(foreign, "dispose");
    disposeLitMaterials(model, new WeakSet());
    expect(free).not.toHaveBeenCalled();
  });
});
