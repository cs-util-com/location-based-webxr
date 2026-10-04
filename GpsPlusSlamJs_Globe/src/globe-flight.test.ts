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
  carrierShareAt,
  clearedAltitudeM,
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
  // sea drawn at 0 (review 2026-10-02-1235 major 3).
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

describe("clearedAltitudeM", () => {
  // Why (review 2026-10-03-1835 major 1): the clearance computed once at
  // the pin, from orbit, found no relief and was 0, so a low hold over the
  // Alps could sit inside a mountain. Every frame the camera is raised to
  // the clearance over the DRAWN (displaced, exaggerated) ground under it,
  // the sea at 0; with no relief loaded there it is left alone.
  it("raises the camera to the clearance over the drawn ground, and only then", () => {
    expect(clearedAltitudeM(5_000, 6_600, 300)).toBe(6_900);
    expect(clearedAltitudeM(10_000, 6_600, 300)).toBe(10_000);
    expect(clearedAltitudeM(200, -3_000, 300)).toBe(300);
    expect(clearedAltitudeM(5_000, null, 300)).toBe(5_000);
    for (let alt = 0; alt <= 20_000; alt += 250) {
      for (const ground of [-1_000, 0, 2_000, 8_000, 15_000]) {
        const a = clearedAltitudeM(alt, ground, GLOBE_FLIGHT.clearanceM);
        expect(a).toBeGreaterThanOrEqual(alt);
        expect(a).toBeGreaterThanOrEqual(
          Math.max(0, ground) + GLOBE_FLIGHT.clearanceM,
        );
      }
    }
    expect(() => clearedAltitudeM(Number.NaN, 0, 300)).toThrow(RangeError);
    expect(() => clearedAltitudeM(0, Number.NaN, 300)).toThrow(RangeError);
    expect(() => clearedAltitudeM(0, 0, -1)).toThrow(RangeError);
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

  // Why (review 2026-10-03-1835 minor 7): the view's centre is the
  // target, and at a low pitch it looked past the horizon (pitchLow 30
  // between about 985 and 1,300 km, where the horizon dips more than 30
  // degrees). The law keeps the view at least `horizonMarginDeg` below the
  // horizon, so the target is in view over the whole pitch x fov x
  // altitude sweep.
  it("keeps the target in view over pitch x fov x altitude", () => {
    const r = GLOBE_FLIGHT.radiusM;
    const dip = (alt: number) => (Math.acos(r / (r + alt)) * 180) / Math.PI;
    expect(
      frameCheck({ altitudeM: 1_100_000, pitchDeg: 30, fovYDeg: 50 })
        .targetVisible,
    ).toBe(false);
    for (const pitchLowDeg of [30, 45, 60, 90]) {
      for (const fov of [40, 50, 60]) {
        for (let alt = 1_000; alt <= 30_000_000; alt *= 1.15) {
          const pitch = pitchAtDeg(alt, { pitchLowDeg });
          const c = frameCheck({
            altitudeM: alt,
            pitchDeg: pitch,
            fovYDeg: fov,
          });
          expect(c.targetVisible, `${pitchLowDeg} ${alt} m`).toBe(true);
          expect(pitch).toBeGreaterThanOrEqual(
            Math.min(90, dip(alt) + GLOBE_FLIGHT.horizonMarginDeg) - 1e-9,
          );
        }
      }
    }
    // Where the horizon is low the law is the plan's own value.
    expect(pitchAtDeg(150_000, { pitchLowDeg: 30 })).toBe(30);
  });

  it("holds for the default pitch at every altitude of the held flight (150 km down)", () => {
    for (const alt of [150_000, 30_000, 5_000]) {
      for (const fov of [40, 50, 60]) {
        const c = frameCheck({
          altitudeM: alt,
          pitchDeg: pitchAtDeg(alt),
          fovYDeg: fov,
        });
        expect(c.targetVisible, `${alt} m fov ${fov}`).toBe(true);
        expect(c.groundAtTop, `${alt} m fov ${fov}`).toBe(true);
      }
    }
  });
});

describe("carrierShareAt, the altitude band between the globe and the relief", () => {
  // Why (one-scene plan §3.2 and §6; F1): above the band the globe's own
  // surface draws, below it the relief's library tiles, and between them
  // each pixel goes to one or the other by a dither at this share. The
  // weights must be exact at the edges (nothing of the other carrier
  // leaks outside the band), sum to one by construction, and never step
  // back as the camera descends, or the fade would flicker.
  it("is 0 above the band, 1 below it, exact at the edges", () => {
    const { bandHighM, bandLowM } = GLOBE_FLIGHT;
    expect(bandHighM).toBe(2_000_000);
    expect(bandLowM).toBe(1_200_000);
    expect(carrierShareAt(5_000_000)).toBe(0);
    expect(carrierShareAt(bandHighM)).toBe(0);
    expect(carrierShareAt(bandLowM)).toBe(1);
    expect(carrierShareAt(150_000)).toBe(1);
    const mid = carrierShareAt(Math.sqrt(bandHighM * bandLowM));
    expect(mid).toBeCloseTo(0.5, 12);
  });

  it("never falls as the camera descends, over the band's sweep", () => {
    for (const [highM, lowM] of [
      [2_000_000, 1_200_000],
      [4_000_000, 2_400_000],
      [1_000_000, 600_000],
    ] as const) {
      let prev = -1;
      for (let alt = 6_000_000; alt >= 1; alt *= 0.97) {
        const s = carrierShareAt(alt, { highM, lowM });
        expect(s).toBeGreaterThanOrEqual(prev);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        prev = s;
      }
      expect(prev).toBe(1);
    }
  });

  it("starts above the relief's first visible exaggeration", () => {
    // E leaves 1 (its first 0.1 step) only inside or below the band, so
    // the relief is flat while the globe still draws.
    let firstE = 0;
    for (let alt = 3_000_000; alt > 20_000; alt -= 10_000) {
      if (exaggerationAt(alt) > 1) {
        firstE = alt;
        break;
      }
    }
    expect(firstE).toBeLessThan(GLOBE_FLIGHT.bandHighM);
  });

  it("refuses a non-finite altitude or a band whose edges are not ordered", () => {
    expect(() => carrierShareAt(Number.NaN)).toThrow(RangeError);
    expect(() => carrierShareAt(1e6, { highM: 1e6, lowM: 2e6 })).toThrow(
      RangeError,
    );
    expect(() => carrierShareAt(1e6, { highM: 1e6, lowM: 0 })).toThrow(
      RangeError,
    );
  });
});
