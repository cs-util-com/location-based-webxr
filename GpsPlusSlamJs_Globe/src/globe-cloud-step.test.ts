/**
 * The globe's clouds, frame by frame, moved out of the globe lab.
 *
 * Why this file matters: the step decides who draws the clouds at the
 * camera's altitude (the flat layer, the slab, the spherical volume) and
 * drives the two volumes in a fixed order with knob-derived arguments. A
 * shell drawn with the tile noise would seam against the slab; a slab told
 * it is not mixed while the shell draws would paint its clouds twice; a
 * hole cut while the disc runs ahead would leave a gap in the shell. These
 * tests pin the lab's calls, their order and their conditions with
 * recording fakes of both volumes; the clouds' look is the lab's smokes and
 * the reference captures.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { flatCloudShare } from "./globe-cloud-flat-fade.js";
import {
  CLOUD_HIGH_LAYER,
  CLOUD_SHELL_VOLUME,
  cloudShellNoiseCascade,
  cloudShellShadowStrengths,
  cloudShellStationsFor,
  cloudShellVolumeShares,
} from "./globe-cloud-shell-volume.js";
import type { GlobeCloudShellVolume } from "./globe-cloud-shell-volume-pass.js";
import {
  type GlobeCloudKnobs,
  type GlobeCloudVolumesFrame,
  cloudShellCascadeFromKnobs,
  cloudShellStationsFromKnobs,
  createGlobeCloudStep,
} from "./globe-cloud-step.js";
import type { GlobeCloudVolume } from "./globe-cloud-volume-pass.js";

/** The lab's defaults with the shell on and the live noise. */
const knobs = (over: Partial<GlobeCloudKnobs> = {}): GlobeCloudKnobs => ({
  cloudShellTopKm: CLOUD_SHELL_VOLUME.topKm,
  cloudShellMidKm: 200,
  cloudShellCell: CLOUD_SHELL_VOLUME.stations[0].cellScale,
  cloudShellThick: CLOUD_SHELL_VOLUME.stations[0].thicknessScale,
  cloudShellNoise: CLOUD_SHELL_VOLUME.stations[0].noiseShare,
  cloudShellBandKm: CLOUD_SHELL_VOLUME.bandKm,
  cloudShellFields: 3,
  cloudVolumeCeilingKm: 40,
  cloudVolume: 2,
  cloudVolumeKm: 80,
  cloudVolumeFadeKm: 25,
  cloudVolumeCover: 1,
  cloudShadowFrom: 0,
  cloudNoise: "live",
  cloudFineGain: 0.5,
  cloudShellVolume: 1,
  cloudShellRes: 0.5,
  cloudShellShadow: 0,
  cloudFlat: 1,
  cloudFlatTopKm: 5_000,
  cloudFlatWeak: 0.3,
  cloudFlatOutToKm: 700,
  cloudFlatOutFromKm: 900,
  cloudHigh: 0,
  cloudHighKm: CLOUD_HIGH_LAYER.altitudeKm,
  cloudHighCell: CLOUD_HIGH_LAYER.cellScale,
  cloudHighCover: CLOUD_HIGH_LAYER.cover,
  cloudHighShare: CLOUD_HIGH_LAYER.noiseShare,
  ...over,
});

/** A slab volume that records its calls; its state as given. */
const fakeSlab = (
  log: unknown[][],
  state: { share: number; radiusM: number; drawn?: boolean },
) => {
  const texture = new THREE.Texture();
  const volume = {
    setEnabled: (on: boolean) => log.push(["slab.setEnabled", on]),
    setShadow: (on: boolean) => log.push(["slab.setShadow", on]),
    setNoise: (mode: string) => log.push(["slab.setNoise", mode]),
    setFineGain: (g: number) => log.push(["slab.setFineGain", g]),
    update: (frame: unknown) => {
      log.push(["slab.update", frame]);
      return { share: state.share, radiusM: state.radiusM };
    },
    render: (
      _camera: unknown,
      relief: unknown,
      extra: unknown,
      options: unknown,
    ) => {
      log.push(["slab.render", relief, extra, options]);
      return state.drawn ?? true;
    },
    texture,
    state: () => ({
      share: state.share,
      radiusM: state.radiusM,
      discCentre: { x: 5, z: -7 },
      deckY: 3000,
    }),
    alphaGrid: (nx: number, ny: number) => {
      log.push(["slab.alphaGrid", nx, ny]);
      return [0.5];
    },
  };
  return { volume: volume as unknown as GlobeCloudVolume, texture };
};

