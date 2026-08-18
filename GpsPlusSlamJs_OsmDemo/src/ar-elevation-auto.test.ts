/**
 * The automatic elevation offset — floor-vs-DEM delta, composed with the
 * baseline.
 *
 * Why these tests matter: every number in this module crosses THREE frames
 * (raw WebXR → scene NUE → the demo's anchor ENU) and one sign convention,
 * and every mistake in any of them produces a plausible-looking city at a
 * confidently wrong height — the exact failure class the manual nudge was
 * built to work around. The chain is exercised against the REAL framework
 * grid, floor estimator and offset estimator (only the DEM sampler is a
 * stub), because the modules were each correct in isolation once before
 * while nothing asserted they were connected.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";
import {
  makeWorldPointSample,
  surfacePatch,
} from "gps-plus-slam-app-framework/test-utils/synthetic-depth-samples";

import {
  AUTO_ENGAGE_CONFIDENCE,
  AUTO_RELEASE_CONFIDENCE,
  AUTO_TICK_INTERVAL_MS,
  arPointToSceneNue,
  autoElevationEnabled,
  composeElevationM,
  createArElevationAuto,
  nextAutoEngaged,
  type ArElevationAutoOptions,
} from "./ar-elevation-auto.js";

/** A translation-only alignment: identity rotation, NUE offset (tN, tUp, tE). */
function translationAlignment(tN: number, tUp: number, tE: number): number[] {
  const m = new THREE.Matrix4().identity();
  m.elements[12] = tN;
  m.elements[13] = tUp;
  m.elements[14] = tE;
  return [...m.elements];
}

/**
 * A grid holding a flat floor plate at `floorY`, observed twice from
 * `cameraY` straight above the origin — twice, because the production grid
 * settings require ≥2 observations before a cell counts as occupied.
 */
function gridWithFloor(cameraY: number, floorY: number): OccupancyGrid {
  const grid = new OccupancyGrid({
    cellSizeM: 0.16,
    carveConfidenceThreshold: 2,
  });
  const sample = makeWorldPointSample(
    [0, cameraY, 0],
    surfacePatch(() => floorY, 1, 0.2),
  );
  grid.addSample(sample);
  grid.addSample(sample);
  return grid;
}

function autoWith(overrides: Partial<ArElevationAutoOptions> = {}) {
  return createArElevationAuto({
    grid: new OccupancyGrid({ cellSizeM: 0.16, carveConfidenceThreshold: 2 }),
    terrainHeightM: () => 100,
    anchorOffsetNue: { north: 0, east: 0 },
    ...overrides,
  });
}

describe("the sign of the auto offset (the fieldMatchesArDatum of this feature)", () => {
  // THE SIGN, DERIVED FROM THE DEMO'S OWN FRAMES — this test owns it, the way
  // `fieldMatchesArDatum` owns the datum sign, because getting it backwards
  // moves the city the WRONG way by twice the measured error and reads as a
  // fusion bug.
  //
  //   - Scene y = 0 is the WGS84 ellipsoid; the AR terrain field's `heightAt`
  //     returns ellipsoidal DEM+N, and the city's ground is BAKED at exactly
  //     that height, so with offset 0 the city surface sits at scene
  //     y = terrain.
  //   - The measured floor in the scene frame is `baselineY + floorYar`
  //     (yaw-only alignment: vertical distances are frame-invariant, and the
  //     alignment adds its translation `matrix[13]`).
  //   - For the city surface to MEET the measured floor, the content must move
  //     by `offset = (baselineY + floorYar) − terrain`: floor ABOVE the DEM
  //     surface ⇒ positive ⇒ the city RISES.
  //
  // The estimator stores the baseline-free part (`floorYar − terrain`, §2.3
  // decomposition — a baseline jump must move camera and content together
  // instantly, not replay through the smoother), so the composed value this
  // module publishes is `baselineY + estimator.offsetM`.
  it("raises the city when the measured floor is ABOVE the DEM surface", () => {
    // Floor measured at raw-AR y = 3.0 under a camera at 4.6 (a plausible
    // 1.6 m eye height); baseline 98.4; DEM+N = 100. Measured floor in the
    // scene frame: 98.4 + 3.0 = 101.4, which is 1.4 m ABOVE the city surface
    // at 100 — so the city must rise by exactly +1.4 m.
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).not.toBeNull();
    expect(state.autoM).toBeCloseTo(1.4, 1);
    // ONE full-quality tick is ~0.1 of the estimator's 10-tick confidence
    // saturation (per-tick-normalized since the F6 recalibration — hit
    // count no longer inflates it). Positive and finite is the claim here;
    // the growth curve is the framework estimator's own tested contract.
    expect(state.confidence).toBeGreaterThan(0.05);
    expect(state.frozen).toBe(false);
  });

  it("lowers the city when the measured floor is BELOW the DEM surface", () => {
    // Floor at raw-AR y = 0.6 under a camera at 2.2; same 98.4 baseline.
    // Measured floor: 98.4 + 0.6 = 99.0, one metre BELOW the surface at 100 —
    // the city must come DOWN by 1 m. This is the direction of the owner's
    // original field report (buildings floating above the user).
    const auto = autoWith({ grid: gridWithFloor(2.2, 0.6) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 2.2, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).toBeCloseTo(-1.0, 1);
  });

  it("keeps the sign and magnitude under a YAWED alignment (cold-review F9)", () => {
    // The two identity-rotation tests above cannot see a mistake that only a
    // rotation exposes (a transposed matrix, a row/column-major mix-up): with
    // identity rotation the alignment is pure translation and every such bug
    // cancels. A 90° yaw + full 3-axis translation is exactly the shape the
    // fusion's alignment takes, and the VERTICAL result must be unchanged —
    // yaw-only alignments are vertical-frame-invariant, the module's core
    // assumption. The flat DEM keeps the horizontal remap out of the answer.
    const yawed = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    yawed.setPosition(12, 98.4, -7);
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: [...yawed.elements],
    });

    expect(state.autoM).not.toBeNull();
    expect(state.autoM).toBeCloseTo(1.4, 1);
  });
});

