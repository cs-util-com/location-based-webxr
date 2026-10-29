/**
 * The globe's approach state, moved out of the globe lab.
 *
 * Why this file matters: the approach owns the camera from the page's
 * first frame until the user takes it: the spin while it waits for a
 * target, the fly-in to the target, the hold, the pin's dive and the
 * continuous flight. A wrong condition here is a fly-in that starts from
 * the night side, a late position that jumps instead of blending, a phase
 * history the smokes cannot read, or a dive that never reports its
 * landing. These tests pin the lab's sequence of phases, the poses it
 * returns at each phase and the values its state reports, with a fixed
 * sun and a clock the test sets.
 */
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  type ApproachOrbitStep,
  type ApproachPlacedStep,
  type ApproachStep,
  type GlobeApproachParams,
  SPIN_DEG_PER_S,
  approachRestartKey,
  createGlobeApproach,
  poseToward,
} from "./globe-approach.js";
import { orbitPose } from "./globe-camera.js";
import { diveStep, planDive } from "./globe-dive.js";
import { GLOBE_INTRO, introCameraPose, spinDirection } from "./globe-intro.js";
import { pressPin } from "./pin-flight.js";
import { GLOBE_FALLBACK_TARGET } from "./globe-target.js";

const BERN = { lat: 46.948, lng: 7.4474 };
const ZURICH = { lat: 47.3769, lng: 8.5417 };
const SUN = new THREE.Vector3(1, 0.2, 0.1).normalize();
const FIT_M = 20_000_000;
const ZOOM_OUT_M = 60_000_000;

const params = (
  over: Partial<GlobeApproachParams> = {},
): GlobeApproachParams => ({
  url: BERN,
  spinMs: 3000,
  turnMs: 5000,
  intro: "narrow",
  maxKm: 50_000,
  turnCap: 90,
  fovY: 50,
  pitchLow: 50,
  ...over,
});

/** An approach on WGS84 with a clock the test moves. */
function setup() {
  let now = 0;
  const approach = createGlobeApproach(WGS84_ELLIPSOID, {
    sunEcef: () => SUN,
    fitDistance: () => FIT_M,
    zoomOutM: () => ZOOM_OUT_M,
    now: () => now,
  });
  return {
    approach,
    at(ms: number) {
      now = ms;
      return ms;
    },
  };
}

const isOrbit = (s: ApproachStep): s is ApproachOrbitStep => "pose" in s;
const orbit = (s: ApproachStep): ApproachOrbitStep => {
  if (!isOrbit(s)) throw new Error("expected an orbit step");
  return s;
};
const placed = (s: ApproachStep): ApproachPlacedStep => {
  if (isOrbit(s)) throw new Error("expected a placed step");
  return s;
};
const dirOf = (s: ApproachStep) => orbit(s).pose.direction.toArray();

describe("createGlobeApproach: the spin", () => {
  it("restarts into the spin, waiting, with one run and one history entry", () => {
    const { approach, at } = setup();
    approach.restart(at(100), params({ url: undefined }));
    const s = approach.state();
    expect(s.phase).toBe("spin");
    expect(s.source).toBe("waiting");
    expect(s.target).toBeNull();
    expect(s.runs).toBe(1);
    expect(s.history).toEqual([{ phase: "spin", source: "waiting", atMs: 0 }]);
    expect(s.fixState).toBe("waiting");
    expect(s.flyInStart).toBeNull();
    expect(s.flyInBlendMs).toBeNull();
    expect(s.flyInSettled).toBe(false);
    expect(approach.drives).toBe(true);
  });

  it("spins over the sun at the zoom-out distance, at the variant's start field of view", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined }));
    const step = orbit(approach.pose(at(1000)));
    const expected = poseToward(
      spinDirection(SUN.toArray(), 1000, SPIN_DEG_PER_S),
    );
    expect(step.pose.direction.toArray()).toEqual(expected.direction.toArray());
    expect(step.pose.up.toArray()).toEqual(expected.up.toArray());
    expect(step.distanceM).toBe(ZOOM_OUT_M);
    // `narrow` starts wide (GLOBE_INTRO.wideFovDeg).
    expect(step.fovDeg).toBe(GLOBE_INTRO.wideFovDeg);
    expect(approach.state().phase).toBe("spin");
  });

  it("takes the fallback once the spin's wait ran out, blending from the shown spin", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined }));
    approach.pose(at(1000)); // a spin frame is shown
    approach.pose(at(3000));
    const s = approach.state();
    expect(s.phase).toBe("turning");
    expect(s.source).toBe("fallback");
    expect(s.target).toEqual(GLOBE_FALLBACK_TARGET);
    expect(s.flyInBlendMs).toBe(GLOBE_INTRO.lateFixBlendMs);
    expect(s.history.map((h) => [h.phase, h.source, h.atMs])).toEqual([
      ["spin", "waiting", 0],
      ["turning", "fallback", 3000],
    ]);
  });

  it("does not wait for a position that will not come", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined }));
    approach.noFixComing();
    approach.pose(at(10));
    expect(approach.state().source).toBe("fallback");
    expect(approach.state().fixState).toBe("none");
    // No spin frame was shown: the start does not blend.
    expect(approach.state().flyInBlendMs).toBe(0);
  });

  it("takes a position that arrives while it spins as the target", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined }));
    approach.pose(at(100));
    approach.setFix(ZURICH, at(200));
    // While spinning a fix only records the position.
    expect(approach.state().history).toHaveLength(1);
    approach.pose(at(300));
    expect(approach.state().source).toBe("fix");
    expect(approach.state().target).toEqual(ZURICH);
    expect(approach.state().fixState).toBe("fix");
  });
});

