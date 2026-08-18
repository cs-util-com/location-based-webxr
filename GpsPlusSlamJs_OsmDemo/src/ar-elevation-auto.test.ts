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
  AUTO_TICK_INTERVAL_MS,
  arPointToSceneNue,
  autoElevationEnabled,
  composeElevationM,
  createArElevationAuto,
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
    expect(state.confidence).toBeGreaterThan(0.5);
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

describe("the ~1 Hz tick throttle", () => {
  it("holds the last state between ticks and re-evaluates after the interval", () => {
    const auto = autoWith({ grid: gridWithFloor(4.6, 3) });
    const good = {
      cameraPosAr: [0, 4.6, 0] as const,
      alignment: translationAlignment(0, 98.4, 0),
    };

    const first = auto.sample({ nowMs: 1000, ...good });
    expect(first.autoM).toBeCloseTo(1.4, 1);

    // 400 ms later the pose is gone — but the tick is throttled, so the
    // PREVIOUS state holds rather than flapping to null mid-interval.
    const held = auto.sample({
      nowMs: 1400,
      cameraPosAr: undefined,
      alignment: undefined,
    });
    expect(held.autoM).toBeCloseTo(1.4, 1);

    // Past the interval the same degraded input is re-evaluated for real.
    const reevaluated = auto.sample({
      nowMs: 1000 + AUTO_TICK_INTERVAL_MS + 100,
      cameraPosAr: undefined,
      alignment: undefined,
    });
    expect(reevaluated.autoM).toBeNull();
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