/** A spherical volume that records its calls; its state as given. */
const fakeShell = (
  log: unknown[][],
  state: { share: number; slabWeight: number; high?: boolean },
) =>
  ({
    setEnabled: (on: boolean) => log.push(["shell.setEnabled", on]),
    setResolution: (r: number) => log.push(["shell.setResolution", r]),
    update: (frame: unknown) => {
      log.push(["shell.update", frame]);
      return { weight: 0, slabWeight: 0 };
    },
    render: (_camera: unknown, options: unknown) => {
      log.push(["shell.render", options]);
      return true;
    },
    readBack: (bands: number) => {
      log.push(["shell.readBack", bands]);
      return [{ meanAlpha: 0.25, over: 0.5 }];
    },
    alphaGrid: (nx: number, ny: number, which = "deck") => {
      log.push(["shell.alphaGrid", nx, ny, which]);
      return [which === "deck" ? 1 : 2];
    },
    state: () => ({
      share: state.share,
      slabWeight: state.slabWeight,
      high: state.high ? { altitudeKm: 9 } : null,
    }),
  }) as unknown as GlobeCloudShellVolume;

/** A deck that records its hole; 3 km up. */
const fakeDeck = (log: unknown[][]) => ({
  heightM: () => 3000,
  setHole: (hole: unknown) => log.push(["deck.setHole", hole]),
});

const volumesFrame = (
  log: unknown[][],
  over: Partial<GlobeCloudVolumesFrame> = {},
): GlobeCloudVolumesFrame => ({
  observerKm: 20,
  cameraAltM: 20_000,
  target: { lat: 45, lng: 7 },
  view: { position: [1, 2, 3], direction: [0, -1, 0] },
  deck: fakeDeck(log),
  ...over,
});

describe("cloudShellStationsFromKnobs and cloudShellCascadeFromKnobs", () => {
  it("are the module's law and cascade from the lab's knobs", () => {
    const p = knobs({ cloudShellTopKm: 900, cloudShellCell: 6 });
    const stations = cloudShellStationsFor({
      topKm: 900,
      midKm: 200,
      cellScale: 6,
      thicknessScale: p.cloudShellThick,
      noiseShare: p.cloudShellNoise,
      ceilingKm: 40,
    });
    expect(cloudShellStationsFromKnobs(p)).toEqual(stations);
    expect(cloudShellCascadeFromKnobs(300, p)).toEqual(
      cloudShellNoiseCascade(300, {
        topKm: (stations[0]?.altitudeKm ?? 0) + p.cloudShellBandKm,
        bottomKm: stations.at(-1)?.altitudeKm ?? 0,
        fields: 3,
        topScale: 6,
      }),
    );
  });

  it("rounds the field count and refuses knobs the law refuses", () => {
    expect(
      cloudShellCascadeFromKnobs(300, knobs({ cloudShellFields: 2.6 })),
    ).toEqual(cloudShellCascadeFromKnobs(300, knobs({ cloudShellFields: 3 })));
    expect(() =>
      cloudShellStationsFromKnobs(knobs({ cloudShellCell: 0 })),
    ).toThrow(RangeError);
  });
});

