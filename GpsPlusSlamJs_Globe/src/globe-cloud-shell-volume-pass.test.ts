/**
 * The spherical cloud volume's drawing pass, moved out of the globe lab.
 *
 * Why this file matters: the pass marches the shell into its own target,
 * its ground shadow and its high layer into theirs, and mixes them with
 * the slab in one composite. A march drawn without its alpha-0 clear would
 * keep the last frame's clouds; a clear colour or target not put back
 * would break the next pass; a high layer that left its deck or field in
 * the uniforms would draw the next frame's shell at 9 km; a composite that
 * weighed the slab without its texture would darken the clouds. These
 * tests pin what the lab did, under Node, with the real framework sky from
 * `createGlobeGroundSky` and a recording fake renderer that snapshots the
 * uniforms at each draw. The clouds' look is the lab's smokes and the
 * reference captures.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { CLOUD_SLAB } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-slab";
import { EARTH_ATMOSPHERE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-model";
import {
  CLOUD_LIVE_NOISE,
  cloudLiveBasis,
} from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise";

import { ZENITH_TABLE } from "./globe-cloud-shell-light.js";
import {
  CLOUD_HIGH_LAYER,
  CLOUD_SHELL_VOLUME,
  type CloudShellNoiseCascade,
  cloudShellVolumeLaw,
} from "./globe-cloud-shell-volume.js";
import {
  type CloudShellVolumeFrame,
  createGlobeCloudShellVolume,
} from "./globe-cloud-shell-volume-pass.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";

type Uniforms = Record<string, THREE.IUniform>;

/** One draw: which material, into which target, its uniforms then. */
interface Draw {
  kind: "march" | "composite";
  into: THREE.WebGLRenderTarget | null;
  uniforms: Uniforms;
  snapshot: Record<string, unknown>;
}

const MARCH_KEYS = [
  "uShadow",
  "uShadowPass",
  "uDeckBaseKm",
  "uDeckTopKm",
  "uThickness",
  "uNoiseShare",
  "uCoverGain",
  "uBothSides",
  "uFlatten",
  "uAerial",
  "uSteps",
] as const;
const COMPOSITE_KEYS = [
  "uShellWeight",
  "uSlabWeight",
  "uShadowOn",
  "uHighOn",
  "uHighInFront",
] as const;

/** A float-capable renderer that records draws, clears and clear colours. */
const fakeRenderer = () => {
  const log: string[] = [];
  const draws: Draw[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const clear = new THREE.Color(0x123456);
  let clearAlpha = 1;
  const gl = {
    NO_ERROR: 0,
    getError: () => 0,
    createBuffer: () => null,
    readPixels: () => undefined,
  };
  const renderer = {
    getContext: () => gl,
    extensions: { has: () => true },
    domElement: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(8, 4),
    getClearColor: (out: THREE.Color) => out.copy(clear),
    getClearAlpha: () => clearAlpha,
    setClearColor: (colour: THREE.ColorRepresentation, alpha: number) => {
      clear.set(colour);
      clearAlpha = alpha;
      log.push(`clearColour ${clear.getHexString()} ${alpha}`);
    },
    clear: (c: boolean, d: boolean, s: boolean) => {
      log.push(`clear ${c} ${d} ${s}`);
    },
    render: (scene: THREE.Scene) => {
      const mesh = scene.children[0] as THREE.Mesh;
      const material = mesh.material as THREE.ShaderMaterial;
      const uniforms: Uniforms = material.uniforms;
      const kind = "tShell" in uniforms ? "composite" : "march";
      const keys = kind === "march" ? MARCH_KEYS : COMPOSITE_KEYS;
      const snapshot: Record<string, unknown> = {};
      for (const k of keys) snapshot[k] = uniforms[k]?.value;
      snapshot.uCells = (
        uniforms.uCells?.value as THREE.Vector2 | undefined
      )?.toArray();
      snapshot.uBasis = uniforms.uBasis?.value;
      draws.push({ kind, into: target, uniforms, snapshot });
      log.push(`render ${kind} into ${target ? "a target" : "the canvas"}`);
    },
    readRenderTargetPixels: (
      t: THREE.WebGLRenderTarget,
      _x: number,
      _y: number,
      w: number,
      h: number,
      out: Uint16Array,
    ) => {
      // Alpha 1 in the bottom row, 0.5 in the left half above it, 0 else.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = y === 0 ? 1 : x < w / 2 ? 0.5 : 0;
          out[(y * w + x) * 4 + 3] = THREE.DataUtils.toHalfFloat(a);
        }
      }
      log.push(`read ${t.width}x${t.height}`);
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, log, draws };
};