describe("what feeds the estimator", () => {
  it("samples the DEM at each hit's OWN position, in the anchor's ENU frame", () => {
    // Slope-correct sampling (plan §2.4): on a hillside "the floor height" is
    // position-dependent, so each floor hit must be paired with the terrain at
    // ITS OWN horizontal position — never with one lookup at the camera. The
    // stub records every query; the queries must span the plate rather than
    // collapse to a point, and must carry the alignment translation MINUS the
    // scene-anchor offset (the DEM field is sampled about the anchor, while
    // the alignment is about the GPS `zero`).
    const queried: { x: number; y: number }[] = [];
    const auto = autoWith({
      grid: gridWithFloor(4.6, 3),
      terrainHeightM: (enu) => {
        queried.push({ x: enu.x, y: enu.y });
        return 100;
      },
      anchorOffsetNue: { north: 4, east: -2 },
    });

    auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(10, 98.4, 20),
    });

    expect(queried.length).toBeGreaterThan(6);
    // The plate is centred on the camera at the raw-AR origin, so the queries
    // centre on (east 20 − (−2), north 10 − 4) = (22, 6)…
    const xs = queried.map((q) => q.x);
    const ys = queried.map((q) => q.y);
    expect(Math.min(...xs)).toBeGreaterThan(22 - 1.5);
    expect(Math.max(...xs)).toBeLessThan(22 + 1.5);
    expect(Math.min(...ys)).toBeGreaterThan(6 - 1.5);
    expect(Math.max(...ys)).toBeLessThan(6 + 1.5);
    // …and SPAN the plate (per-hit sampling, not one camera-position lookup).
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });

  it("contributes nothing while the DEM sampler answers undefined", () => {
    // The AR-datum gate: between AR entry and the entry pass landing, the held
    // field is the DESKTOP one and `terrainHeightM` answers undefined. No
    // samples may form — a relief-datum sample would be wrong by the whole
    // ellipsoidal height.
    const auto = autoWith({
      grid: gridWithFloor(4.6, 3),
      terrainHeightM: () => undefined,
    });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).toBeNull();
    expect(state.confidence).toBe(0);
  });

  it("publishes nothing from an empty grid (no floor estimate)", () => {
    const auto = autoWith();

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).toBeNull();
  });

  it("publishes nothing before an alignment exists", () => {
    // Without the alignment there is no baseline to compose with and no way to
    // place a hit horizontally — a null is the only honest answer.
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: undefined,
    });

    expect(state.autoM).toBeNull();
  });

  it("publishes nothing without a camera pose", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: undefined,
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).toBeNull();
  });
});

