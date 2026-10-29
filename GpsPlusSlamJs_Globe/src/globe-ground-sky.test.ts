/**
 * The ground sky, moved out of the globe lab.
 *
 * Why this file matters: below the hand-over edge the ground sky takes the
 * sky's pixels, and its one eased exposure is also the globe's sun. These
 * tests pin, under Node with a recording fake renderer, what the lab did:
 * the space view's values where the sky cannot run or is not working (no
 * float targets, no local frame, above edge plus width), the weight and
 * the eased exposure where it works, the staged rebuild's stages counted,
 * and the draw (nothing at weight 0; the sky into its target, the slab
 * hidden for it, then the composite with the weight). The look itself is
 * the lab's smokes and the reference captures.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGlobeGroundSky } from "./globe-ground-sky.js";
import {
  GLOBE_SKY_HAND_OVER,
  easedExposure,
  groundSkyWeight,
} from "./globe-sky-hand-over.js";

/** A renderer that records its draws; `float` says whether it has float targets. */
const fakeRenderer = (float: boolean) => {
  const log: string[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  // The staged rebuild's read-back reaches for the GL context: one
  // without errors whose buffers cannot be made, so no read is pending.
  const gl = {
    NO_ERROR: 0,
    getError: () => 0,
    createBuffer: () => null,
    readPixels: () => undefined,
  };
  const renderer = {
    getContext: () => gl,
    extensions: { has: () => float },
    domElement: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(320, 200),
    clear: () => {
      log.push("clear");
    },
    render: (scene: THREE.Scene) => {
      log.push(
        `render ${scene.userData.role ?? "other"} into ${target ? "target" : "canvas"}`,
      );
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, log };
};

const FRAME = {
  sunWorld: new THREE.Vector3(0, 1, 0),
  framed: true,
  edgeKm: 80,
  widthKm: 40,
  stepPct: 5,
  spaceExposure: 5,
};

describe("createGlobeGroundSky", () => {
  // No float targets: the framework sky cannot run, the lab keeps the
  // space sky all the way down.
  it("is unsupported without float targets and keeps the space view's values", () => {
    const { renderer, log } = fakeRenderer(false);
    const sky = createGlobeGroundSky(renderer);
    expect(sky.supported).toBe(false);
    expect(sky.atmosphere).toBeNull();
    expect(sky.update({ ...FRAME, altitudeKm: 10 })).toEqual({
      weight: 0,
      exposure: 5,
    });
    sky.render(new THREE.PerspectiveCamera());
    expect(log).toEqual([]);
    expect(sky.state()).toMatchObject({
      supported: false,
      weight: 0,
      exposure: 5,
      automaticExposure: 1,
      observerKm: null,
      rebuildPending: false,
      lastStage: "idle",
      rebuilds: { luts: 0, waiting: 0, read: 0, bake: 0 },
    });
  });

  // Before a target the world is ECEF, where a flat sky's "up" means
  // nothing; above the edge plus its width it does not work at all.
  it("does not work outside the local frame or above the edge's reach", () => {
    for (const frame of [
      { ...FRAME, altitudeKm: 10, framed: false },
      { ...FRAME, altitudeKm: 120 },
    ]) {
      const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
      expect(sky.supported).toBe(true);
      expect(sky.update(frame)).toEqual({ weight: 0, exposure: 5 });
      expect(sky.state().lastStage).toBe("idle");
      expect(sky.state().observerKm).toBe(
        GLOBE_SKY_HAND_OVER.observerCeilingKm,
      );
    }
  });

  // Below the edge: the hand-over's weight, ONE eased exposure between the
  // space view's and the sky's automatic one, the rebuild stepped and
  // counted, the observer moved.
  it("weighs and eases the exposure below the edge, stepping the rebuild", () => {
    const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
    const hand = sky.update({ ...FRAME, altitudeKm: 60 });
    const weight = groundSkyWeight(60, { edgeKm: 80, widthKm: 40 });
    expect(hand.weight).toBe(weight);
    const state = sky.state();
    expect(hand.exposure).toBeCloseTo(
      easedExposure(5, state.automaticExposure, weight),
      12,
    );
    expect(state.lastStage).not.toBe("idle");
    const counted = Object.values(state.rebuilds).reduce((a, b) => a + b, 0);
    expect(counted).toBe(1);
    expect(state.observerKm).not.toBe(GLOBE_SKY_HAND_OVER.observerCeilingKm);
  });

  // The draw: the sky into its own target with the cloud slab hidden (it
  // draws after the Earth), the slab's visibility restored, the composite
  // to the canvas with the weight; nothing at weight 0.
  it("draws into its target and composites with the weight, never at 0", () => {
    const { renderer, log } = fakeRenderer(true);
    const sky = createGlobeGroundSky(renderer);
    sky.scene.userData.role = "sky";
    const slab = new THREE.Object3D();
    slab.name = "atmosphere-cloud-slab";
    slab.visible = true;
    let slabSeen: boolean | null = null;
    slab.onBeforeRender = () => undefined;
    sky.scene.add(slab);
    const camera = new THREE.PerspectiveCamera();
    sky.render(camera);
    expect(log).toEqual([]);
    sky.update({ ...FRAME, altitudeKm: 30 });
    log.length = 0;
    const realRender = renderer.render.bind(renderer);
    renderer.render = (scene: THREE.Object3D, cam: THREE.Camera) => {
      if (scene === sky.scene) slabSeen = slab.visible;
      realRender(scene, cam);
    };
    sky.render(camera);
    expect(log).toEqual([
      "clear",
      "render sky into target",
      "render other into canvas",
    ]);
    expect(slabSeen).toBe(false);
    expect(slab.visible).toBe(true);
  });
});