/** A scene depth that is fresh or not as told. */
const fakeDepth = (fresh: boolean) =>
  ({
    texture: new THREE.DepthTexture(1, 1),
    camera: new THREE.PerspectiveCamera(),
    fresh,
    render: () => undefined,
    beginFrame: () => undefined,
    state: () => ({ frames: 0, fresh, near: 0.1 }),
    dispose: () => undefined,
  }) as unknown as GlobeSceneDepth;

const lut = new THREE.Texture();

const setUp = (options: { lutReady?: boolean; depthFresh?: boolean } = {}) => {
  const { renderer, log, draws } = fakeRenderer();
  const sky = createGlobeGroundSky(renderer);
  const groundSky = sky.atmosphere;
  if (groundSky === null) throw new Error("the fake renderer has floats");
  const surfaceUniforms = {
    uClouds: { value: new THREE.Texture() },
    uCloudCubic: { value: 1 },
    uCloudLonOffset: { value: 0.25 },
    uCloudOpacity: { value: 0.9 },
  };
  const sceneDepth = fakeDepth(options.depthFresh ?? true);
  const shell = createGlobeCloudShellVolume(renderer, {
    ellipsoid: WGS84_ELLIPSOID,
    surfaceUniforms,
    groundSky,
    atmosphere: {
      transmittance: () => (options.lutReady === false ? null : lut),
    },
    sceneDepth,
  });
  return { shell, log, draws, groundSky, surfaceUniforms, sceneDepth };
};

/** One field: the slab's own (scale 1, no offset) unless told. */
const cascadeOf = (
  fields: { scale: number; offsetCells: [number, number] }[],
  weights: [number, number] = [1, 0],
): CloudShellNoiseCascade => ({ index: 0, fields, weights });

const frameAt = (
  over: Partial<CloudShellVolumeFrame> = {},
): CloudShellVolumeFrame => ({
  altitudeKm: 300,
  shares: { shellIn: 1, shell: 0.75, slab: 0.25 },
  stations: CLOUD_SHELL_VOLUME.stations,
  target: { lat: 45, lng: 7 },
  deckKm: 3,
  cascade: cascadeOf([{ scale: 1, offsetCells: [0, 0] }]),
  ...over,
});

const camera = () => {
  const c = new THREE.PerspectiveCamera(60, 2, 1, 1e7);
  c.position.set(0, 300_000, 0);
  c.updateMatrixWorld();
  return c;
};

const renderOptions = {
  worldFromEcef: new THREE.Matrix4(),
  sunEcef: new THREE.Vector3(1, 0, 0),
  sunIntensity: 3,
};

/** The draw at `index` (negative from the end); throws when there is none. */
const drawAt = (draws: Draw[], index: number): Draw => {
  const d = draws.at(index);
  if (!d) throw new Error(`no draw at ${index}`);
  return d;
};

const marchDraw = (draws: Draw[]) => {
  const d = draws.find((x) => x.kind === "march");
  if (!d) throw new Error("no march drawn");
  return d;
};

