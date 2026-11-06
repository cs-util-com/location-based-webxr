/**
 * The heavy clouds for an app's globe view, over recording fakes of the
 * slab, the shell and the scene depth.
 *
 * Why this file matters: the globe lab draws its clouds through a careful
 * order (who draws them by altitude, the cloud shell's share from the
 * relief, the ground's shadow, the volumes' update, the relief's depth,
 * the drawing) and an app that wires them itself gets that order wrong or
 * leaves the clouds out (the 3D editor on the globe had none). These tests
 * pin the lab's settings with the heavy clouds on, what each frame tells
 * the parts at heights from orbit to the ground, the switch off, and every
 * part freed once.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it, vi } from "vitest";

import type { CloudBakeWorker } from "./globe-cloud-bake-worker-core.js";
import { GLOBE_QUALITIES } from "./globe-quality.js";

import {
  CLOUD_HIGH_LAYER,
  CLOUD_SHELL_VOLUME,
} from "./globe-cloud-shell-volume.js";
import {
  createCloudsParts,
  createGlobeViewClouds,
  GLOBE_VIEW_CLOUDS,
  globeViewClouds,
  type CloudsParts,
  type CloudsView,
} from "./globe-view-clouds.js";

/** A view whose camera stands `altitudeM` over the equator at 0 deg. */
function fakeView(altitudeM: number, framed = true) {
  let heightM = 0;
  const camera = new THREE.PerspectiveCamera();
  const view = {
    renderer: {} as THREE.WebGLRenderer,
    camera,
    globe: {
      sun: { intensity: 5 },
      cloudShell: {
        heightM: () => heightM,
        setHeightM(next: number) {
          heightM = next;
        },
        setHole() {},
      },
      surfaceUniforms: {
        uCloudShadow: { value: 0 },
        uSunEcef: { value: new THREE.Vector3(1, 0, 0) },
      },
      tiles: { ellipsoid: WGS84_ELLIPSOID, group: new THREE.Group() },
    },
    ecefCamera: () => ({
      position: new THREE.Vector3(WGS84_ELLIPSOID.radius.x + altitudeM, 0, 0),
    }),
    frameTarget: () => (framed ? { lat: 0, lng: 0 } : null),
  };
  // A fake: only what the clouds read and write of the view.
  return view as unknown as CloudsView & typeof view;
}

/** Recording fakes of the three parts. */
function fakeParts() {
  const log: string[] = [];
  const slabFrames: { radiusKm: number; altitudeKm: number }[] = [];
  const shellFrames: { altitudeKm: number; shadow: number }[] = [];
  const patched: unknown[] = [];
  const depthDrawn: unknown[] = [];
  const depthExtra: unknown[] = [];
  const slabExtra: unknown[] = [];
  const parts = {
    sceneDepth: {
      beginFrame: () => log.push("depth begin"),
      render: (_camera: THREE.Camera, relief: unknown, extra: unknown) => {
        log.push("depth");
        depthDrawn.push(relief);
        depthExtra.push(extra);
      },
      dispose: () => log.push("dispose depth"),
    },
    cloudVolume: {
      setEnabled: (on: boolean) => log.push(`slab ${on ? "on" : "off"}`),
      setShadow() {},
      setNoise() {},
      setFineGain() {},
      update(frame: { radiusKm: number; altitudeKm: number }) {
        slabFrames.push(frame);
        return { share: 1, radiusM: 80_000 };
      },
      render: (_camera: unknown, _relief: unknown, extra: unknown) => {
        log.push("slab");
        slabExtra.push(extra);
        return true;
      },
      texture: new THREE.Texture(),
      patchShadow: (tiles: unknown) => patched.push(tiles),
      state: () => ({ discCentre: null, deckY: 3000, radiusM: 80_000 }),
      dispose: () => log.push("dispose slab"),
    },
    shellVolume: {
      setEnabled: (on: boolean) => log.push(`shell ${on ? "on" : "off"}`),
      setResolution() {},
      update(frame: { altitudeKm: number; shadow: number }) {
        shellFrames.push(frame);
      },
      render: () => log.push("shell"),
      state: () => ({
        drawn: log.filter((l) => l === "shell").length,
        share: 0.5,
        weight: 0.4,
        slabWeight: 0.6,
        enabled: true,
      }),
      dispose: () => log.push("dispose shell"),
    },
  };
  // A fake: only what the clouds call of the three parts.
  return {
    parts: parts as unknown as CloudsParts,
    log,
    slabFrames,
    shellFrames,
    patched,
    depthDrawn,
    depthExtra,
    slabExtra,
  };
}

