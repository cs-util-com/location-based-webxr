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
  createGlobeSurface,
  disposeLitMaterials,
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

describe("createGlobeSurface", () => {
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
      "/globe-assets/blue-marble-4326/{z}/{x}/{y}.jpg",
    );
    // Levels 0-4 are committed (level 4: DEC-FB2-4): five levels.
    expect(globe.options.levels).toBe(5);
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
      mapsTotal: 3,
    });
    // The credits line reads this: every source drawn is the registry's.
    expect(globe.activeSources()).toEqual(GLOBE_SOURCES.map((s) => s.id));
    expect(globe.group.parent).toBeNull();
    globe.dispose();
  });

  it("loads the three global maps from the registry, as colour or data, wrapping in longitude", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    const equirect = GLOBE_SOURCES.filter((s) => s.kind === "equirect");
    expect(loader.loaded).toEqual(equirect);
    const u = globe.surfaceUniforms;
    const bySource = {
      "black-marble": u.uNight.value,
      "water-mask": u.uWater.value,
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
    // The clouds and the water are read as numbers (coverage, a mask).
    expect(u.uClouds.value.colorSpace).toBe(THREE.NoColorSpace);
    expect(u.uNight.value.colorSpace).toBe(THREE.SRGBColorSpace);
    globe.dispose();
  });

  // The loading label and the tests wait on these: a map still downloading
  // must not read as "loaded", and a failed one must reach the error box.
  it("counts the global maps as they load and as they fail", () => {
    const loader = stubLoader();
    const globe = createGlobeSurface(loader);
    loader.finish[0]!();
    loader.finish[2]!();
    loader.fail[1]!();
    const s = globe.state();
    expect([s.mapsLoaded, s.mapErrors, s.mapsTotal]).toEqual([2, 1, 3]);
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
    expect(globe.sun.intensity).toBeCloseTo(Math.PI, 12);
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
        water: new THREE.Texture(),
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

  it("leaves materials it did not make alone", () => {
    const model = tileModel([null]);
    const foreign = meshes(model)[0]!.material as THREE.Material;
    const free = vi.spyOn(foreign, "dispose");
    disposeLitMaterials(model, new WeakSet());
    expect(free).not.toHaveBeenCalled();
  });
});