describe("createGlobeCloudStep: plan", () => {
  const setUp = () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 80_000 }).volume,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0 }),
    });
    return { step, log };
  };

  it("hands the clouds to the shell with the live noise, a frame and the slab on", () => {
    const { step } = setUp();
    const p = knobs({ cloudShellShadow: 0.6 });
    const plan = step.plan(p, { cameraAltM: 300_000, framed: true });
    const topKm = cloudShellStationsFromKnobs(p)[0]?.altitudeKm ?? 0;
    const shares = cloudShellVolumeShares(300, {
      topKm,
      bandKm: p.cloudShellBandKm,
      ceilingKm: 40,
      fadeKm: 25,
    });
    expect(plan.shellOn).toBe(true);
    expect(plan.shares).toEqual(shares);
    expect(step.shares).toBe(plan.shares);
    expect(plan.shadow).toEqual(
      cloudShellShadowStrengths({ strength: 0.6, shellIn: shares.shellIn }),
    );
    expect(step.shadow).toBe(plan.shadow);
    // The flat layer's share: with the shell's top and its own band (C5).
    expect(plan.flat).toBe(
      flatCloudShare(300_000, {
        ceilingKm: 40,
        fadeKm: 25,
        topM: 5_000_000,
        weakShare: 0.3,
        shellTopKm: topKm,
        shellBandKm: p.cloudShellBandKm,
        flatOut: { fromKm: 900, toKm: 700 },
      }),
    );
    expect(plan.flatShadow).toBe(
      flatCloudShare(300_000, {
        ceilingKm: 40,
        fadeKm: 25,
        topM: 5_000_000,
        weakShare: 0.3,
      }),
    );
  });

  it("keeps the shell off without the live noise, a frame, its switch or the slab", () => {
    const off = [
      [knobs({ cloudNoise: "tile" }), true],
      [knobs({ cloudNoise: "hex" }), true],
      [knobs({ cloudShellVolume: 0 }), true],
      [knobs({ cloudVolume: 0 }), true],
      [knobs(), false],
    ] as const;
    for (const [p, framed] of off) {
      const { step } = setUp();
      const plan = step.plan(p, { cameraAltM: 300_000, framed });
      expect(plan.shellOn).toBe(false);
      expect(plan.shares).toBeNull();
      expect(plan.shadow).toEqual({ shell: 0, mapFactor: 1 });
    }
    const log: unknown[][] = [];
    const noShell = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 1 }).volume,
      shellVolume: null,
    });
    expect(
      noShell.plan(knobs(), { cameraAltM: 300_000, framed: true }).shellOn,
    ).toBe(false);
  });

  it("draws no shares without an altitude, and a whole flat layer when it is off", () => {
    const { step } = setUp();
    const plan = step.plan(knobs(), { cameraAltM: Number.NaN, framed: true });
    expect(plan.shellOn).toBe(true);
    expect(plan.shares).toBeNull();
    expect(plan.flat).toBe(1);
    expect(plan.flatShadow).toBe(1);
    const flatOff = step.plan(knobs({ cloudFlat: 0 }), {
      cameraAltM: 300_000,
      framed: true,
    });
    expect(flatOff.flat).toBe(1);
    expect(flatOff.flatShadow).toBe(1);
  });

  it("keeps the flat layer's band above the slab's ceiling, whatever the knobs say", () => {
    const { step } = setUp();
    const p = knobs({ cloudFlatOutToKm: 10, cloudFlatOutFromKm: 5 });
    const plan = step.plan(p, { cameraAltM: 45_000, framed: true });
    expect(plan.flat).toBe(
      flatCloudShare(45_000, {
        ceilingKm: 40,
        fadeKm: 25,
        topM: 5_000_000,
        weakShare: 0.3,
        shellTopKm: cloudShellStationsFromKnobs(p)[0]?.altitudeKm ?? 0,
        shellBandKm: p.cloudShellBandKm,
        flatOut: { fromKm: 42, toKm: 41 },
      }),
    );
  });

  it("weakens the flat layer without a slab (ceiling 0, fade 1)", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({ cloudVolume: null, shellVolume: null });
    const plan = step.plan(knobs(), { cameraAltM: 30_000, framed: true });
    expect(plan.flat).toBe(
      flatCloudShare(30_000, {
        ceilingKm: 0,
        fadeKm: 1,
        topM: 5_000_000,
        weakShare: 0.3,
        shellTopKm: 0,
        shellBandKm: CLOUD_SHELL_VOLUME.bandKm,
        flatOut: null,
      }),
    );
    expect(log).toEqual([]);
  });
});