/** A near pass that records what it is told. */
function fakeNear() {
  const frames: { pixelScale: number; timeS: number; quality: unknown }[] = [];
  const near = {
    ready: false,
    bakes: [] as unknown[],
    disposed: 0,
    setBakes(bakes: unknown) {
      this.bakes.push(bakes);
      this.ready = true;
    },
    render(frame: { pixelScale: number; timeS: number; quality: unknown }) {
      frames.push(frame);
      return true;
    },
    texture: new THREE.Texture(),
    shadowTexture: new THREE.Texture(),
    uv: new THREE.Vector2(1, 1),
    resolution: new THREE.Vector2(10, 10),
    dispose() {
      this.disposed += 1;
    },
  };
  return { near, frames };
}

/** A worker that answers when told to. */
function fakeWorker() {
  return {
    onmessage: null as CloudBakeWorker["onmessage"],
    onerror: null as CloudBakeWorker["onerror"],
    postMessage() {},
    terminate() {},
  };
}

/** Relief tiles as the slab's shadow patches them. */
const reliefTiles = () => ({
  group: new THREE.Group(),
  addEventListener() {},
});

describe("GLOBE_VIEW_CLOUDS", () => {
  // Why: the editor shows the lab's heavy clouds, so its settings are the
  // lab's defaults with the spherical volume, the high layer and the
  // shell's shadow on; a drift here is a different look from the lab's.
  it("is the lab's defaults with the heavy clouds on", () => {
    expect(GLOBE_VIEW_CLOUDS).toMatchObject({
      cloudVolume: 2,
      cloudVolumeKm: 80,
      cloudVolumeCeilingKm: 40,
      cloudVolumeFadeKm: 25,
      cloudVolumeCover: 1,
      cloudShadowFrom: 0,
      cloudNoise: "live",
      cloudFineGain: 0.5,
      cloudShellVolume: 1,
      cloudShellTopKm: CLOUD_SHELL_VOLUME.topKm,
      cloudShellMidKm: 200,
      cloudShellBandKm: CLOUD_SHELL_VOLUME.bandKm,
      cloudShellFields: 3,
      cloudShellCell: CLOUD_SHELL_VOLUME.stations[0].cellScale,
      cloudShellThick: CLOUD_SHELL_VOLUME.stations[0].thicknessScale,
      cloudShellNoise: CLOUD_SHELL_VOLUME.stations[0].noiseShare,
      cloudShellRes: 0.5,
      cloudShellShadow: 0.5,
      cloudFlat: 1,
      cloudFlatTopKm: 5_000,
      cloudFlatWeak: 0.3,
      cloudFlatOutFromKm: 900,
      cloudFlatOutToKm: 700,
      cloudHigh: 1,
      cloudHighKm: CLOUD_HIGH_LAYER.altitudeKm,
      cloudHighCell: CLOUD_HIGH_LAYER.cellScale,
      cloudHighCover: CLOUD_HIGH_LAYER.cover,
      cloudHighShare: CLOUD_HIGH_LAYER.noiseShare,
      cloudShellKm: 3,
      cloudShadow: 0.6,
      cloudShellFlat: 1,
    });
    expect(Object.isFrozen(GLOBE_VIEW_CLOUDS)).toBe(true);
  });
});

