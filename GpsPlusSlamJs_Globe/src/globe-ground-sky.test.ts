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

import { AUTO_EXPOSURE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-exposure";

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
  nearLook: true,
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

  // Why this test matters: the ground's light is the sun through the whole
  // column of air down to the ground, whatever height the camera is at.
  // Measured at the camera's height a sun 3 degrees up looks nearly clear
  // from 40 km, and the ground under it burns out white. Swept over the
  // sun's height: it never rises as the sun sinks, it reddens, and it is
  // gone with the sun; above the edge the space view's white sun stands.
  it("hands the globe the sun that reached the ground", () => {
    const at = (deg: number, altitudeKm = 30) => {
      const r = (deg * Math.PI) / 180;
      const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
      sky.update({
        ...FRAME,
        altitudeKm,
        sunWorld: new THREE.Vector3(Math.cos(r), Math.sin(r), 0),
      });
      return sky.sunOnGround();
    };
    let last = Number.POSITIVE_INFINITY;
    for (const deg of [60, 30, 15, 8, 4, 2, 1, 0.5]) {
      const { scale } = at(deg);
      expect(scale).toBeLessThan(last);
      last = scale;
    }
    expect(at(60).scale).toBeGreaterThan(0.8);
    expect(at(3).scale).toBeLessThan(0.3);
    const [r, g, b] = at(3).colour;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(at(-3).scale).toBeLessThan(1e-3);
    expect(at(3, 40).scale).toBeCloseTo(at(3, 30).scale);
    expect(at(3, 100)).toEqual({ scale: 1, colour: [1, 1, 1] });
  });

  // The hand-over's middle lies between the two ends, so the light has no
  // step in it on the way down.
  it("eases the ground's sun by the weight", () => {
    const sunWorld = new THREE.Vector3(1, 0.05, 0).normalize();
    const at = (altitudeKm: number) => {
      const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
      sky.update({ ...FRAME, altitudeKm, sunWorld });
      return sky.sunOnGround();
    };
    const end = at(40);
    const middle = at(60);
    expect(middle.scale).toBeCloseTo(Math.sqrt(end.scale));
    expect(middle.colour[2]).toBeCloseTo((1 + end.colour[2]) / 2);
  });

  // Why this test matters: the sky's own sun moves in steps of a quarter of
  // a degree, and below 1 degree one such step is a jump of up to 2.7 times
  // in the ground's light. The ground's sun follows every frame.
  it("follows the sun between the sky's steps", () => {
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return new THREE.Vector3(Math.cos(r), Math.sin(r), 0);
    };
    const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
    sky.update({ ...FRAME, altitudeKm: 30, sunWorld: at(1) });
    const before = sky.sunOnGround().scale;
    sky.update({ ...FRAME, altitudeKm: 30, sunWorld: at(1.1) });
    expect(sky.sunOnGround().scale).toBeGreaterThan(before);
  });

  // Why this test matters: the old clouds are the editor's default look
  // (the near clouds are experimental, `?clouds=new`), so neither the
  // light nor the camera may change under them.
  it("leaves the old clouds' sun and camera as they were", () => {
    const r = (3 * Math.PI) / 180;
    const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
    sky.update({
      ...FRAME,
      nearLook: false,
      altitudeKm: 10,
      sunWorld: new THREE.Vector3(Math.cos(r), Math.sin(r), 0),
    });
    expect(sky.sunOnGround()).toEqual({ scale: 1, colour: [1, 1, 1] });
    expect(sky.atmosphere?.autoExposureAdaptation).toBe(
      AUTO_EXPOSURE.adaptation,
    );
    sky.update({ ...FRAME, altitudeKm: 10 });
    expect(sky.atmosphere?.autoExposureAdaptation).toBe(
      GLOBE_SKY_HAND_OVER.exposureAdaptation,
    );
  });

  it("keeps a white sun without its sky", () => {
    const sky = createGlobeGroundSky(fakeRenderer(false).renderer);
    sky.update({ ...FRAME, altitudeKm: 10 });
    expect(sky.sunOnGround()).toEqual({ scale: 1, colour: [1, 1, 1] });
  });

  // Why this test matters: the framework's camera adapts by 0.75, right for
  // a street (OsmDemo), and from the air it drives the frame to white at a
  // low sun, because the clouds and the air above the ground are not on the
  // same scale. Swept 0, 0.3, 0.5 with the sun about 1 degree up: 0 is black
  // ground at 9 km, 0.5 washes 9 km out pale, 0.3 keeps a dusk.
  it("adapts the camera far less than the framework's street default", () => {
    const sky = createGlobeGroundSky(fakeRenderer(true).renderer);
    sky.update({ ...FRAME, altitudeKm: 10 });
    expect(sky.atmosphere?.autoExposureAdaptation).toBeLessThan(
      AUTO_EXPOSURE.adaptation,
    );
  });
});