describe("createGlobeApproach: the fly-in and the hold", () => {
  it("flies from the zoom-out limit as introCameraPose says, keeping the first frame", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params());
    const first = orbit(approach.pose(at(0)));
    expect(approach.state().phase).toBe("turning");
    const start = approach.state().flyInStart;
    expect(start).not.toBeNull();
    const expected = introCameraPose(0, {
      variant: "narrow",
      start: start as [number, number, number],
      target: orbitPose(WGS84_ELLIPSOID, BERN).direction.toArray(),
      startKm: ZOOM_OUT_M / 1000,
      endKm: FIT_M / 1000,
      endFovDeg: 50,
    });
    expect(first.distanceM).toBeCloseTo(expected.distanceKm * 1000, 3);
    expect(first.fovDeg).toBeCloseTo(expected.fovDeg, 9);
    expect(approach.state().firstTurn).toEqual([...expected.direction]);
    // The frame loop reports where it placed that first frame, once.
    approach.cameraPlaced(123);
    approach.pose(at(100));
    approach.cameraPlaced(456);
    expect(approach.state().firstTurnDistanceM).toBe(123);
  });

  it("arrives exactly at the target at turnMs and holds it at the fitted distance", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params());
    approach.pose(at(0));
    const before = orbit(approach.pose(at(4999)));
    expect(approach.state().phase).toBe("turning");
    expect(before.distanceM).toBeGreaterThan(FIT_M);
    const held = orbit(approach.pose(at(5000)));
    const to = orbitPose(WGS84_ELLIPSOID, BERN);
    expect(approach.state().phase).toBe("arrived");
    expect(held.pose.direction.toArray()).toEqual(to.direction.toArray());
    expect(held.pose.up.toArray()).toEqual(to.up.toArray());
    expect(held.distanceM).toBeNull();
    expect(held.fovDeg).toBe(50);
    expect(approach.state().history.map((h) => h.phase)).toEqual([
      "spin",
      "turning",
      "arrived",
    ]);
  });

  it("with turnMs 0 arrives on its first frame", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ turnMs: 0 }));
    const held = orbit(approach.pose(at(0)));
    expect(approach.state().phase).toBe("arrived");
    expect(held.distanceM).toBeNull();
  });

  it("blends a fix that replaces the fallback over lateFixBlendMs, no jump", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined, turnMs: 0 }));
    approach.noFixComing();
    const fallback = dirOf(approach.pose(at(0)));
    approach.setFix(ZURICH, at(10));
    expect(approach.state().source).toBe("fix");
    expect(approach.state().target).toEqual(ZURICH);
    const just = dirOf(approach.pose(at(10)));
    just.forEach((v, i) => expect(v).toBeCloseTo(fallback[i] as number, 9));
    const end = dirOf(approach.pose(at(10 + GLOBE_INTRO.lateFixBlendMs)));
    expect(end).toEqual(orbitPose(WGS84_ELLIPSOID, ZURICH).direction.toArray());
  });

  it("ignores a fix while the target came from the link", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params());
    approach.pose(at(0));
    approach.setFix(ZURICH, at(10));
    expect(approach.state().source).toBe("url");
    expect(approach.state().fixState).toBe("fix");
  });

  it("reports the fly-in's blend as settled once its blend time passed", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ url: undefined }));
    approach.pose(at(100));
    approach.pose(at(3000)); // the fallback, blending 1.5 s
    expect(approach.state().flyInSettled).toBe(false);
    at(3000 + GLOBE_INTRO.lateFixBlendMs);
    expect(approach.state().flyInSettled).toBe(true);
  });
});

