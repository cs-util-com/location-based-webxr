/**
 * The default clouds of a globe view (the slab near the ground, the
 * spherical shell above it, the high layer), characterized end to end
 * below the GPU: `createGlobeViewClouds` over the real cloud step and the
 * real shell pass, with a recording slab and a renderer that snapshots the
 * uniforms of every full-screen draw.
 *
 * Why this file matters: a refactor of the cloud layers must not move the
 * default look by a single uniform. These snapshots pin, at camera
 * heights from 400 km down to 3 km, what the view reports
 * (`state()`, `shell()`), what the step tells the slab and the shell, and
 * what the shell's march and composite are drawn with. Their pixels are the
 * editor's cloud spec and the lab's reference shots; this is the cheap,
 * deterministic half of that guard.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { createGlobeCloudShellVolume } from "./globe-cloud-shell-volume-pass.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";
import {
  createGlobeViewClouds,
  type CloudsParts,
  type CloudsView,
} from "./globe-view-clouds.js";

const MARCH_KEYS = [
  "uShadow",
  "uShadowPass",
  "uDeckBaseKm",
  "uDeckTopKm",
  "uThickness",
  "uNoiseShare",
  "uCoverGain",
  "uShellIn",
  "uBothSides",
  "uFlatten",
  "uAerial",
  "uSteps",
  "uOctaves",
  "uCells",
  "uFieldWeights",
] as const;

/** The composite's uniforms that weigh the default clouds. */
const COMPOSITE_KEYS = [
  "uShellWeight",
  "uSlabWeight",
  "uShadowOn",
  "uHighOn",
  "uHighInFront",
] as const;

/** Numbers to ten significant digits, vectors as arrays, recursively. */
function settle(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toPrecision(10)) : value;
  }
  if (value instanceof THREE.Vector2 || value instanceof THREE.Vector3) {
    return value.toArray().map(settle);
  }
  if (Array.isArray(value)) return value.map(settle);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, settle(v)]),
    );
  }
  return value;
}

interface Draw {
  kind: "march" | "composite";
  into: "target" | "canvas";
  uniforms: Record<string, unknown>;
}

/** A float-capable renderer that records each full-screen draw. */
function recordingRenderer() {
  const draws: Draw[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    getContext: () => ({
      NO_ERROR: 0,
      getError: () => 0,
      createBuffer: () => null,
      readPixels: () => undefined,
    }),
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
    getClearColor: (out: THREE.Color) => out.set(0x000000),
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    clear: () => undefined,
    render: (scene: THREE.Scene) => {
      const mesh = scene.children[0] as THREE.Mesh;
      const { uniforms } = mesh.material as THREE.ShaderMaterial;
      const kind = "tShell" in uniforms ? "composite" : "march";
      const keys = kind === "march" ? MARCH_KEYS : COMPOSITE_KEYS;
      draws.push({
        kind,
        into: target === null ? "canvas" : "target",
        uniforms: Object.fromEntries(
          keys.map((k) => [k, settle(uniforms[k]?.value)]),
        ),
      });
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    draws,
  };
}

/** A view whose camera stands `altitudeKm` over the equator, framed at 0, 0. */
function viewAt(altitudeKm: number) {
  let heightM = 0;
  const view = {
    renderer: {} as THREE.WebGLRenderer,
    camera: new THREE.PerspectiveCamera(60, 2, 1, 1e7),
    globe: {
      sunExposure: { value: 5 },
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
      position: new THREE.Vector3(
        WGS84_ELLIPSOID.radius.x + altitudeKm * 1000,
        0,
        0,
      ),
    }),
    frameTarget: () => ({ lat: 0, lng: 0 }),
  };
  // A fake: only what the clouds read and write of the view.
  return view as unknown as CloudsView & typeof view;
}

/** A slab that records what the step tells it, drawing a texture. */
function recordingSlab() {
  const told: Record<string, unknown>[] = [];
  const texture = new THREE.Texture();
  const slab = {
    setEnabled: (on: boolean) => told.push({ enabled: on }),
    setShadow: (on: boolean) => told.push({ shadow: on }),
    setNoise: (mode: string) => told.push({ noise: mode }),
    setFineGain: (gain: number) => told.push({ fineGain: gain }),
    update(frame: Record<string, unknown>) {
      const { view: _view, ...rest } = frame;
      told.push({ update: settle(rest) });
      return { share: 1, radiusM: 80_000 };
    },
    render: (
      _camera: unknown,
      _relief: unknown,
      _extra: unknown,
      options: unknown,
    ) => {
      told.push({ render: options });
      return true;
    },
    texture,
    patchShadow: () => undefined,
    state: () => ({ discCentre: null, deckY: 3000, radiusM: 80_000 }),
    dispose: () => undefined,
  };
  return { slab, told };
}

const sceneDepth = {
  texture: new THREE.DepthTexture(1, 1),
  camera: new THREE.PerspectiveCamera(),
  fresh: true,
  render: () => undefined,
  beginFrame: () => undefined,
  state: () => ({ frames: 0, fresh: true, near: 0.1 }),
  dispose: () => undefined,
} as unknown as GlobeSceneDepth;

/** One frame of the default clouds at `altitudeKm`, everything recorded. */
function frameAt(altitudeKm: number) {
  const { renderer, draws } = recordingRenderer();
  const sky = createGlobeGroundSky(renderer);
  if (sky.atmosphere === null) throw new Error("the fake renderer has floats");
  const shellVolume = createGlobeCloudShellVolume(renderer, {
    ellipsoid: WGS84_ELLIPSOID,
    surfaceUniforms: {
      uClouds: { value: new THREE.Texture() },
      uCloudCubic: { value: 1 },
      uCloudLonOffset: { value: 0.25 },
      uCloudOpacity: { value: 0.9 },
    },
    groundSky: sky.atmosphere,
    atmosphere: { transmittance: () => new THREE.Texture() },
    sceneDepth,
  });
  const { slab, told } = recordingSlab();
  const view = viewAt(altitudeKm);
  const clouds = createGlobeViewClouds(view, {
    sceneDepth,
    cloudVolume: slab,
    shellVolume,
  } as unknown as CloudsParts);
  clouds.patch({ group: new THREE.Group(), addEventListener() {} });
  clouds.step({ observerKm: altitudeKm, shareClouds: () => 1 });
  clouds.render({ weight: altitudeKm < 80 ? 1 : 0 });
  const { law, deckKm, high } = shellVolume.state();
  return {
    state: settle(clouds.state()),
    shell: settle(clouds.shell()),
    shellLaw: settle({ law, deckKm, high }),
    surfaceShadow: settle(view.globe.surfaceUniforms.uCloudShadow.value),
    cloudShellM: view.globe.cloudShell.heightM(),
    slab: told,
    draws,
  };
}

describe("the default clouds of a globe view", () => {
  // Why: the snapshot of each height is the default look's fingerprint
  // below the GPU; a change here is a change of the clouds' look and must
  // be a decision, never a side effect of a refactor.
  it.each([400, 120, 60, 20, 3])(
    "draws the slab and the shell at %d km as characterized",
    (altitudeKm) => {
      expect(frameAt(altitudeKm)).toMatchSnapshot();
    },
  );
});