describe("the confidence gate (cold-review F1)", () => {
  // Why these tests matter: the framework estimator FLOORS bad hits, it does
  // not reject them (`MIN_CONFIDENCE_WEIGHT`), so a stream of crushed
  // estimates — a lock outside the plausibility band, an extrapolation-clamped
  // plane — still accumulates enough per-hit mass to publish an `offsetM`, at
  // a published confidence of a few hundredths. Both framework sidecars
  // (`floor-estimator.ts.md`, `elevation-offset-estimator.ts.md`) say the
  // CALLER is the gate and use `confidence >= 0.5` in their examples; without
  // that gate here the demo eased the entire city vertically on evidence it
  // was itself reporting as worthless. The estimator's own collapse detector
  // cannot stand in for the gate: it fires only once an output exists, so it
  // would FREEZE the bad value rather than refuse it.

  it("never engages a standstill stream, however long it publishes", () => {
    // The exact production shape of the failure: a stationary user. The
    // estimator's novelty floor deliberately deflates a standstill (correlated
    // re-observations are not new evidence), so it publishes a perfectly
    // stable +1.4 m at ~0.10 confidence forever. The VALUE is honest and stays
    // on the HUD; what must not happen is the city moving on it.
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    let last = auto.sample({
      nowMs: 1000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });
    for (let i = 1; i < 30; i++) {
      last = auto.sample({
        nowMs: 1000 + i * AUTO_TICK_INTERVAL_MS,
        cameraPosAr: [0, 4.6, 0],
        alignment: translationAlignment(0, 98.4, 0),
      });
      expect(last.engaged).toBe(false);
    }
    // Published, and honestly labelled as low — but never engaged.
    expect(last.autoM).toBeCloseTo(1.4, 1);
    expect(last.confidence).toBeLessThan(AUTO_ENGAGE_CONFIDENCE);
  });

  it("engages once a MOVING stream earns the confidence", () => {
    // The same measurement, walked: novelty weight 1 per tick, so the
    // estimator's per-tick-normalized confidence climbs 0.1/tick and crosses
    // the engage threshold on the 5th tick. Below it the contribution is
    // zero; at and above it the offset is applied.
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    const walk = (i: number) =>
      auto.sample({
        nowMs: 1000 + i * AUTO_TICK_INTERVAL_MS,
        cameraPosAr: [0, 4.6, 0],
        // The alignment carries the walk: camera and hits move together in
        // ENU while the raw-AR floor plate stays under the camera, which is
        // what lets a fixed synthetic grid stand in for a walked one.
        alignment: translationAlignment(0, 98.4, i * 1.5),
      });

    const first = walk(0);
    expect(first.autoM).toBeCloseTo(1.4, 1);
    expect(first.engaged).toBe(false);

    const trail = Array.from({ length: 9 }, (_, k) => walk(k + 1));
    expect(trail.findIndex((s) => s.engaged)).toBeGreaterThanOrEqual(0);
    // Engagement never precedes the threshold being met: no state below the
    // RELEASE floor is ever engaged.
    expect(
      trail.filter((s) => s.confidence < AUTO_RELEASE_CONFIDENCE && s.engaged),
    ).toEqual([]);
    const last = trail.at(-1);
    expect(last?.engaged).toBe(true);
    expect(last?.autoM).toBeCloseTo(1.4, 1);
  });

  it("returns to disengaged on reset()", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    for (let i = 0; i < 10; i++) {
      auto.sample({
        nowMs: 1000 + i * AUTO_TICK_INTERVAL_MS,
        cameraPosAr: [0, 4.6, 0],
        alignment: translationAlignment(0, 98.4, i * 1.5),
      });
    }
    auto.reset();
    const cold = auto.sample({
      nowMs: 20_000,
      cameraPosAr: [0, 4.6, 0],
      alignment: translationAlignment(0, 98.4, 0),
    });
    expect(cold.engaged).toBe(false);
  });
});

describe("nextAutoEngaged — the hysteresis itself", () => {
  // Why this test matters: a single threshold makes a value hovering at it
  // FLAP, and each flap eases the whole city down and back up at 1.5 m/s.
  // Two thresholds turn the decision into a state with a dead band. The pure
  // function is tested directly because the exact boundary values are the
  // contract, and driving them through the real estimator chain could only
  // approximate them.

  it("needs the ENGAGE threshold to turn on", () => {
    expect(nextAutoEngaged(false, AUTO_ENGAGE_CONFIDENCE - 1e-6)).toBe(false);
    expect(nextAutoEngaged(false, AUTO_ENGAGE_CONFIDENCE)).toBe(true);
    // The release threshold alone is NOT enough to engage — that asymmetry
    // is the hysteresis.
    expect(nextAutoEngaged(false, AUTO_RELEASE_CONFIDENCE)).toBe(false);
  });

  it("stays engaged through a decay from 0.6 to 0.35 and releases below 0.3", () => {
    let engaged = false;
    engaged = nextAutoEngaged(engaged, 0.6);
    expect(engaged).toBe(true);
    for (const c of [0.55, 0.49, 0.42, 0.35, AUTO_RELEASE_CONFIDENCE]) {
      engaged = nextAutoEngaged(engaged, c);
      expect(engaged).toBe(true);
    }
    engaged = nextAutoEngaged(engaged, AUTO_RELEASE_CONFIDENCE - 1e-6);
    expect(engaged).toBe(false);
    // And re-engaging needs the full ENGAGE threshold again, not 0.3.
    expect(nextAutoEngaged(false, 0.45)).toBe(false);
  });

  it("treats a non-finite confidence as disengaged", () => {
    // Defensive: a NaN must not read as "≥ threshold" by accident, and must
    // not latch an engaged state on either.
    expect(nextAutoEngaged(false, Number.NaN)).toBe(false);
    expect(nextAutoEngaged(true, Number.NaN)).toBe(false);
  });
});