describe("createGlobeViewClouds", () => {
  // Why: the clouds are drawn at every height of a flight, the shell from
  // orbit down to the slab, the slab near the ground; each frame the
  // cloud shell sits at the lab's 3 km, takes its share from the page for
  // the flat layer's share, and both volumes are updated. Swept from orbit
  // to the ground.
  it.each([6_000_000, 500_000, 80_000, 10_000, 100])(
    "steps the shell and the slab at %s m with the page's shell share",
    (altitudeM) => {
      const view = fakeView(altitudeM);
      const fakes = fakeParts();
      const clouds = createGlobeViewClouds(view, fakes.parts);
      const flats: number[] = [];
      clouds.step({
        observerKm: altitudeM / 1000,
        shareClouds: (flat) => {
          flats.push(flat);
          return 1;
        },
      });
      expect(view.globe.cloudShell.heightM()).toBe(3000);
      expect(flats).toEqual([clouds.state().flat]);
      expect(clouds.state()).toMatchObject({ on: true, shellOn: true });
      // The shadows this frame, for the page's checks: the shell's own
      // ground shadow and the surface's (the uniform as set).
      const { shellShadow, surfaceShadow } = clouds.state();
      expect(shellShadow).toBeGreaterThanOrEqual(0);
      expect(shellShadow).toBeLessThanOrEqual(1);
      expect(surfaceShadow).toBe(view.globe.surfaceUniforms.uCloudShadow.value);
      expect(fakes.log).toContain("slab on");
      expect(fakes.log).toContain("shell on");
      expect(fakes.slabFrames[0]?.radiusKm).toBe(80);
      expect(fakes.shellFrames[0]?.altitudeKm).toBeCloseTo(altitudeM / 1000, 3);
    },
  );

  // Why: the ground's soft shadow is the shell's, so it follows the share
  // the page gives the shell (none where the globe's surface carries the
  // ground) and, like the lab's, the plan's flat-layer and map shares: it
  // is whole from orbit and gone below about 1,000 km, where the volumes
  // cast their own shadow on the relief instead.
  it.each([
    [6000, 0.5, 0.6],
    [2000, 0.5, 0.6],
    [1000, 0.3, 0.5],
    [500, 0, 0],
    [80, 0, 0],
    [10, 0, 0],
  ])(
    "shades the ground by the shell's share at %d km (%d to %d)",
    (km, low, high) => {
      const view = fakeView(km * 1000);
      const clouds = createGlobeViewClouds(view, fakeParts().parts);
      clouds.step({ observerKm: km, shareClouds: () => 0 });
      expect(view.globe.surfaceUniforms.uCloudShadow.value).toBe(0);
      clouds.step({ observerKm: km, shareClouds: () => 1 });
      const shadow = view.globe.surfaceUniforms.uCloudShadow.value;
      expect(shadow).toBeGreaterThanOrEqual(low);
      expect(shadow).toBeLessThanOrEqual(high);
    },
  );

  // Why: an app tunes how dark the ground (and what stands on it) gets
  // under a cloud: the editor wants about 70 % under a full cloud where
  // the lab keeps its 50 %. One strength sets both shadows, the shell's
  // own near the ground (a full cloud darkens the frame by it there) and
  // the surface's from orbit, so the look holds at every height.
  it.each([0, 0.3, 0.45, 0.6])(
    "takes the page's shadow strength %d for both shadows",
    (strength) => {
      const nearParts = fakeParts();
      createGlobeViewClouds(fakeView(10_000), nearParts.parts, {
        shadow: strength,
      }).step({ observerKm: 10, shareClouds: () => 1 });
      expect(nearParts.shellFrames[0]?.shadow).toBeCloseTo(strength, 9);
      const far = fakeView(6_000_000);
      createGlobeViewClouds(far, fakeParts().parts, { shadow: strength }).step({
        observerKm: 6000,
        shareClouds: () => 1,
      });
      const surface = far.globe.surfaceUniforms.uCloudShadow.value;
      expect(surface).toBeLessThanOrEqual(strength);
      expect(surface).toBeGreaterThanOrEqual(strength * 0.8);
    },
  );

  // Why: without a strength the clouds are the lab's (its shell shadow
  // 0.5 near the ground), and a strength the shader cannot mean is
  // refused at the boundary rather than drawn as a negative shadow.
  it("keeps the lab's shadow without one and refuses one out of 0..1", () => {
    const fakes = fakeParts();
    createGlobeViewClouds(fakeView(10_000), fakes.parts).step({
      observerKm: 10,
      shareClouds: () => 1,
    });
    expect(fakes.shellFrames[0]?.shadow).toBe(
      GLOBE_VIEW_CLOUDS.cloudShellShadow,
    );
    for (const shadow of [-0.1, 1.1, Number.NaN]) {
      expect(() =>
        createGlobeViewClouds(fakeView(10_000), fakeParts().parts, { shadow }),
      ).toThrow(RangeError);
    }
  });

  // Why: with the world in ECEF there is no frame for the shell's law;
  // the shell stays off and the flat layer draws, as in the lab.
  it("keeps the shell off without a frame", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(500_000, false), fakes.parts);
    clouds.step({ observerKm: 500, shareClouds: () => 1 });
    expect(clouds.state().shellOn).toBe(false);
    expect(fakes.log).toContain("shell off");
  });

  // Why: the slab's shadow must reach the relief's tiles before the haze
  // patches them, and the relief is what ends the march; nothing is drawn
  // before a relief is named.
  it("patches the relief's shadow and draws only once it has a relief", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts);
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(fakes.log).not.toContain("slab");
    const tiles = reliefTiles();
    clouds.patch(tiles);
    expect(fakes.patched).toEqual([tiles]);
    clouds.render({ weight: 1 });
    expect(fakes.log.slice(-4)).toEqual([
      "depth begin",
      "depth",
      "slab",
      "shell",
    ]);
    expect(fakes.depthDrawn).toEqual([tiles.group]);
  });

  // Why: an app's city stands on the ground: the clouds' rays must end
  // at its buildings as at the relief, in the depth pass and in the slab's
  // own, and the list is asked each frame (a city shown, then hidden).
  it("draws an app's extra objects into the clouds' depth, asked each frame", () => {
    const fakes = fakeParts();
    const city = new THREE.Group();
    let shown: THREE.Object3D[] = [city];
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts, {
      extra: () => shown,
    });
    clouds.patch(reliefTiles());
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(fakes.depthExtra).toEqual([[city]]);
    expect(fakes.slabExtra).toEqual([[city]]);
    shown = [];
    clouds.render({ weight: 1 });
    expect(fakes.depthExtra.at(-1)).toEqual([]);
    expect(fakes.slabExtra.at(-1)).toEqual([]);
    // Without the option: none.
    const plain = fakeParts();
    const bare = createGlobeViewClouds(fakeView(10_000), plain.parts);
    bare.patch(reliefTiles());
    bare.step({ observerKm: 10, shareClouds: () => 1 });
    bare.render({ weight: 1 });
    expect(plain.depthExtra).toEqual([[]]);
  });

  // Why: the relief's depth costs a pass of its own; it is drawn for the
  // shell's rays only while the ground sky shows (above it the shell's
  // weight on it is 0 and the slab draws it itself when it needs it).
  it("draws the relief's depth only while the ground sky shows", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(500_000), fakes.parts);
    clouds.patch(reliefTiles());
    clouds.step({ observerKm: 500, shareClouds: () => 1 });
    clouds.render({ weight: 0 });
    expect(fakes.log).toContain("depth begin");
    expect(fakes.log).not.toContain("depth");
    expect(fakes.log).toContain("slab");
  });

  // Why: the layer switch: off, the slab and the shell are turned off at
  // the next frame and nothing of them is drawn; on again, they come back.
  // The depth stays: the space pass's veil over the ground ends at it, so
  // the switch must not change the ground's colour below the hand-over.
  it("turns the heavy clouds off and on again", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts);
    clouds.patch(reliefTiles());
    clouds.setOn(false);
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(clouds.state()).toMatchObject({ on: false, shellOn: false });
    expect(fakes.log).toContain("slab off");
    expect(fakes.log).toContain("shell off");
    expect(fakes.log).toContain("depth");
    expect(fakes.log).not.toContain("slab");
    clouds.setOn(true);
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(clouds.state().on).toBe(true);
    expect(fakes.log).toContain("slab");
  });

  // Why: the air ends its veil at this same depth, so one pass serves both.
  it("hands out the depth it draws", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts);
    expect(clouds.sceneDepth()).toBe(fakes.parts.sceneDepth);
  });

  // Why: a page's shadow check must tell a shell that was never drawn
  // from one that drew nothing; `shell()` hands the pass's own counters
  // (and only those: no read-back of its targets).
  it("hands the shell's frames drawn, share and weights", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts);
    expect(clouds.shell()).toEqual({
      drawn: 0,
      share: 0.5,
      weight: 0.4,
      slabWeight: 0.6,
    });
    clouds.patch(reliefTiles());
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(clouds.shell().drawn).toBe(1);
  });

  // Why: the editor mounts and unmounts the view; every part is freed
  // once, and a frame after the dispose touches nothing.
  it("frees each part once and does nothing afterwards", () => {
    const fakes = fakeParts();
    const clouds = createGlobeViewClouds(fakeView(10_000), fakes.parts);
    clouds.patch(reliefTiles());
    clouds.dispose();
    clouds.dispose();
    expect(fakes.log.filter((l) => l.startsWith("dispose")).sort()).toEqual([
      "dispose depth",
      "dispose shell",
      "dispose slab",
    ]);
    const before = fakes.log.length;
    clouds.step({ observerKm: 10, shareClouds: () => 1 });
    clouds.render({ weight: 1 });
    expect(fakes.log.length).toBe(before);
  });
});