describe("createGlobeCloudStep: updateVolumes", () => {
  it("updates the slab, cuts the shell's hole, then updates the spherical volume, in that order", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 80_000 }).volume,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0 }),
    });
    const p = knobs({
      cloudVolume: 1,
      cloudShadowFrom: 1,
      cloudFineGain: 0.4,
      cloudShellShadow: 0.5,
      cloudHigh: 1,
    });
    const plan = step.plan(p, { cameraAltM: 30_000, framed: true });
    const frame = volumesFrame(log, { cameraAltM: 30_000 });
    step.updateVolumes(p, frame);
    expect(log.map((e) => e[0])).toEqual([
      "slab.setEnabled",
      "slab.setShadow",
      "slab.setNoise",
      "slab.setFineGain",
      "slab.update",
      "deck.setHole",
      "shell.setEnabled",
      "shell.setResolution",
      "shell.update",
    ]);
    expect(log.slice(0, 4)).toEqual([
      ["slab.setEnabled", true],
      ["slab.setShadow", true],
      ["slab.setNoise", "live"],
      ["slab.setFineGain", 0.4],
    ]);
    expect(log[4]?.[1]).toEqual({
      altitudeKm: 20,
      target: { lat: 45, lng: 7 },
      radiusKm: 80,
      ceilingKm: 40,
      fadeKm: 25,
      cover: 1,
      shellHeightM: 3000,
      view: frame.view,
      maxAheadM: 0,
      mixed: true,
    });
    // Variant 1: the hole on the camera, the disc's size.
    expect(log[5]).toEqual([
      "deck.setHole",
      { radiusM: 80_000, aboveCameraM: 3000 - 20_000 },
    ]);
    expect(log[6]).toEqual(["shell.setEnabled", true]);
    expect(log[7]).toEqual(["shell.setResolution", 0.5]);
    expect(log[8]?.[1]).toEqual({
      altitudeKm: 30,
      shares: plan.shares,
      stations: cloudShellStationsFromKnobs(p),
      target: { lat: 45, lng: 7 },
      deckKm: 3,
      cover: 1,
      cascade: cloudShellCascadeFromKnobs(30, p),
      highLayer: {
        on: true,
        altitudeKm: CLOUD_HIGH_LAYER.altitudeKm,
        cellScale: CLOUD_HIGH_LAYER.cellScale,
        cover: CLOUD_HIGH_LAYER.cover,
        noiseShare: CLOUD_HIGH_LAYER.noiseShare,
        shadow: 0.5,
      },
      shadow: plan.shadow.shell,
    });
  });

  it("runs the disc ahead and cuts no hole in variant 2; no hole for an empty disc", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 80_000 }).volume,
      shellVolume: null,
    });
    step.updateVolumes(knobs({ cloudVolume: 2 }), volumesFrame(log));
    expect((log[4]?.[1] as { maxAheadM: number }).maxAheadM).toBe(60_000);
    expect((log[4]?.[1] as { mixed: boolean }).mixed).toBe(false);
    expect(log[5]).toEqual(["deck.setHole", null]);
    const empty: unknown[][] = [];
    const none = createGlobeCloudStep({
      cloudVolume: fakeSlab(empty, { share: 0, radiusM: 0 }).volume,
      shellVolume: null,
    });
    none.updateVolumes(knobs({ cloudVolume: 1 }), volumesFrame(empty));
    expect(empty[5]).toEqual(["deck.setHole", null]);
  });

  it("turns the spherical volume off with zero shares and a 0 altitude without one", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: null,
      shellVolume: fakeShell(log, { share: 0, slabWeight: 0 }),
    });
    step.updateVolumes(
      knobs(),
      volumesFrame(log, { cameraAltM: Number.NaN, observerKm: -1 }),
    );
    expect(log[0]).toEqual(["shell.setEnabled", false]);
    const frame = log[2]?.[1] as { altitudeKm: number; shares: unknown };
    expect(frame.altitudeKm).toBe(0);
    expect(frame.shares).toEqual({ shellIn: 0, shell: 0, slab: 0 });
  });

  it("hands the shell a 0 altitude for a camera under the ellipsoid", () => {
    // The shell's law and cascade are refused below 0 km; the lab clamped.
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: null,
      shellVolume: fakeShell(log, { share: 0, slabWeight: 0 }),
    });
    step.updateVolumes(knobs(), volumesFrame(log, { cameraAltM: -50 }));
    expect((log[2]?.[1] as { altitudeKm: number }).altitudeKm).toBe(0);
  });

  it("hands the slab a 0 altitude for an observer under the ellipsoid", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 1 }).volume,
      shellVolume: null,
    });
    step.updateVolumes(knobs(), volumesFrame(log, { observerKm: -0.2 }));
    expect((log[4]?.[1] as { altitudeKm: number }).altitudeKm).toBe(0);
  });
});