describe("the ~1 Hz tick throttle", () => {
  it("holds the last state between ticks without re-evaluating", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    const good = {
      cameraPosAr: [0, 4.6, 0] as const,
      alignment: translationAlignment(0, 98.4, 0),
    };

    const first = auto.sample({ nowMs: 1000, ...good });
    expect(first.autoM).toBeCloseTo(1.4, 1);

    // 400 ms later the pose is gone — but the tick is throttled, so the
    // PREVIOUS state holds unchanged (not even the pose-gap confidence decay
    // runs mid-interval; the interval belongs to the last real tick).
    const held = auto.sample({
      nowMs: 1400,
      cameraPosAr: undefined,
      alignment: undefined,
    });
    expect(held.autoM).toBeCloseTo(1.4, 1);
    expect(held.confidence).toBe(first.confidence);
  });
});

describe("pose gaps hold the published value (cold-review F3)", () => {
  // Why this test matters: a tracking blip drops `getCurrentArPose()` to null
  // for a frame or two. The old contract flapped `autoM` to null on the next
  // tick, which composes as 0 — so the CITY JUMPED by the full offset and
  // jumped back when the pose returned. The honest reading is "no NEW
  // measurement", not "the offset is gone": the value is held (the physical
  // floor-vs-DEM disagreement did not change because ARCore blinked), with
  // the confidence decaying so a LONG outage still advertises itself.
  it("holds the last composed value across a pose gap and resumes after it", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    const good = {
      cameraPosAr: [0, 4.6, 0] as const,
      alignment: translationAlignment(0, 98.4, 0),
    };

    const before = auto.sample({ nowMs: 1000, ...good });
    expect(before.autoM).toBeCloseTo(1.4, 1);
    expect(before.confidence).toBeGreaterThan(0.05);

    // A full tick with NO pose: the value must hold — no jump to null/0.
    const gap = auto.sample({
      nowMs: 1000 + AUTO_TICK_INTERVAL_MS + 100,
      cameraPosAr: undefined,
      alignment: good.alignment,
    });
    expect(gap.autoM).toBeCloseTo(1.4, 1);
    // Held, not re-measured: the confidence decays instead of renewing.
    expect(gap.confidence).toBeLessThan(before.confidence);
    expect(gap.confidence).toBeGreaterThan(0);

    // A missing ALIGNMENT mid-session is the same kind of blip (the matrix
    // cannot re-become identity in production; the input goes undefined only
    // when the caller cannot read it) — held too.
    const gap2 = auto.sample({
      nowMs: 1000 + 2 * (AUTO_TICK_INTERVAL_MS + 100),
      cameraPosAr: [0, 4.6, 0],
      alignment: undefined,
    });
    expect(gap2.autoM).toBeCloseTo(1.4, 1);

    // Pose returns: measurement resumes and the confidence recovers.
    const after = auto.sample({
      nowMs: 1000 + 3 * (AUTO_TICK_INTERVAL_MS + 100),
      ...good,
    });
    expect(after.autoM).toBeCloseTo(1.4, 1);
    expect(after.confidence).toBeGreaterThan(gap2.confidence);
  });

  it("still publishes nothing on a TRUE cold start without a pose", () => {
    // The hold is for a value that EXISTED. Before anything was ever
    // published there is nothing to hold, and inventing one would be the
    // unmeasured-rendered-as-measured trap.
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });

    const state = auto.sample({
      nowMs: 1000,
      cameraPosAr: undefined,
      alignment: translationAlignment(0, 98.4, 0),
    });

    expect(state.autoM).toBeNull();
    expect(state.confidence).toBe(0);
  });
});

