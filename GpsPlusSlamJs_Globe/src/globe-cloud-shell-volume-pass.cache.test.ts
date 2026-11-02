/**
 * The spherical cloud volume's per-frame noise basis and the framework's
 * resolved-field cache.
 *
 * Why this file matters: `cloudLiveBasis` caches the field it resolves
 * from its options, keyed by the options object itself. A pass that hands
 * it a fresh `{}` for each scaled field and for the high layer misses that
 * cache on every call and recomputes the field (a mean over the whole
 * 1024 x 1024 lattice) up to three times a frame: in a browser that was
 * most of the frame's CPU time above 60 km, for an image that is the same
 * with the defaults. This pins that every call of a pass hands the same
 * options (so the cache keeps one entry), over two frames with a scaled
 * cascade and the high layer on. Its own file: it mocks a module.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it, vi } from "vitest";

import { cloudLiveBasis } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise";
import type * as CloudLiveNoise from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise";

import {
  CLOUD_SHELL_VOLUME,
  type CloudShellNoiseCascade,
} from "./globe-cloud-shell-volume.js";
import {
  type CloudShellVolumeFrame,
  createGlobeCloudShellVolume,
} from "./globe-cloud-shell-volume-pass.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";

vi.mock(
  "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise",
  async (importOriginal) => {
    const real = await importOriginal<typeof CloudLiveNoise>();
    return { ...real, cloudLiveBasis: vi.fn(real.cloudLiveBasis) };
  },
);

/** A float-capable renderer that draws nothing. */
const fakeRenderer = () => {
  let target: THREE.WebGLRenderTarget | null = null;
  const gl = {
    NO_ERROR: 0,
    getError: () => 0,
    createBuffer: () => null,
    readPixels: () => undefined,
  };
  return {
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
    getClearColor: (out: THREE.Color) => out,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    clear: () => undefined,
    render: () => undefined,
  } as unknown as THREE.WebGLRenderer;
};

const sceneDepth = {
  texture: new THREE.DepthTexture(1, 1),
  camera: new THREE.PerspectiveCamera(),
  fresh: true,
  render: () => undefined,
  beginFrame: () => undefined,
  state: () => ({ frames: 0, fresh: true, near: 0.1 }),
  dispose: () => undefined,
} as unknown as GlobeSceneDepth;

describe("the spherical cloud volume's noise basis", () => {
  it("asks for the live basis with one options object, so its cache holds", () => {
    const renderer = fakeRenderer();
    const groundSky = createGlobeGroundSky(renderer).atmosphere;
    if (groundSky === null) throw new Error("the fake renderer has floats");
    const shell = createGlobeCloudShellVolume(renderer, {
      ellipsoid: WGS84_ELLIPSOID,
      surfaceUniforms: {
        uClouds: { value: new THREE.Texture() },
        uCloudCubic: { value: 1 },
        uCloudLonOffset: { value: 0.25 },
        uCloudOpacity: { value: 0.9 },
      },
      groundSky,
      atmosphere: { transmittance: () => new THREE.Texture() },
      sceneDepth,
    });
    const cascade: CloudShellNoiseCascade = {
      index: 0,
      fields: [
        { scale: 2, offsetCells: [5, 6] },
        { scale: 4, offsetCells: [173, 97] },
      ],
      weights: [0.6, 0.8],
    };
    const frame: CloudShellVolumeFrame = {
      altitudeKm: 300,
      shares: { shellIn: 1, shell: 0.75, slab: 0.25 },
      stations: CLOUD_SHELL_VOLUME.stations,
      target: { lat: 45, lng: 7 },
      deckKm: 3,
      cascade,
      highLayer: { on: true },
    };
    shell.setEnabled(true);
    const basis = vi.mocked(cloudLiveBasis);
    basis.mockClear();
    shell.update(frame);
    shell.update({ ...frame, target: { lat: 45.01, lng: 7.01 } });
    // Both scaled fields and the high layer, on both frames.
    expect(basis.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(new Set(basis.mock.calls.map((c) => c[1])).size).toBe(1);
    shell.dispose();
  });
});
