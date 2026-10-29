/**
 * The cloud volume's drawing pass, moved out of the globe lab.
 *
 * Why this file matters: the volume turns the ground sky's framework slab
 * on and off, hands it the globe's cloud map, a disc, a reach and a lift
 * every frame, and draws it into its own target over the Earth. A switch
 * that left the slab's coverage or disc behind would paint the old clouds
 * over the dome; a reach handed every frame would rebuild the slab's
 * uniforms needlessly; a pass that left the clear colour or the sky's
 * other children changed would break the next frame. These tests pin what
 * the lab did, under Node, with the real framework sky from
 * `createGlobeGroundSky` and a recording fake renderer. The clouds' look is
 * the lab's smokes and the reference captures.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { CLOUD_SLAB } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-slab";

import { cloudVolumeShare } from "./globe-cloud-volume.js";
import { createGlobeCloudVolume } from "./globe-cloud-volume-pass.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";
import type { GlobeSceneDepth } from "./globe-scene-depth.js";

/** A float-capable renderer that records its draws and clear colours. */
const fakeRenderer = () => {
  const log: string[] = [];
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
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(4, 2),
    getClearColor: (out: THREE.Color) => out.copy(clear),
    getClearAlpha: () => clearAlpha,
    setClearColor: (colour: THREE.ColorRepresentation, alpha: number) => {
      clear.set(colour);
      clearAlpha = alpha;
      log.push(`clearColour ${clear.getHexString()} ${alpha}`);
    },
    clear: () => {
      log.push("clear");
    },
    render: (scene: THREE.Scene, camera: THREE.Camera) => {
      const shown = scene.children
        .filter((c) => c.visible)
        .map((c) => c.name || c.type);
      log.push(
        `render ${shown.join("+")} at y ${camera.position.y.toFixed(0)} into ${target ? "target" : "canvas"}`,
      );
    },
    readRenderTargetPixels: (
      t: THREE.WebGLRenderTarget,
      _x: number,
      _y: number,
      w: number,
      h: number,
      out: Uint16Array,
    ) => {
      // Alpha 1 in the bottom row, 0 above it.
      for (let i = 0; i < w * h; i++) {
        out[i * 4 + 3] =
          i < t.width
            ? THREE.DataUtils.toHalfFloat(1)
            : THREE.DataUtils.toHalfFloat(0);
      }
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, log };
};

/** A scene depth that records its draws (the real one is tested on its own). */
const fakeDepth = (log: string[]) => {
  let fresh = false;
  const camera = new THREE.PerspectiveCamera();
  return {
    texture: new THREE.DepthTexture(1, 1),
    camera,
    render(view: THREE.PerspectiveCamera) {
      camera.copy(view);
      fresh = true;
      log.push("depth");
    },
    beginFrame() {
      fresh = false;
    },
    get fresh() {
      return fresh;
    },
    state: () => ({ frames: 0, fresh, near: camera.near }),
    dispose: () => undefined,
  } as GlobeSceneDepth;
};

const setUp = () => {
  const { renderer, log } = fakeRenderer();
  const sky = createGlobeGroundSky(renderer);
  const atmosphere = sky.atmosphere;
  if (atmosphere === null) throw new Error("the fake renderer has floats");
  const surfaceUniforms = {
    uClouds: { value: new THREE.Texture() },
    uCloudCubic: { value: 0 },
    uCloudLonOffset: { value: 0.25 },
    uCloudOpacity: { value: 1 },
  };
  const sceneDepth = fakeDepth(log);
  const volume = createGlobeCloudVolume(renderer, {
    atmosphere,
    skyScene: sky.scene,
    surfaceUniforms,
    sceneDepth,
  });
  return { volume, atmosphere, sky, log, surfaceUniforms, sceneDepth };
};

const FRAME = {
  altitudeKm: 5,
  target: { lat: 45, lng: 7 },
  radiusKm: 30,
  ceilingKm: 40,
  shellHeightM: 3000,
};

