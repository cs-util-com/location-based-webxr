/**
 * The oblique flight's laws (round-5 plan 2026-10-01-0945 §3.5; one-scene
 * plan 2026-09-28-2140 §3.3-§3.4; F1).
 *
 * Why this test matters: the dive becomes an oblique approach, so three
 * laws decide what a viewer sees on the way down, and each must be
 * continuous with what came before: the view's depression (pitch) is 90
 * degrees far out (the intro ends looking at the centre) and eases to 45
 * by 1,000 km; the relief's exaggeration E is 1 at globe scale and rises
 * to 3 near the ground, in quantised steps so the tile tree is
 * not re-traversed every frame; and the camera never comes closer to the
 * exaggerated ground than a clearance. The frame metric (the target in
 * the centre third, the ground at the top edge) is computed over pitch x
 * fov x altitude.
 */
import { describe, expect, it } from "vitest";

import {
  GLOBE_FLIGHT,
  exaggerationAt,
  frameCheck,
  minimumAltitudeM,
  pitchAtDeg,
} from "./globe-flight.js";

describe("pitchAtDeg", () => {
  it("looks at the centre far out and 45 degrees down by 1,000 km", () => {
    expect(pitchAtDeg(20_000_000)).toBe(90);
    expect(pitchAtDeg(5_000_000)).toBe(90);
    expect(pitchAtDeg(1_000_000)).toBe(45);
    expect(pitchAtDeg(150_000)).toBe(45);
    expect(pitchAtDeg(5_000)).toBe(45);
  });

  it("eases between, monotone and without a jump", () => {
    let prev = pitchAtDeg(5_000_000);
    for (let alt = 5_000_000; alt >= 1_000_000; alt -= 10_000) {
      const p = pitchAtDeg(alt);
      expect(p).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - p).toBeLessThan(0.5);
      prev = p;
    }
  });

  it("takes another low pitch, and refuses bad input", () => {
    expect(pitchAtDeg(150_000, { pitchLowDeg: 30 })).toBe(30);
    expect(() => pitchAtDeg(Number.NaN)).toThrow(RangeError);
    expect(() => pitchAtDeg(1, { pitchLowDeg: 95 })).toThrow(RangeError);
  });
});

describe("exaggerationAt", () => {
  it("is 1 at globe scale and the near-ground value low down, in steps", () => {
    expect(exaggerationAt(5_000_000)).toBe(1);
    expect(exaggerationAt(GLOBE_FLIGHT.exaggerationFarM)).toBe(1);
    expect(exaggerationAt(GLOBE_FLIGHT.exaggerationNearM)).toBe(3);
    expect(exaggerationAt(1_000)).toBe(3);
    for (let alt = 10_000; alt < 3_000_000; alt *= 1.07) {
      const e = exaggerationAt(alt);
      expect(
        Math.round(e / GLOBE_FLIGHT.exaggerationStep) *
          GLOBE_FLIGHT.exaggerationStep,
      ).toBeCloseTo(e, 12);
      expect(e).toBeGreaterThanOrEqual(1);
      expect(e).toBeLessThanOrEqual(3);
    }
  });

  it("never falls as the camera descends, and takes another near value", () => {
    let prev = exaggerationAt(4_000_000);
    for (let alt = 4_000_000; alt > 1_000; alt *= 0.95) {
      const e = exaggerationAt(alt);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(exaggerationAt(1_000, { near: 5 })).toBe(5);
    expect(() => exaggerationAt(-1)).toThrow(RangeError);
    expect(() => exaggerationAt(1, { near: 0.5 })).toThrow(RangeError);
  });
});

describe("minimumAltitudeM", () => {
  // One-scene plan §3.4: the clearance is over the EXAGGERATED ground, the
  // sea drawn at 0 (F1a review major 3).
  it("is the exaggerated ground plus the clearance", () => {
    expect(minimumAltitudeM(4_000, 3, 500)).toBe(12_500);
    expect(minimumAltitudeM(-2_000, 3, 500)).toBe(500);
    expect(minimumAltitudeM(1_000, 1, GLOBE_FLIGHT.clearanceM)).toBe(
      1_000 + GLOBE_FLIGHT.clearanceM,
    );
    expect(() => minimumAltitudeM(0, 0.5, 100)).toThrow(RangeError);
    expect(() => minimumAltitudeM(0, 1, -1)).toThrow(RangeError);
  });
});

describe("frameCheck, over pitch x fov x altitude", () => {
  // The plan's metric: the target in the frame's centre third (it is the
  // view's centre by construction) and the ground at the top edge (the top
  // ray hits the Earth: its depression below the local horizontal exceeds
  // the horizon's dip). Computed: at fovY 50 and 45 degrees the horizon
  // leaves the frame below about 410 km.
  it("puts ground at the top edge below about 410 km at 45 degrees and fov 50", () => {
    expect(
      frameCheck({ altitudeM: 400_000, pitchDeg: 45, fovYDeg: 50 }).groundAtTop,
    ).toBe(true);
    expect(
      frameCheck({ altitudeM: 420_000, pitchDeg: 45, fovYDeg: 50 }).groundAtTop,
    ).toBe(false);
  });

  it("holds for the default pitch at every altitude of the held flight (150 km down)", () => {
    for (const alt of [150_000, 30_000, 5_000]) {
      for (const fov of [40, 50, 60]) {
        const c = frameCheck({
          altitudeM: alt,
          pitchDeg: pitchAtDeg(alt),
          fovYDeg: fov,
        });
        expect(c.targetInCentreThird, `${alt} m fov ${fov}`).toBe(true);
        expect(c.groundAtTop, `${alt} m fov ${fov}`).toBe(true);
      }
    }
  });
});
