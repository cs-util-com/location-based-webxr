/**
 * The air's per-frame wiring, moved out of the globe lab.
 *
 * Why this file matters: the descent from space swaps the space pass's sky
 * for the framework's ground sky, and every drawer involved reads one
 * number from this wiring: the observer's height, the ground sky's weight
 * and the sun's eased intensity. The lab moved it here as a pure refactor,
 * so these tests pin what the lab did: which drawer is told what, in which
 * order, and what is left alone (the ground sky when the page turns it off,
 * the haze's sync between the ground sky's reads, the shell's look when its
 * thickness has not changed).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGlobeAir } from "./globe-air.js";
import { observerAltitudeKm } from "./globe-atmosphere-frame.js";
import { shellThicknessAt } from "./globe-sky-hand-over.js";

const RADII = [6378137, 6378137, 6356752.314245] as const;
const GROUND_KM = 6360;

const PARAMS = {
  groundSky: 1,
  sky: 1,
  skyEdgeKm: 80,
  skyWidthKm: 40,
  skyStepPct: 5,
  sunIntensity: 5,
  hazeScale: 2,
  atmoRamp: 1,
  atmoThickness: 6,
  atmoGround: 1,
  atmoSteps: 12,
  atmoStrength: 1.5,
};

/** The air over recording fakes of the three drawers. */
const setup = (hand = { weight: 0.25, exposure: 4.5 }) => {
  const calls: string[] = [];
  let stage = "idle";
  const skyModel = { name: "sky" };
  const updates: unknown[] = [];
  const looks: unknown[] = [];
  const renders: unknown[] = [];
  const syncs: unknown[] = [];
  const weights: [number, number][] = [];
  const sun = { position: new THREE.Vector3(0, 0, 1), intensity: 0 };
  const globeGroup = {
    matrixWorld: new THREE.Matrix4().makeRotationX(Math.PI / 2),
  };
  const air = createGlobeAir({
    ellipsoidRadii: RADII,
    groundRadiusKm: GROUND_KM,
    sun,
    globeGroup,
    spacePass: {
      setLook: (look) => {
        calls.push("look");
        looks.push(look);
      },
      render: (_camera, frame) => {
        calls.push("render");
        renders.push(frame);
      },
    },
    groundSky: {
      atmosphere: skyModel,
      update: (frame) => {
        calls.push("update");
        updates.push({ ...frame, sunWorld: frame.sunWorld.toArray() });
        return hand;
      },
      state: () => {
        calls.push("state");
        return { lastStage: stage, rebuilds: 3 };
      },
    },
    haze: {
      sync: (model) => {
        calls.push("sync");
        syncs.push(model);
      },
      setWeight: (weight, scale) => {
        calls.push("weight");
        weights.push([weight, scale]);
      },
    },
  });
  const read = (s: string) => (stage = s);
  return {
    air,
    calls,
    updates,
    looks,
    renders,
    syncs,
    weights,
    sun,
    skyModel,
    read,
  };
};

const at = (altitudeM: number): [number, number, number] => [
  RADII[0] + altitudeM,
  0,
  0,
];