describe("createGlobeCloudVolume", () => {
  // Off, the volume draws nothing and hands the slab nothing; its share
  // and disc are 0 whatever the altitude.
  it("draws nothing while off", () => {
    const { volume, log } = setUp();
    expect(volume.update(FRAME)).toEqual({ share: 0, radiusM: 0 });
    expect(
      volume.render(new THREE.PerspectiveCamera(), new THREE.Group()),
    ).toBe(false);
    expect(log).toEqual([]);
    expect(volume.coverage()).toBeNull();
    expect(volume.rows(4)).toBeNull();
    expect(volume.alphaGrid(2, 2)).toBeNull();
    expect(volume.state()).toMatchObject({
      enabled: false,
      share: 0,
      radiusM: 0,
      drawn: 0,
      shadow: false,
      noise: "tile",
      hex: false,
    });
  });

  // On, the sky's clouds become the slab with the globe's coverage and the
  // relief's depth; off again, every hand-over is taken back and the dome
  // returns. Both directions are idempotent.
  it("turns the slab on with the globe's coverage and takes every hand-over back off", () => {
    const { volume, atmosphere, sceneDepth } = setUp();
    const coverage = vi.spyOn(atmosphere, "setCloudCoverage");
    const depth = vi.spyOn(atmosphere, "setCloudSceneDepth");
    const disc = vi.spyOn(atmosphere, "setCloudDiscRadius");
    const reach = vi.spyOn(atmosphere, "setCloudReach");
    const aerial = vi.spyOn(atmosphere, "setCloudAerial");
    const centre = vi.spyOn(atmosphere, "setCloudDiscCentre");
    volume.setEnabled(true);
    volume.setEnabled(true);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(coverage.mock.calls[0]?.[0]).toMatchObject({
      uniforms: { uVolumeShare: { value: 0 }, uVolumeGain: { value: 1 } },
    });
    expect(depth).toHaveBeenCalledWith(sceneDepth.texture);
    volume.setEnabled(false);
    volume.setEnabled(false);
    expect(coverage).toHaveBeenLastCalledWith(null);
    expect(depth).toHaveBeenLastCalledWith(null);
    for (const spy of [disc, reach, aerial, centre]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith(null);
    }
    expect(volume.state().enabled).toBe(false);
  });

  // The share is the altitude's (fade capped at the ceiling), the disc its
  // radius times the share, the lift the shell's height minus the slab's
  // middle; mixed with the spherical volume, the disc is whole and the
  // aerial fade comes in with the share cubed.
  it("sizes the disc by the altitude's share and lifts the slab to the shell", () => {
    const { volume, atmosphere } = setUp();
    const aerial = vi.spyOn(atmosphere, "setCloudAerial");
    volume.setEnabled(true);
    const share = cloudVolumeShare(35, { ceilingKm: 40, fadeKm: 10 });
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(volume.update({ ...FRAME, altitudeKm: 35 })).toEqual({
      share,
      radiusM: 30_000 * share,
    });
    expect(aerial).toHaveBeenLastCalledWith(null);
    expect(volume.state().liftM).toBe(
      3000 - (CLOUD_SLAB.baseM + CLOUD_SLAB.topM) / 2,
    );
    expect(volume.update({ ...FRAME, altitudeKm: 35, mixed: true })).toEqual({
      share,
      radiusM: 30_000,
    });
    expect(aerial).toHaveBeenLastCalledWith(share ** 3);
    // A fade larger than the ceiling is capped at it.
    expect(
      volume.update({ ...FRAME, altitudeKm: 2, ceilingKm: 4, fadeKm: 10 })
        .share,
    ).toBe(cloudVolumeShare(2, { ceilingKm: 4, fadeKm: 4 }));
    expect(volume.update({ ...FRAME, target: null }).share).toBe(0);
  });

  // The reach follows the disc in whole kilometres, never below the slab's
  // default, and is handed over only when it changes.
  it("moves the slab's reach in 1 km steps, only when it changes", () => {
    const { volume, atmosphere } = setUp();
    const reach = vi.spyOn(atmosphere, "setCloudReach");
    volume.setEnabled(true);
    volume.update({ ...FRAME, radiusKm: 30.2 });
    volume.update({ ...FRAME, radiusKm: 30.4 });
    expect(reach).toHaveBeenCalledTimes(1);
    expect(reach).toHaveBeenLastCalledWith({
      farStartM: (2 / 3) * 31_000,
      farEndM: 31_000,
    });
    volume.update({ ...FRAME, radiusKm: 1 });
    const last = reach.mock.calls.at(-1)?.[0];
    expect(last?.farEndM).toBeGreaterThanOrEqual(21_000);
    expect((last?.farEndM ?? 0) % 1000).toBe(0);
  });

  // The disc's centre moves ahead along the view to the deck only when a
  // reach ahead is given; without one it stays on the camera.
  it("centres the disc ahead along the view only with a reach ahead", () => {
    const { volume, atmosphere } = setUp();
    const centre = vi.spyOn(atmosphere, "setCloudDiscCentre");
    volume.setEnabled(true);
    const view = {
      position: [0, 5000, 0] as const,
      direction: [0, -Math.SQRT1_2, Math.SQRT1_2] as const,
    };
    volume.update({ ...FRAME, view });
    expect(centre).toHaveBeenLastCalledWith(null);
    volume.update({ ...FRAME, view, maxAheadM: 10_000 });
    const c = centre.mock.calls.at(-1)?.[0];
    expect(c?.x).toBeCloseTo(0, 6);
    expect(c?.z).toBeCloseTo(2000, 6);
    expect(volume.state()).toMatchObject({ discCentre: c, deckY: 3000 });
    expect(volume.state().aheadM).toBeGreaterThan(0);
  });

  // The noise is anchored to the ground: a recentre carries the offset,
  // and the live anchor is handed over every frame while on.
  it("hands the noise offset and the live anchor over every frame while on", () => {
    const { volume, atmosphere } = setUp();
    const anchor = vi.spyOn(atmosphere, "setCloudNoiseAnchor");
    volume.update(FRAME);
    expect(anchor).not.toHaveBeenCalled();
    volume.setEnabled(true);
    volume.update(FRAME);
    const first = atmosphere.cloudUniforms.atmCloudOffset.value.clone();
    volume.update({ ...FRAME, target: { lat: 45.1, lng: 7 } });
    expect(anchor).toHaveBeenCalledTimes(2);
    const second = atmosphere.cloudUniforms.atmCloudOffset.value;
    expect(second.equals(first)).toBe(false);
  });

  // The draw: the depth (unless already drawn this frame), the slab alone
  // from the lifted camera into the cleared target with a clear colour of
  // transparent black, then the colour and the sky's other children given
  // back and the composite onto the canvas; `composite: false` skips it.
  it("draws the depth, the slab alone from the lifted camera, then the composite", () => {
    const { volume, sky, log, sceneDepth } = setUp();
    volume.setEnabled(true);
    volume.update(FRAME);
    const slab = sky.scene.getObjectByName("atmosphere-cloud-slab");
    expect(slab).toBeDefined();
    const others = sky.scene.children.filter((c) => c !== slab && c.visible);
    const camera = new THREE.PerspectiveCamera();
    camera.position.y = 5000;
    log.length = 0;
    expect(volume.render(camera, new THREE.Group())).toBe(true);
    const lift = 3000 - (CLOUD_SLAB.baseM + CLOUD_SLAB.topM) / 2;
    expect(log).toEqual([
      "depth",
      "clearColour 000000 0",
      "clear",
      `render atmosphere-cloud-slab at y ${(5000 - lift).toFixed(0)} into target`,
      "clearColour 123456 1",
      "render Mesh at y 0 into canvas",
    ]);
    for (const c of others) expect(c.visible).toBe(true);
    log.length = 0;
    expect(
      volume.render(camera, new THREE.Group(), [], { composite: false }),
    ).toBe(true);
    expect(log).not.toContain("depth");
    expect(log.filter((l) => l.startsWith("render"))).toEqual([
      `render atmosphere-cloud-slab at y ${(5000 - lift).toFixed(0)} into target`,
    ]);
    expect(sceneDepth.fresh).toBe(true);
    expect(volume.state().drawn).toBe(2);
  });

  // The debug read-backs: the fake's bottom row is opaque, the rest clear.
  it("reads the last frame back by share, bands and grid", () => {
    const { volume } = setUp();
    volume.setEnabled(true);
    volume.update(FRAME);
    volume.render(new THREE.PerspectiveCamera(), new THREE.Group());
    expect(volume.coverage()).toEqual({
      share: 0.5,
      lowerShare: 1,
      maxAlpha: 1,
    });
    expect(volume.rows(2)).toEqual([
      { meanAlpha: 1, over: 1 },
      { meanAlpha: 0, over: 0 },
    ]);
    expect(volume.alphaGrid(2, 2)).toEqual([1, 1, 0, 0]);
  });

  // The noise switch reconfigures the sky once per change; the older hex
  // switch is the same switch. The fine gain is handed over only on change.
  it("switches the noise and the fine gain idempotently", () => {
    const { volume, atmosphere } = setUp();
    const configure = vi.spyOn(atmosphere, "configure");
    volume.setHex(true);
    volume.setNoise("hex");
    expect(configure).toHaveBeenCalledTimes(1);
    expect(volume.state()).toMatchObject({ noise: "hex", hex: true });
    volume.setNoise("live");
    volume.setHex(false);
    expect(volume.state()).toMatchObject({ noise: "tile", hex: false });
    expect(configure).toHaveBeenCalledTimes(3);
    configure.mockClear();
    volume.setFineGain(atmosphere.cloudNoiseFineGain);
    expect(configure).not.toHaveBeenCalled();
    const gain = atmosphere.cloudNoiseFineGain / 2;
    volume.setFineGain(gain);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(volume.state().fineGain).toBe(gain);
  });

  // The shadow is reported on only while asked for, on and with a disc;
  // tiles loaded from now on are patched with it.
  it("reports its shadow only while asked, on and with a disc, and patches loaded tiles", () => {
    const { volume } = setUp();
    volume.setShadow(true);
    volume.update(FRAME);
    expect(volume.state().shadow).toBe(false);
    volume.setEnabled(true);
    volume.update(FRAME);
    expect(volume.state().shadow).toBe(true);
    let listener: ((e: { scene: THREE.Object3D }) => void) | undefined;
    volume.patchShadow({
      addEventListener: (_type, l) => {
        listener = l;
      },
    });
    expect(listener).toBeDefined();
    const model = new THREE.Group();
    model.add(
      new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial(),
      ),
    );
    expect(() => listener?.({ scene: model })).not.toThrow();
    volume.dispose();
  });
});