describe("createCloudsParts", () => {
  // Why: the slab is the ground sky's; where the ground sky cannot draw
  // (no float render targets) there are no heavy clouds, not a throw.
  it("makes none where the ground sky cannot draw", () => {
    expect(
      createCloudsParts(fakeView(10_000), {
        groundSky: {
          supported: false,
          atmosphere: null,
          scene: new THREE.Scene(),
        },
        spacePass: {} as never,
      }),
    ).toBeNull();
    expect(
      globeViewClouds(fakeView(10_000))({
        groundSky: {
          supported: false,
          atmosphere: null,
          scene: new THREE.Scene(),
        },
        spacePass: {} as never,
      }),
    ).toBeNull();
  });

  describe("with the near clouds", () => {
    const set = (altitudeM: number) => {
      const view = fakeView(altitudeM);
      const fakes = fakeParts();
      const { near, frames } = fakeNear();
      const worker = fakeWorker();
      const warned: string[] = [];
      const clouds = createGlobeViewClouds(
        view,
        {
          ...fakes.parts,
          near: near as unknown as NonNullable<CloudsParts["near"]>,
        },
        {
          near: {
            createWorker: () => worker,
            warn: (message) => warned.push(message),
          },
        },
      );
      clouds.patch(reliefTiles());
      const frame = () => {
        clouds.step({ observerKm: altitudeM / 1000, shareClouds: () => 1 });
        clouds.render({ weight: 0 });
      };
      return { clouds, fakes, near, frames, worker, frame, warned };
    };
    const bakes = { shape: new Uint8Array(1) };

    // Why this test matters: until the worker answers the page must show
    // its old clouds; after it the new ones, with no reload.
    it("draws the old clouds until the bakes arrive", async () => {
      const { near, frames, worker, frame, fakes } = set(5_000);
      frame();
      expect(frames).toHaveLength(0);
      expect(fakes.log).toContain("slab");
      worker.onmessage?.({ data: { kind: "bakes", bakes } } as MessageEvent);
      await vi.waitFor(() => expect(near.bakes).toEqual([bakes]));
      fakes.log.length = 0;
      frame();
      expect(frames).toHaveLength(1);
      expect(fakes.log).not.toContain("slab");
    });

    // Why this test matters: the worker's file missing from a bundle is a
    // page with old clouds and a line in the console, not a broken page.
    it("stays on the old clouds when the worker fails", async () => {
      const { frames, worker, frame, warned } = set(5_000);
      worker.onerror?.({ message: "not found" } as ErrorEvent);
      await vi.waitFor(() => expect(warned).toHaveLength(1));
      frame();
      expect(frames).toHaveLength(0);
    });

    // Why this test matters: the near clouds end at the relief at every
    // height they draw, also where the ground sky's share says nothing.
    it("draws the relief's depth for them whatever the sky's share", async () => {
      const { near, worker, frame, fakes } = set(5_000);
      worker.onmessage?.({ data: { kind: "bakes", bakes } } as MessageEvent);
      await vi.waitFor(() => expect(near.ready).toBe(true));
      frame();
      expect(fakes.log).toContain("depth");
    });

    it("draws on the view's tier and its drift clock", async () => {
      const view = Object.assign(fakeView(5_000), {
        quality: "medium" as const,
        driftTimeS: () => 42,
      });
      const fakes = fakeParts();
      const { near, frames } = fakeNear();
      const worker = fakeWorker();
      const clouds = createGlobeViewClouds(
        view,
        {
          ...fakes.parts,
          near: near as unknown as NonNullable<CloudsParts["near"]>,
        },
        { near: { createWorker: () => worker } },
      );
      clouds.patch(reliefTiles());
      worker.onmessage?.({ data: { kind: "bakes", bakes } } as MessageEvent);
      await vi.waitFor(() => expect(near.ready).toBe(true));
      clouds.step({ observerKm: 5, shareClouds: () => 1 });
      clouds.render({ weight: 1 });
      expect(frames[0]?.timeS).toBe(42);
      expect(frames[0]?.quality).toBe(GLOBE_QUALITIES.medium.clouds);
      expect(clouds.state().near).toMatchObject({
        share: 1,
        tier: "medium",
        pixelScale: 1,
      });
    });

    it("frees the near pass with the rest", () => {
      const { clouds, near } = set(5_000);
      clouds.dispose();
      clouds.dispose();
      expect(near.disposed).toBe(1);
    });
  });
});
