/**
 * The clouds' drift by the camera's altitude (round-5 plan
 * 2026-10-12-0612 §9, DEC-R5-3): far out the far rate, nearer the ground a
 * ground speed proportional to the altitude (the same apparent speed at
 * every height), never below a calm wind; and the offset summed per frame,
 * so a changing rate never jumps the clouds.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_CLOUD_DRIFT_LAW,
  advanceCloudLonOffsetRad,
  cloudDriftDegPerS,
} from "./globe-cloud-drift.js";
import {
  GLOBE_CLOUD_DRIFT_DEG_PER_S,
  cloudLonOffsetRad,
} from "./globe-surface-material.js";

const KM = 1_000;
const TURN = 2 * Math.PI;
/** Degrees a second at the equator to metres a second over the ground. */
const groundMps = (degPerS: number) =>
  (degPerS * Math.PI * GLOBE_CLOUD_DRIFT_LAW.radiusM) / 180;
const wrapped = (a: number) => ((a % TURN) + TURN) % TURN;

describe("cloudDriftDegPerS", () => {
  // WHY (the owner on r826): with one rate the clouds felt too slow while
  // the whole Earth was in view and far too fast near the volumetric
  // clouds. Far out the far rate holds, the owner's round-6 pick.
  it("is the far rate at and above farM, the flight's start included", () => {
    const { farM } = GLOBE_CLOUD_DRIFT_LAW;
    expect(GLOBE_CLOUD_DRIFT_DEG_PER_S).toBe(0.375);
    expect(farM).toBe(20_000 * KM);
    for (const h of [farM, 30_000 * KM, 43_600 * KM]) {
      expect(cloudDriftDegPerS(h)).toBe(GLOBE_CLOUD_DRIFT_DEG_PER_S);
    }
  });

  // The apparent speed straight down is the ground speed over the altitude:
  // proportional, it holds at every height between the wind floor and farM
  // (r826: about 0.01 degrees a second on the screen far out, 60 at 10 km).
  it("keeps the apparent speed straight down the same from 10 km to farM", () => {
    const { farM } = GLOBE_CLOUD_DRIFT_LAW;
    const apparent = (h: number) => groundMps(cloudDriftDegPerS(h)) / h;
    const top = apparent(farM);
    // About 0.12 degrees a second on the screen.
    expect((top * 180) / Math.PI).toBeGreaterThan(0.1);
    expect((top * 180) / Math.PI).toBeLessThan(0.14);
    for (let h = 10 * KM; h <= farM; h *= 1.7) {
      expect(apparent(h) / top).toBeCloseTo(1, 9);
    }
    // r826's single rate: 4,000 times faster on the screen at 10 km.
    const single = (h: number) => groundMps(0.375 / 4) / h;
    expect(single(10 * KM) / single(40_000 * KM)).toBeCloseTo(4_000, 6);
  });

  // On the ground the clouds still move, at a calm real wind.
  it("never drifts slower than the wind, reached at about 5 km", () => {
    const { windMps } = GLOBE_CLOUD_DRIFT_LAW;
    expect(windMps).toBe(10);
    for (const h of [0, 150, 1 * KM, 4 * KM]) {
      expect(groundMps(cloudDriftDegPerS(h))).toBeCloseTo(windMps, 9);
    }
    expect(groundMps(cloudDriftDegPerS(6 * KM))).toBeGreaterThan(windMps);
    // A negative altitude (under the ellipsoid) is the ground.
    expect(cloudDriftDegPerS(-50)).toBe(cloudDriftDegPerS(0));
  });

  it("never falls as the camera climbs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e8, noNaN: true }),
        fc.double({ min: 0, max: 1e8, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          expect(cloudDriftDegPerS(lo)).toBeLessThanOrEqual(
            cloudDriftDegPerS(hi),
          );
        },
      ),
    );
  });

  // The lab's knobs (`cloudDrift`, `cloudDriftFarKm`, `cloudWindMps`):
  // `cloudDrift=0` stills the clouds everywhere (the smokes rely on it),
  // a wind above the far speed caps at the far rate, bad knobs are refused.
  it("takes the knobs, stills at a zero far rate and refuses bad ones", () => {
    expect(cloudDriftDegPerS(0, { farDegPerS: 0 })).toBe(0);
    expect(cloudDriftDegPerS(1e8, { farDegPerS: 0 })).toBe(0);
    expect(cloudDriftDegPerS(10 * KM, { farDegPerS: 1, farM: 10 * KM })).toBe(
      1,
    );
    expect(cloudDriftDegPerS(0, { farDegPerS: 0.001, windMps: 1e6 })).toBe(
      0.001,
    );
    expect(groundMps(cloudDriftDegPerS(0, { windMps: 30 }))).toBeCloseTo(30, 9);
    // An altitude that is not a number reads as far out (no information).
    expect(cloudDriftDegPerS(Number.NaN)).toBe(GLOBE_CLOUD_DRIFT_DEG_PER_S);
    for (const bad of [
      { farDegPerS: -1 },
      { farDegPerS: Number.POSITIVE_INFINITY },
      { farM: 0 },
      { farM: Number.NaN },
      { windMps: -1 },
      { windMps: Number.NaN },
    ]) {
      expect(() => cloudDriftDegPerS(0, bad)).toThrow(RangeError);
    }
  });
});

describe("advanceCloudLonOffsetRad", () => {
  // WHY: the surface, the shell and the slab read one offset; a rate that
  // changes with the altitude must move it by rate x step, never re-derive
  // it as rate x time (which would jump the clouds at every change).
  it("adds rate x step and wraps into [0, 2π)", () => {
    expect(advanceCloudLonOffsetRad(0, 0.2, 90)).toBeCloseTo(
      (18 * Math.PI) / 180,
      12,
    );
    const near = advanceCloudLonOffsetRad(TURN - 0.01, 0.2, 9);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeCloseTo((1.8 * Math.PI) / 180 - 0.01, 12);
  });

  // A stalled frame or a hidden tab: at most a second's drift (a new
  // clock re-seeds in the lab). Never below a slow headless frame.
  it("caps one step at maxStepS and ignores a step that is not forward", () => {
    const { maxStepS } = GLOBE_CLOUD_DRIFT_LAW;
    expect(maxStepS).toBe(1);
    expect(advanceCloudLonOffsetRad(1, 3_600, 1)).toBeCloseTo(
      1 + (maxStepS * Math.PI) / 180,
      12,
    );
    expect(advanceCloudLonOffsetRad(1, -5, 1)).toBe(1);
    expect(advanceCloudLonOffsetRad(1, Number.NaN, 1)).toBe(1);
  });

  // At a steady rate the frames sum to the old product: a link's clouds
  // move exactly as before while the camera holds its height.
  it("matches rate x time at a steady rate, frame by frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1.5e12, max: 2.5e12 }),
        fc.array(fc.integer({ min: 1, max: 1_000 }), {
          minLength: 1,
          maxLength: 60,
        }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (t0, framesMs, rate) => {
          let offset = cloudLonOffsetRad(t0, rate);
          let t = t0;
          for (const dt of framesMs) {
            offset = advanceCloudLonOffsetRad(offset, dt / 1000, rate);
            t += dt;
          }
          const miss = Math.abs(wrapped(offset - cloudLonOffsetRad(t, rate)));
          expect(Math.min(miss, TURN - miss)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("refuses an offset or a rate that is not finite", () => {
    expect(() => advanceCloudLonOffsetRad(Number.NaN, 0.1, 1)).toThrow(
      RangeError,
    );
    expect(() =>
      advanceCloudLonOffsetRad(0, 0.1, Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });
});