describe("createGlobeCloudShellVolume", () => {
  it("draws nothing while off, without a frame, with no weight or without the sun's table", () => {
    const cases: [boolean, CloudShellVolumeFrame, boolean][] = [
      [false, frameAt(), true],
      [true, frameAt({ target: null }), true],
      [true, frameAt({ shares: { shellIn: 0, shell: 0, slab: 0 } }), true],
      [true, frameAt(), false],
    ];
    for (const [on, frame, lutReady] of cases) {
      const { shell, log } = setUp({ lutReady });
      shell.setEnabled(on);
      shell.update(frame);
      expect(shell.render(camera(), renderOptions)).toBe(false);
      expect(log).toEqual([]);
      expect(shell.state().drawn).toBe(0);
    }
  });

  it("weighs nothing while off or without a frame, and takes the law even then", () => {
    const { shell } = setUp();
    expect(shell.update(frameAt())).toEqual({ weight: 0, slabWeight: 0 });
    // The law refuses stations the shares would: even while off.
    expect(() => shell.update(frameAt({ stations: [] }))).toThrow(RangeError);
    shell.setEnabled(true);
    expect(shell.update(frameAt({ target: null }))).toEqual({
      weight: 0,
      slabWeight: 0,
    });
    expect(shell.state().framed).toBe(false);
    expect(shell.update(frameAt())).toEqual({ weight: 0.75, slabWeight: 0.25 });
    expect(shell.state()).toMatchObject({
      enabled: true,
      framed: true,
      share: 1,
      weight: 0.75,
      slabWeight: 0.25,
      law: { ...cloudShellVolumeLaw(300, CLOUD_SHELL_VOLUME.stations) },
    });
  });

  it("marches into its own target cleared to alpha 0, then mixes over the frame, putting the clear colour and target back", () => {
    const { shell, log, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt());
    expect(shell.render(camera(), renderOptions)).toBe(true);
    expect(log).toEqual([
      "clearColour 000000 0",
      "clear true false false",
      "render march into a target",
      "clearColour 123456 1",
      "render composite into the canvas",
    ]);
    const march = marchDraw(draws);
    const composite = drawAt(draws, 1);
    expect(march.into).not.toBeNull();
    expect(composite.uniforms.tShell?.value).toBe(march.into?.texture);
    expect(march.snapshot.uShadow).toBe(0);
    expect(march.snapshot.uShadowPass).toBe(0);
    expect(shell.state().drawn).toBe(1);
  });

  it("composites alone, without a march, while the shell has not faded in", () => {
    const { shell, log, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt({ shares: { shellIn: 0, shell: 0, slab: 1 } }));
    expect(shell.render(camera(), renderOptions)).toBe(true);
    expect(log).toEqual(["render composite into the canvas"]);
    expect(drawAt(draws, 0).snapshot).toMatchObject({
      uShellWeight: 0,
      uSlabWeight: 0,
      uShadowOn: 0,
      uHighOn: 0,
    });
  });

  it("writes the law's deck, march and look, and the aerial fade as the slab's share cubed", () => {
    const { shell, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt({ cover: 1.5 }));
    shell.render(camera(), renderOptions);
    const law = cloudShellVolumeLaw(300, CLOUD_SHELL_VOLUME.stations);
    const half =
      ((CLOUD_SLAB.topM - CLOUD_SLAB.baseM) / 2000) * law.thicknessScale;
    expect(marchDraw(draws).snapshot).toMatchObject({
      uDeckBaseKm: 3 - half,
      uDeckTopKm: 3 + half,
      uThickness: law.thicknessScale,
      uSteps: law.marchSteps,
      uNoiseShare: law.noiseShare,
      uCoverGain: 1.5,
      uAerial: 0.25 ** 3,
      uBothSides: 0,
    });
    expect(marchDraw(draws).uniforms.uOctaves?.value).toBe(law.octaves);
    expect(marchDraw(draws).uniforms.uShellIn?.value).toBe(1);
    expect(shell.state().deckKm).toEqual([3 - half, 3 + half]);
  });

  it("takes the sky's basis for the slab's own field and the carried anchor over a scaled one", () => {
    const { shell, draws, groundSky } = setUp();
    shell.setEnabled(true);
    // A sentinel in the sky's basis: the slab's own field must take the
    // sky's vectors as they are, not recompute them from the anchor.
    groundSky.cloudUniforms.atmCloudLiveBasis.value[0]?.set(9, 8, 7, 6);
    shell.update(
      frameAt({
        cascade: cascadeOf(
          [
            { scale: 1, offsetCells: [0, 0] },
            { scale: 3, offsetCells: [173, 97] },
          ],
          [0.6, 0.8],
        ),
      }),
    );
    shell.render(camera(), renderOptions);
    const u = marchDraw(draws).uniforms;
    expect(marchDraw(draws).snapshot.uCells).toEqual([1, 3]);
    expect((u.uFieldWeights?.value as THREE.Vector2).toArray()).toEqual([
      0.6, 0.8,
    ]);
    const sky = groundSky.cloudUniforms.atmCloudLiveBasis.value;
    const first = u.uBasis?.value as THREE.Vector4[];
    expect(first.map((v) => v.toArray())).toEqual(sky.map((v) => v.toArray()));
    expect(first[0]?.toArray()).toEqual([9, 8, 7, 6]);
    // A copy, not the sky's vectors: the sky's own basis moves with its frame.
    expect(first[0]).not.toBe(sky[0]);
    const anchor = groundSky.cloudNoiseAnchor;
    const expected = cloudLiveBasis(
      {
        originKm: [
          anchor.originKm[0] / 3 + 173 * CLOUD_LIVE_NOISE.baseCellKm,
          anchor.originKm[1] / 3 + 97 * CLOUD_LIVE_NOISE.baseCellKm,
        ],
        rotationRad: anchor.rotationRad,
      },
      {},
    );
    const second = (u.uBasisB?.value as THREE.Vector4[]).flatMap((v) =>
      v.toArray(),
    );
    expect(second).toEqual(expected.slice(0, second.length));
  });

  it("reads the second field as the first at the cascade's bottom", () => {
    const { shell, draws } = setUp();
    shell.setEnabled(true);
    shell.update(
      frameAt({ cascade: cascadeOf([{ scale: 2, offsetCells: [5, 6] }]) }),
    );
    shell.render(camera(), renderOptions);
    const u = marchDraw(draws).uniforms;
    expect(marchDraw(draws).snapshot.uCells).toEqual([2, 2]);
    expect(
      (u.uBasisB?.value as THREE.Vector4[]).map((v) => v.toArray()),
    ).toEqual((u.uBasis?.value as THREE.Vector4[]).map((v) => v.toArray()));
  });

  it("draws the ground shadow alone into its own target, then puts its switches back to 0", () => {
    const { shell, log, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt({ shadow: 0.4 }));
    shell.render(camera(), renderOptions);
    expect(log).toEqual([
      "clearColour 000000 0",
      "clear true false false",
      "render march into a target",
      "clear true false false",
      "render march into a target",
      "clearColour 123456 1",
      "render composite into the canvas",
    ]);
    const [deck, shadow, composite] = [0, 1, 2].map((i) =>
      drawAt(draws, i),
    ) as [Draw, Draw, Draw];
    expect(deck.snapshot).toMatchObject({ uShadow: 0, uShadowPass: 0 });
    expect(shadow.snapshot).toMatchObject({ uShadow: 0.4, uShadowPass: 1 });
    expect(shadow.into).not.toBe(deck.into);
    expect(composite.uniforms.tShadow?.value).toBe(shadow.into?.texture);
    expect(composite.snapshot.uShadowOn).toBe(1);
    expect(deck.uniforms.uShadow?.value).toBe(0);
    expect(deck.uniforms.uShadowPass?.value).toBe(0);
  });

  it("marches the high layer with its own deck and field, then puts every swapped uniform back", () => {
    const { shell, log, draws } = setUp();
    shell.setEnabled(true);
    shell.update(
      frameAt({
        altitudeKm: 300,
        highLayer: { on: true, cover: 0.5, shadow: 0.2 },
      }),
    );
    shell.render(camera(), renderOptions);
    expect(log).toEqual([
      "clearColour 000000 0",
      "clear true false false",
      "render march into a target",
      "clear true false false",
      "render march into a target",
      "clearColour 123456 1",
      "render composite into the canvas",
    ]);
    const [deck, high, composite] = [0, 1, 2].map((i) => drawAt(draws, i)) as [
      Draw,
      Draw,
      Draw,
    ];
    const half = (CLOUD_SLAB.topM - CLOUD_SLAB.baseM) / 2000;
    expect(high.snapshot).toMatchObject({
      uDeckBaseKm: CLOUD_HIGH_LAYER.altitudeKm - half,
      uDeckTopKm: CLOUD_HIGH_LAYER.altitudeKm + half,
      uThickness: CLOUD_HIGH_LAYER.thicknessScale,
      uNoiseShare: CLOUD_HIGH_LAYER.noiseShare,
      uCoverGain: 0.5,
      uBothSides: 1,
      uShadow: 0.2,
      uFlatten: 0,
      uAerial: 0,
    });
    expect(high.snapshot.uCells).toEqual([
      CLOUD_HIGH_LAYER.cellScale,
      CLOUD_HIGH_LAYER.cellScale,
    ]);
    expect(high.snapshot.uBasis).not.toBe(deck.snapshot.uBasis);
    expect(composite.uniforms.tHigh?.value).toBe(high.into?.texture);
    // From 300 km the high layer is in front.
    expect(composite.snapshot).toMatchObject({ uHighOn: 1, uHighInFront: 1 });
    // Every swapped uniform is back: the deck's own values and objects.
    const u = deck.uniforms;
    for (const k of MARCH_KEYS) {
      expect(u[k]?.value, k).toBe(deck.snapshot[k]);
    }
    expect((u.uCells?.value as THREE.Vector2).toArray()).toEqual(
      deck.snapshot.uCells,
    );
    expect(u.uBasis?.value).toBe(deck.snapshot.uBasis);
    expect(shell.state().high).toMatchObject({
      altitudeKm: CLOUD_HIGH_LAYER.altitudeKm,
      cover: 0.5,
      shadow: 0.2,
      inFront: true,
    });
  });

  it("puts the high layer behind the clouds from below its middle", () => {
    const { shell, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt({ altitudeKm: 5, highLayer: { on: true } }));
    shell.render(camera(), renderOptions);
    expect(drawAt(draws, -1).snapshot.uHighInFront).toBe(0);
    expect(shell.state().high?.shadow).toBe(0);
  });

  it("weighs the slab in the composite only with its texture, and eases the flat deck in", () => {
    const { shell, draws } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt({ shares: { shellIn: 1, shell: 0.95, slab: 0.05 } }));
    const slabTexture = new THREE.Texture();
    const disc = { centre: { x: 3000, z: 4000 }, deckY: 3000, radiusM: 20_000 };
    shell.render(camera(), {
      ...renderOptions,
      slabTexture,
      disc,
      flatten: 0.8,
    });
    const march = marchDraw(draws);
    const composite = drawAt(draws, -1);
    expect(composite.uniforms.tSlab?.value).toBe(slabTexture);
    expect(composite.snapshot).toMatchObject({
      uShellWeight: 1,
      uSlabWeight: 0.05,
    });
    // Half of the first tenth of the slab's share: smoothstep(0.5) = 0.5.
    expect(march.snapshot.uFlatten).toBeCloseTo(0.8 * 0.5, 12);
    expect(march.uniforms.uDiscRadiusKm?.value).toBe(20);
    // The disc's far edge from the origin: 5 km + 20 km, squared over 2R.
    expect(march.uniforms.uFlatRiseKm?.value).toBeCloseTo(
      (25 * 25) / (2 * EARTH_ATMOSPHERE.groundRadiusKm),
      9,
    );
    draws.length = 0;
    shell.render(camera(), { ...renderOptions, disc });
    expect(drawAt(draws, -1).snapshot.uSlabWeight).toBe(0);
    expect(marchDraw(draws).snapshot.uFlatten).toBe(0);
  });

  it("ends the rays at the relief's depth only while it is fresh and weighted", () => {
    const fresh = setUp({ depthFresh: true });
    fresh.shell.setEnabled(true);
    fresh.shell.update(frameAt());
    fresh.shell.render(camera(), { ...renderOptions, sceneDepthWeight: 0.6 });
    const u = marchDraw(fresh.draws).uniforms;
    expect(u.uSceneDepthWeight?.value).toBe(0.6);
    expect(u.uSceneDepth?.value).toBe(fresh.sceneDepth.texture);
    const stale = setUp({ depthFresh: false });
    stale.shell.setEnabled(true);
    stale.shell.update(frameAt());
    stale.shell.render(camera(), { ...renderOptions, sceneDepthWeight: 0.6 });
    expect(marchDraw(stale.draws).uniforms.uSceneDepthWeight?.value).toBe(0);
  });

  it("shares the surface's map, drift and opacity and the sky's lattice and amplitudes by identity", () => {
    const { shell, draws, surfaceUniforms, groundSky } = setUp();
    shell.setEnabled(true);
    shell.update(frameAt());
    shell.render(camera(), renderOptions);
    const u = marchDraw(draws).uniforms;
    expect(u.uClouds).toBe(surfaceUniforms.uClouds);
    expect(u.uCloudCubic).toBe(surfaceUniforms.uCloudCubic);
    expect(u.uCloudOpacity).toBe(surfaceUniforms.uCloudOpacity);
    expect(u.uShellLonOffset).toBe(surfaceUniforms.uCloudLonOffset);
    expect(u.uLattice).toBe(groundSky.cloudUniforms.atmCloudLattice);
    expect(u.uAmp).toBe(groundSky.cloudUniforms.atmCloudLiveAmp);
    expect(u.atmTransmittanceLut?.value).toBe(lut);
    expect(
      (u.uZenith?.value as THREE.Vector3[]).map((v) => v.toArray()),
    ).toEqual(ZENITH_TABLE.map((rgb) => [...rgb]));
    expect(u.uRadiance?.value).toBeGreaterThan(0);
  });

  it("sizes its targets by the resolution and refuses one outside 0.25-1", () => {
    const { shell, draws } = setUp();
    expect(() => shell.setResolution(0.2)).toThrow(RangeError);
    expect(() => shell.setResolution(1.1)).toThrow(RangeError);
    expect(() => shell.setResolution(Number.NaN)).toThrow(RangeError);
    shell.setResolution(0.5);
    shell.setEnabled(true);
    shell.update(frameAt());
    shell.render(camera(), renderOptions);
    expect(marchDraw(draws).into?.width).toBe(4);
    expect(marchDraw(draws).into?.height).toBe(2);
    expect(shell.state().resolution).toBe(0.5);
  });

  it("reads back nothing before a frame, then its bands and grids; the shadow grid is zeros while off", () => {
    const { shell } = setUp();
    expect(shell.readBack()).toBeNull();
    expect(shell.alphaGrid(2, 2)).toBeNull();
    shell.setEnabled(true);
    shell.update(frameAt());
    shell.render(camera(), renderOptions);
    // 8 x 4: the bottom row 1, the left half above it 0.5.
    expect(shell.readBack(2)).toEqual([
      { meanAlpha: (8 + 2) / 16, over: 12 / 16 },
      { meanAlpha: 4 / 16, over: 8 / 16 },
    ]);
    expect(shell.alphaGrid(2, 4)).toEqual([1, 1, 0.5, 0, 0.5, 0, 0.5, 0]);
    expect(shell.alphaGrid(3, 1, "shadow")).toEqual([0, 0, 0]);
  });

  it("toggles idempotently and disposes its targets and materials", () => {
    const { shell, draws } = setUp();
    shell.setEnabled(true);
    shell.setEnabled(true);
    expect(shell.enabled).toBe(true);
    shell.update(frameAt({ shadow: 0.3, highLayer: { on: true } }));
    shell.render(camera(), renderOptions);
    const disposed: string[] = [];
    for (const d of draws) {
      d.into?.addEventListener("dispose", () => disposed.push("target"));
    }
    shell.dispose();
    expect(disposed).toEqual(["target", "target", "target"]);
    shell.setEnabled(false);
    expect(shell.enabled).toBe(false);
  });
});