describe("createGlobeCloudStep: render", () => {
  const renderFrame = {
    relief: new THREE.Group(),
    extra: [new THREE.Group()],
    worldFromEcef: new THREE.Matrix4(),
    sunEcef: new THREE.Vector3(1, 0, 0),
    sunIntensity: 2,
    sceneDepthWeight: 0.75,
    flatten: 0.5,
  };
  const camera = new THREE.PerspectiveCamera();

  it("draws the slab with its own composite while the shell does not draw", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 1 }).volume,
      shellVolume: fakeShell(log, { share: 0, slabWeight: 0 }),
    });
    step.render(camera, renderFrame);
    expect(log).toEqual([
      [
        "slab.render",
        renderFrame.relief,
        renderFrame.extra,
        { composite: true },
      ],
    ]);
  });

  it("mixes the slab's texture and disc into the shell's composite", () => {
    const log: unknown[][] = [];
    const { volume, texture } = fakeSlab(log, { share: 1, radiusM: 9000 });
    const step = createGlobeCloudStep({
      cloudVolume: volume,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0.5 }),
    });
    step.plan(knobs(), { cameraAltM: 30_000, framed: true });
    step.render(camera, renderFrame);
    expect(log).toEqual([
      [
        "slab.render",
        renderFrame.relief,
        renderFrame.extra,
        { composite: false },
      ],
      [
        "shell.render",
        {
          worldFromEcef: renderFrame.worldFromEcef,
          sunEcef: renderFrame.sunEcef,
          sunIntensity: 2,
          slabTexture: texture,
          sceneDepthWeight: 0.75,
          disc: { centre: { x: 5, z: -7 }, deckY: 3000, radiusM: 9000 },
          flatten: 0.5,
        },
      ],
    ]);
    expect((log[1]?.[1] as { slabTexture: unknown }).slabTexture).toBe(texture);
  });

  it("hands the shell no slab texture when the slab drew nothing", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 0, radiusM: 0, drawn: false }).volume,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0 }),
    });
    step.plan(knobs(), { cameraAltM: 300_000, framed: true });
    step.render(camera, renderFrame);
    expect((log[1]?.[1] as { slabTexture: unknown }).slabTexture).toBeNull();
  });

  it("draws nothing without a slab", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: null,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0 }),
    });
    step.render(camera, renderFrame);
    expect(log).toEqual([]);
    expect(step.slabDisc()).toBeNull();
  });
});

describe("createGlobeCloudStep: debug hooks", () => {
  it("reads the shell's, its high layer's, its shadow's and the slab's grids", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 1, radiusM: 1 }).volume,
      shellVolume: fakeShell(log, { share: 0.8, slabWeight: 0.4, high: true }),
    });
    expect(step.alphaGrid(2, 3)).toEqual({
      weight: 0.8,
      slabWeight: 0.4,
      shell: [1],
      high: [2],
      shadow: [2],
      slab: [0.5],
    });
    expect(log).toEqual([
      ["shell.alphaGrid", 2, 3, "deck"],
      ["shell.alphaGrid", 2, 3, "high"],
      ["shell.alphaGrid", 2, 3, "shadow"],
      ["slab.alphaGrid", 2, 3],
    ]);
    expect(step.readBack(4)).toEqual([{ meanAlpha: 0.25, over: 0.5 }]);
  });

  it("reads no grid where a drawer does not draw, and none without the shell", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 0, radiusM: 0 }).volume,
      shellVolume: fakeShell(log, { share: 0, slabWeight: 0.4 }),
    });
    expect(step.alphaGrid(2, 2)).toEqual({
      weight: 0,
      slabWeight: 0.4,
      shell: null,
      high: null,
      shadow: null,
      slab: null,
    });
    const none = createGlobeCloudStep({ cloudVolume: null, shellVolume: null });
    expect(none.alphaGrid(2, 2)).toBeNull();
    expect(none.readBack()).toBeNull();
    expect(none.seamGrid(2, 2, () => undefined)).toBeNull();
  });

  it("draws one frame for the seam grid only while both draw", () => {
    const log: unknown[][] = [];
    const step = createGlobeCloudStep({
      cloudVolume: fakeSlab(log, { share: 0.7, radiusM: 1 }).volume,
      shellVolume: fakeShell(log, { share: 1, slabWeight: 0.7 }),
    });
    let frames = 0;
    const frame = () => {
      frames += 1;
    };
    // No plan yet: the shell does not draw.
    expect(step.seamGrid(2, 2, frame)).toBeNull();
    step.plan(knobs(), { cameraAltM: 30_000, framed: true });
    expect(step.seamGrid(2, 2, frame)).toEqual({
      shell: [1],
      slab: [0.5],
      slabShare: 0.7,
    });
    expect(frames).toBe(1);
    const off: unknown[][] = [];
    const slabOff = createGlobeCloudStep({
      cloudVolume: fakeSlab(off, { share: 0, radiusM: 0 }).volume,
      shellVolume: fakeShell(off, { share: 1, slabWeight: 0 }),
    });
    slabOff.plan(knobs(), { cameraAltM: 300_000, framed: true });
    expect(slabOff.seamGrid(2, 2, frame)).toBeNull();
    expect(frames).toBe(1);
  });
});