describe("createGlobeApproach: the user, the dive and the pin flight", () => {
  it("yields to the user once, and a restart gives the camera back", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params());
    approach.yieldToUser(at(50));
    approach.yieldToUser(at(60));
    expect(approach.drives).toBe(false);
    expect(approach.state().history.map((h) => [h.phase, h.atMs])).toEqual([
      ["spin", 0],
      ["user", 50],
    ]);
    approach.restart(at(100), params());
    expect(approach.drives).toBe(true);
    expect(approach.state().runs).toBe(2);
  });

  it("dives on the given clock, holds at a dive time, and lands once", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ turnMs: 0 }));
    approach.pose(at(0));
    const from = {
      pose: orbitPose(WGS84_ELLIPSOID, BERN),
      distanceM: FIT_M,
      quaternion: new THREE.Quaternion(),
    };
    const clockCalls: number[] = [];
    approach.dive(at(1000), ZURICH, from, {
      durationMs: 8000,
      toAltitudeM: 2000,
      clock: (ms) => {
        clockCalls.push(ms);
        return ms * 2;
      },
    });
    expect(approach.state().phase).toBe("diving");
    expect(approach.state().source).toBe("pin");
    expect(approach.state().target).toEqual(ZURICH);
    expect(approach.state().flyInStart).toBeNull();
    const plan = planDive(
      WGS84_ELLIPSOID,
      from,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { durationMs: 8000, toAltitudeM: 2000, pitchLowDeg: 50 },
    );
    const mid = placed(approach.pose(at(2000)));
    expect(clockCalls).toEqual([1000]);
    expect(mid.position.toArray()).toEqual(
      diveStep(plan, 2000).position.toArray(),
    );
    expect(approach.diveAltitudeAt(8000)).toBe(diveStep(plan, 8000).altitudeM);
    expect(approach.holdDiveAt(4000)).toBe(diveStep(plan, 4000).altitudeM);
    const heldStep = placed(approach.pose(at(9_000_000)));
    expect(heldStep.position.toArray()).toEqual(
      diveStep(plan, 4000).position.toArray(),
    );
    approach.holdDiveAt(null);
    approach.pose(at(5000)); // 4000 ms in, x2 on the clock: done
    approach.pose(at(6000));
    const phases = approach.state().history.map((h) => h.phase);
    expect(phases.filter((p) => p === "landed")).toHaveLength(1);
    expect(approach.state().phase).toBe("landed");
  });

  it("has no dive altitude without a dive", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params());
    expect(approach.holdDiveAt(100)).toBeNull();
    expect(approach.diveAltitudeAt(100)).toBeNull();
  });

  it("flies the pin flight, and a touch cancels it", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ turnMs: 0 }));
    approach.pose(at(0));
    const pin = pressPin(
      WGS84_ELLIPSOID,
      10,
      {
        pose: orbitPose(WGS84_ELLIPSOID, BERN),
        distanceM: FIT_M,
        quaternion: new THREE.Quaternion(),
      },
      { target: null, landingM: 150, progress: 0 },
    );
    approach.flyPin(at(10), pin);
    expect(approach.pinFlight).toBe(pin);
    expect(approach.state().phase).toBe("diving");
    expect(approach.state().target).toBeNull();
    approach.aimPin(ZURICH);
    expect(approach.state().target).toEqual(ZURICH);
    const seen: number[] = [];
    approach.updatePin(at(20), (p, t) => {
      seen.push(t);
      return p;
    });
    expect(seen).toEqual([20]);
    const step = placed(approach.pose(at(30)));
    expect(step.position).toBeInstanceOf(THREE.Vector3);
    approach.yieldToUser(at(40));
    expect(approach.pinFlight?.phase).toBe("cancelled");
    expect(approach.drives).toBe(false);
  });

  it("a dive after a pin flight drops the pin flight", () => {
    const { approach, at } = setup();
    approach.restart(at(0), params({ turnMs: 0 }));
    approach.pose(at(0));
    const start = {
      pose: orbitPose(WGS84_ELLIPSOID, BERN),
      distanceM: FIT_M,
      quaternion: new THREE.Quaternion(),
    };
    approach.flyPin(
      at(1),
      pressPin(WGS84_ELLIPSOID, 1, start, {
        target: null,
        landingM: 150,
        progress: 0,
      }),
    );
    approach.dive(at(2), ZURICH, start, {
      durationMs: 8000,
      toAltitudeM: 2000,
    });
    expect(approach.pinFlight).toBeNull();
  });
});

describe("approachRestartKey", () => {
  it("changes with the target and the intro's timing, not with anything else", () => {
    const base = params();
    const key = approachRestartKey(base);
    for (const over of [
      { url: ZURICH },
      { spinMs: 1 },
      { turnMs: 1 },
      { intro: "fov" as const },
      { maxKm: 60_000 },
      { turnCap: 10 },
    ]) {
      expect(approachRestartKey({ ...base, ...over })).not.toBe(key);
    }
    expect(approachRestartKey({ ...base, fovY: 70, pitchLow: 80 })).toBe(key);
  });
});

describe("poseToward", () => {
  it("is north up, and defined looking along the pole", () => {
    const p = poseToward([1, 0, 0]);
    expect(p.direction.toArray()).toEqual([1, 0, 0]);
    expect(p.up.toArray()).toEqual([0, 0, 1]);
    const pole = poseToward([0, 0, 2]);
    expect(pole.direction.toArray()).toEqual([0, 0, 1]);
    expect(pole.up.toArray()).toEqual([1, 0, 0]);
  });
});