describe("reset() — tracking-restart hygiene (cold-review F2)", () => {
  // Why this test matters: after `odometryTrackingRestarted` the odometry
  // frame every window sample was measured in NO LONGER EXISTS. The grid is
  // cleared in the same callback, but the ESTIMATOR's window still holds
  // pre-restart samples — and its hold branch would keep publishing a value
  // measured in the dead frame for up to 45 s. `reset()` recreates the
  // estimator so the published auto returns to a true cold start.
  it("returns to a cold start after reset() despite a warm pre-restart window", () => {
    // The DEM sampler is switchable so the post-reset ticks carry NO new
    // samples: without the reset the estimator's hold branch keeps the old
    // 1.4 m alive (that is exactly the stale-frame failure), with it the
    // publish must honestly return to null.
    let terrain: number | undefined = 100;
    const auto = autoWith({
      grid: gridWithFloor(4.6, 3),
      terrainHeightM: () => terrain,
    });
    const good = {
      cameraPosAr: [0, 4.6, 0] as const,
      alignment: translationAlignment(0, 98.4, 0),
    };

    const warm = auto.sample({ nowMs: 1000, ...good });
    expect(warm.autoM).toBeCloseTo(1.4, 1);

    auto.reset();
    terrain = undefined; // post-restart: no fresh samples form

    const afterReset = auto.sample({
      nowMs: 1000 + AUTO_TICK_INTERVAL_MS + 100,
      ...good,
    });
    expect(afterReset.autoM).toBeNull();
    expect(afterReset.confidence).toBe(0);
  });

  it("resets the tick throttle too, so the next frame re-measures at once", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    const good = {
      cameraPosAr: [0, 4.6, 0] as const,
      alignment: translationAlignment(0, 98.4, 0),
    };
    auto.sample({ nowMs: 1000, ...good });

    auto.reset();

    // 100 ms later — inside the old throttle window. A reset that kept the
    // old `lastTickMs` would silently skip the first post-restart second.
    const state = auto.sample({ nowMs: 1100, ...good });
    expect(state.autoM).toBeCloseTo(1.4, 1);
  });
});

describe("arPointToSceneNue", () => {
  it("matches three.js applying the same matrix, including a yaw", () => {
    // The oracle: build the NUE point the same way production does (raw WebXR
    // X=East, Y=Up, Z=South → NUE north = −z, up = y, east = x) and push it
    // through THREE's own column-major multiply. A yaw + translation is
    // exactly the shape the fusion's alignment takes.
    const m = new THREE.Matrix4()
      .makeRotationY(Math.PI / 3)
      .setPosition(12, -3, 7);
    const arPoint: [number, number, number] = [1.5, 2.5, -0.5];
    const nue = new THREE.Vector3(0.5, 2.5, 1.5); // (north, up, east)
    const expected = nue.clone().applyMatrix4(m);

    const out = arPointToSceneNue(m.elements, arPoint);

    expect(out).toBeDefined();
    expect(out?.north).toBeCloseTo(expected.x, 10);
    expect(out?.up).toBeCloseTo(expected.y, 10);
    expect(out?.east).toBeCloseTo(expected.z, 10);
  });

  it("answers undefined for a non-finite matrix or point", () => {
    const bad = translationAlignment(0, Number.NaN, 0);
    expect(arPointToSceneNue(bad, [0, 0, 0])).toBeUndefined();
    expect(
      arPointToSceneNue(translationAlignment(0, 0, 0), [0, Number.NaN, 0]),
    ).toBeUndefined();
  });
});

describe("composeElevationM", () => {
  it("treats a null auto offset as zero, leaving the manual trim pure", () => {
    // The kill-switch / cold-start contract: with no auto contribution the
    // nudge must behave EXACTLY as it did before this feature existed.
    expect(composeElevationM(null, 3)).toBe(3);
    expect(composeElevationM(null, 0)).toBe(0);
  });

  it("sums auto and manual trim", () => {
    expect(composeElevationM(1.4, -1)).toBeCloseTo(0.4, 10);
  });
});

describe("autoElevationEnabled", () => {
  it("is on by default and off for ?autoElevation=off/0/false", () => {
    expect(autoElevationEnabled("")).toBe(true);
    expect(autoElevationEnabled("?lat=1&lng=2")).toBe(true);
    expect(autoElevationEnabled("?autoElevation=off")).toBe(false);
    expect(autoElevationEnabled("?autoElevation=0")).toBe(false);
    expect(autoElevationEnabled("?autoElevation=false")).toBe(false);
    // An unrecognised value must not silently disable the feature.
    expect(autoElevationEnabled("?autoElevation=on")).toBe(true);
  });
});