describe("createGlobeAir", () => {
  it("starts above everything: no weight, the observer at infinity", () => {
    const { air } = setup();
    expect(air.observerKm()).toBe(Number.POSITIVE_INFINITY);
    expect(air.weight()).toBe(0);
  });

  // The ground sky is fed the observer's height over the ellipsoid's
  // image, the sun turned into the world, and the width never wider than
  // the edge (a width past the edge would start the fade below 0 km).
  it("tells the ground sky the observer, the world sun and the narrowed width", () => {
    const { air, updates } = setup();
    air.step(
      { ...PARAMS, skyEdgeKm: 30 },
      { cameraEcef: at(20_000), framed: true },
    );
    const want = observerAltitudeKm(at(20_000), RADII, GROUND_KM);
    expect(air.observerKm()).toBe(want);
    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.altitudeKm).toBe(want);
    expect(update.framed).toBe(true);
    expect(update.edgeKm).toBe(30);
    expect(update.widthKm).toBe(30);
    expect(update.stepPct).toBe(5);
    expect(update.spaceExposure).toBe(5);
    // (0, 0, 1) turned a quarter about x is (0, -1, 0).
    const sunWorld = update.sunWorld as number[];
    expect(sunWorld[0]).toBeCloseTo(0, 12);
    expect(sunWorld[1]).toBeCloseTo(-1, 12);
    expect(sunWorld[2]).toBeCloseTo(0, 12);
    expect(air.weight()).toBe(0.25);
  });

  // `groundSky=0` or `sky=0`: the space view's values, the ground sky
  // never advanced (its rebuilds would cost frames for nothing).
  it("leaves the ground sky alone when the page turns it or the sky off", () => {
    for (const off of [{ groundSky: 0 }, { sky: 0 }]) {
      const { air, updates, weights, sun } = setup();
      air.step({ ...PARAMS, ...off }, { cameraEcef: at(1000), framed: true });
      expect(updates).toHaveLength(0);
      expect(air.weight()).toBe(0);
      expect(weights).toEqual([[0, 2]]);
      air.finish(PARAMS);
      expect(sun.intensity).toBe(5);
    }
  });

  // The haze copies the ground sky's state only after one of its reads
  // (anything else would sync half-built tables), and its strength every
  // frame, after the sync.
  it("syncs the haze after the ground sky's reads only, then weighs it", () => {
    const { air, calls, syncs, weights, read, skyModel } = setup();
    air.step(PARAMS, { cameraEcef: at(1000), framed: true });
    expect(syncs).toHaveLength(0);
    expect(calls).toEqual(["update", "state", "weight"]);
    read("read");
    calls.length = 0;
    air.step(PARAMS, { cameraEcef: at(1000), framed: true });
    expect(syncs).toEqual([skyModel]);
    expect(calls).toEqual(["update", "state", "sync", "weight"]);
    expect(weights).toEqual([
      [0.25, 2],
      [0.25, 2],
    ]);
  });

  // The sun's intensity is the eased exposure only from `finish` on: the
  // cloud volumes update between the two with the frame's old sun, as in
  // the lab.
  it("sets the sun's intensity in finish, not in step", () => {
    const { air, sun } = setup();
    air.step(PARAMS, { cameraEcef: at(1000), framed: true });
    expect(sun.intensity).toBe(0);
    air.finish(PARAMS);
    expect(sun.intensity).toBe(4.5);
  });

  // The shell thins on the way down with `atmoRamp=1` and keeps its far
  // thickness otherwise; its look (a shader rebuild) is set only when the
  // thickness changes.
  it("sets the shell's thickness by the ramp, and only when it changes", () => {
    const { air, looks } = setup();
    air.step(PARAMS, { cameraEcef: at(500_000), framed: true });
    air.finish(PARAMS);
    air.finish(PARAMS);
    const km = air.observerKm();
    expect(looks).toEqual([{ thickness: shellThicknessAt(km, 6) }]);
    air.finish({ ...PARAMS, atmoRamp: 0 });
    expect(looks).toEqual([
      { thickness: shellThicknessAt(km, 6) },
      { thickness: 6 },
    ]);
  });

  // A camera below the ellipsoid (a negative height) still gets the ground's
  // thickness. This cannot tell the wiring's clamp to 0 km from the ramp's
  // own: `shellThicknessAt` is already flat below its lower end.
  it("gives the ground's thickness below the ellipsoid", () => {
    const { air, looks } = setup();
    air.step(PARAMS, { cameraEcef: at(-200), framed: true });
    expect(air.observerKm()).toBeLessThan(0);
    air.finish(PARAMS);
    expect(looks).toEqual([{ thickness: shellThicknessAt(0, 6) }]);
  });

  // The page's live settings reach the space pass's look without its
  // thickness: the thickness is `finish`'s alone, which writes it only when
  // it changes. A live write of the far thickness (6 km) below the ramp
  // would leave the shell thick until the ramp next moved (a bug the lab
  // had: any slider or hash change set 6 under the 300 km ramp's 1).
  it("sets the live look without the thickness, which stays the ramp's", () => {
    const { air, looks } = setup();
    air.step(PARAMS, { cameraEcef: at(1000), framed: true });
    air.finish(PARAMS);
    air.setLook(PARAMS);
    air.finish(PARAMS);
    const ramped = shellThicknessAt(air.observerKm(), 6);
    expect(ramped).toBeLessThan(6);
    expect(looks).toEqual([
      { thickness: ramped },
      { steps: 12, strength: 1.5 },
    ]);
  });

  // The space pass's sky fades under the ground sky; its ground keeps its
  // veil unless `atmoGround=0`; the scene's depth weighs in with the
  // ground sky; nothing is drawn when the page has the pass off.
  it("renders the space pass with the hand-over's shares", () => {
    const { air, renders, sun } = setup();
    const camera = new THREE.PerspectiveCamera();
    const worldFromEcef = new THREE.Matrix4();
    const sunEcef = new THREE.Vector3(1, 0, 0);
    const sceneDepth = { depth: true };
    air.step(PARAMS, { cameraEcef: at(1000), framed: true });
    air.finish(PARAMS);
    const frame = { drawn: true, worldFromEcef, sunEcef, sceneDepth };
    air.render(camera, PARAMS, frame);
    air.render(camera, { ...PARAMS, atmoGround: 0 }, frame);
    air.render(camera, PARAMS, { ...frame, drawn: false });
    expect(renders).toEqual([
      {
        worldFromEcef,
        sunEcef,
        sunIntensity: sun.intensity,
        skyShare: 0.75,
        groundShare: 1,
        sceneDepth,
        sceneDepthWeight: 0.25,
      },
      {
        worldFromEcef,
        sunEcef,
        sunIntensity: 4.5,
        skyShare: 0.75,
        groundShare: 0.75,
        sceneDepth,
        sceneDepthWeight: 0.25,
      },
    ]);
  });

  it("reports the ground sky's state with the observer's height", () => {
    const { air, updates } = setup();
    air.step(PARAMS, { cameraEcef: at(2000), framed: false });
    // `framed` is passed through, not assumed.
    expect((updates[0] as Record<string, unknown>).framed).toBe(false);
    expect(air.groundSkyState()).toEqual({
      lastStage: "idle",
      rebuilds: 3,
      observerAltitudeKm: air.observerKm(),
    });
  });

  it("refuses a camera that is not finite", () => {
    const { air } = setup();
    expect(() =>
      air.step(PARAMS, { cameraEcef: [Number.NaN, 0, 0], framed: true }),
    ).toThrow(RangeError);
  });
});
