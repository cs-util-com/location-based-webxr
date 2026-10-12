/**
 * Why this test matters: the owner's round-2 feedback on the continuous
 * flight (round-2 plan 2026-10-07-2350, DEC-FR2-1 and DEC-FR2-2, revised by
 * its cold review): "the camera must always look in the direction of
 * flight, and that direction ends at 45 degrees", and "turn first, then
 * dive: straight towards the Earth's centre, then bending". These tests
 * hold the curve that does it, on its own terms:
 * - the flight-path angle law: straight down above the bend, 45 degrees at
 *   the landing, monotone and smooth;
 * - the curve ends exactly, and below the bend its view IS its direction of
 *   travel (the camera's actual motion, measured from its positions);
 * - a start high up turns first and is done turning above the bend;
 * - a start below the bend (a replan) absorbs its residual early and still
 *   ends exactly, looking where it goes;
 * - its length is the CF1 measure the replans match speeds in.
 */

import { describe, expect, it } from "vitest";

import {
  FLIGHT_TRAVEL,
  bendAltitudeM,
  planTravel,
  travelLawDeg,
  fitMeteorDeg,
  meteorDiveArcRad,
} from "./flight-travel.js";

const KM = 1_000;
const R = FLIGHT_TRAVEL.radiusM;
const DEG = Math.PI / 180;

/** The camera's actual travel angle below its horizontal, by differences. */
function travelAngleDeg(
  curve: ReturnType<typeof planTravel>,
  arcRad: number,
  s: number,
  ds: number,
): number {
  const a = curve.at(Math.max(0, s - ds));
  const b = curve.at(Math.min(curve.length, s + ds));
  const h = (a.h + b.h) / 2;
  const drop = a.h - b.h;
  const ahead = (b.share - a.share) * arcRad * (R + h);
  return Math.atan2(drop, ahead) / DEG;
}

/**
 * How far from the view's centre the target is, degrees, at path length s
 * (in the plane of the course; the target 45 degrees ahead of the end, as
 * flight-path places the end behind it).
 */
function targetOffCentreDeg(
  curve: ReturnType<typeof planTravel>,
  arc: number,
  h1: number,
  s: number,
): number {
  const gamma = 45 * DEG;
  const lookBack = Math.asin(((R + h1) / R) * Math.sin(gamma)) - gamma;
  const tTheta = arc + lookBack;
  const { h, share } = curve.at(s);
  const th = share * arc;
  const p = curve.pitchAt(s) * DEG;
  const toX = R * Math.sin(tTheta) - (R + h) * Math.sin(th);
  const toY = R * Math.cos(tTheta) - (R + h) * Math.cos(th);
  const viewX = Math.cos(p) * Math.cos(th) - Math.sin(p) * Math.sin(th);
  const viewY = -Math.cos(p) * Math.sin(th) - Math.sin(p) * Math.cos(th);
  const cos = (viewX * toX + viewY * toY) / Math.hypot(toX, toY);
  return Math.acos(Math.min(1, cos)) / DEG;
}

describe("travelLawDeg", () => {
  it("is straight down above the bend, 45 at the landing, monotone between", () => {
    for (const landingM of [2 * KM, 5 * KM, 12 * KM]) {
      const bend = bendAltitudeM(landingM);
      expect(travelLawDeg(bend * 1.01, landingM)).toBe(90);
      expect(travelLawDeg(65_000 * KM, landingM)).toBe(90);
      expect(travelLawDeg(landingM, landingM)).toBeCloseTo(45, 9);
      let last = 45;
      for (let i = 1; i <= 200; i++) {
        const h = landingM * (bend / landingM) ** (i / 200);
        const g = travelLawDeg(h, landingM);
        expect(g).toBeGreaterThanOrEqual(last - 1e-9);
        last = g;
      }
      expect(last).toBeCloseTo(90, 9);
    }
  });

  it("bends no lower than 25 landings, so a high landing still has a bend", () => {
    expect(bendAltitudeM(2 * KM)).toBe(FLIGHT_TRAVEL.bendM);
    expect(bendAltitudeM(12 * KM)).toBe(300 * KM);
    expect(bendAltitudeM(2_000 * KM)).toBe(50_000 * KM);
  });

  it("rejects an altitude or a landing that is not a positive number", () => {
    expect(() => travelLawDeg(Number.NaN, 2 * KM)).toThrow(RangeError);
    expect(() => travelLawDeg(10 * KM, 0)).toThrow(RangeError);
  });
});

describe("planTravel", () => {
  const cases = [
    { name: "space to Bern", h0: 65_000 * KM, h1: 2 * KM, arc: 1.2 },
    { name: "the fit to Bern", h0: 10_100 * KM, h1: 2 * KM, arc: 0.6 },
    { name: "a far turn", h0: 25_600 * KM, h1: 2 * KM, arc: 2.6 },
    { name: "straight down", h0: 43_600 * KM, h1: 2 * KM, arc: 1e-7 },
    { name: "a high landing", h0: 30_000 * KM, h1: 12 * KM, arc: 0.4 },
  ];

  it("ends exactly at its landing, all the way along", () => {
    for (const { name, h0, h1, arc } of cases) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const start = curve.at(0);
      const end = curve.at(curve.length);
      expect(start.h, name).toBeCloseTo(h0, 3);
      expect(start.share, name).toBeCloseTo(0, 12);
      expect(end.h, name).toBeCloseTo(h1, 6);
      expect(end.share, name).toBeCloseTo(1, 12);
      expect(curve.pitchAt(curve.length), name).toBeCloseTo(45, 6);
    }
  });

  // A start nearer than the dive's own track backs off first, by design
  // (it must curve in at 45 degrees); every other one only approaches.
  it("descends all the way and never turns back", () => {
    for (const { name, h0, h1, arc } of cases) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      if (arc < curve.diveArcRad) continue;
      let last = curve.at(0);
      for (let i = 1; i <= 2_000; i++) {
        const p = curve.at((curve.length * i) / 2_000);
        // To the interpolation's rounding: 1e-9 of the arc is millimetres.
        expect(p.h, name).toBeLessThanOrEqual(last.h * (1 + 1e-12));
        expect(p.share, name).toBeGreaterThanOrEqual(last.share - 1e-9);
        last = p;
      }
    }
  });

  // The owner's point 1: below the bend the view is where it goes.
  it("looks where it travels below the bend", () => {
    for (const { name, h0, h1, arc } of cases) {
      if (arc < 1e-3) continue;
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const bend = bendAltitudeM(h1);
      let worst = 0;
      for (let i = 1; i < 4_000; i++) {
        const s = (curve.length * i) / 4_000;
        const { h } = curve.at(s);
        if (h > bend * 0.98 || h < h1 * 1.02) continue;
        const travel = travelAngleDeg(curve, arc, s, curve.length * 1e-6);
        worst = Math.max(worst, Math.abs(curve.pitchAt(s) - travel));
      }
      expect(worst, name).toBeLessThan(0.5);
    }
  });

  // The owner's point 3: the turn comes first and is over above the bend,
  // while the view looks straight down at the Earth.
  it("turns first and is done turning above the bend, looking down", () => {
    for (const { name, h0, h1, arc } of cases) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const bend = bendAltitudeM(h1);
      let lowestHighPitch = 90;
      let mostLeftBelow = 0;
      for (let i = 0; i <= 2_000; i++) {
        const s = (curve.length * i) / 2_000;
        const { h, share } = curve.at(s);
        if (h >= bend) {
          lowestHighPitch = Math.min(lowestHighPitch, curve.pitchAt(s));
        } else if (arc > 1e-3) {
          // From the bend down only the dive's own track is left.
          mostLeftBelow = Math.max(mostLeftBelow, (1 - share) * arc);
        }
      }
      expect(lowestHighPitch, name).toBe(90);
      expect(mostLeftBelow, name).toBeLessThanOrEqual(
        curve.diveArcRad * (1 + 1e-6),
      );
    }
  });

  it("starts below the bend (a replan), absorbs the residual early, and ends exactly", () => {
    for (const residualKm of [-3, -0.5, 0.5, 3, 40]) {
      const h0 = 10 * KM;
      const h1 = 2.5 * KM;
      const base = planTravel(h0, h1, 1, { landingM: h1 });
      const dive = base.diveArcRad;
      const arc = dive + (residualKm * KM) / R;
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const end = curve.at(curve.length);
      expect(end.h).toBeCloseTo(h1, 6);
      expect(end.share).toBeCloseTo(1, 12);
      // The view is the travel everywhere, residual included, held between
      // the horizon floor (nearly level travel: a large residual low down, a
      // new place, the documented limit) and straight down (backing off, a
      // start nearer than the dive's own track: the view does not turn round
      // to look behind it).
      let worst = 0;
      for (let i = 1; i < 400; i++) {
        const s = (curve.length * i) / 400;
        const { h } = curve.at(s);
        const floor =
          Math.acos(R / (R + h)) / DEG + FLIGHT_TRAVEL.horizonMarginDeg;
        const travel = travelAngleDeg(curve, arc, s, curve.length * 1e-6);
        // Never shallower than the law (the R1 milestone review: a view on
        // a sideways travel looked at the horizon and snapped at the end).
        const law = travelLawDeg(h, h1);
        const expected = Math.min(90, Math.max(floor, travel, law));
        worst = Math.max(worst, Math.abs(curve.pitchAt(s) - expected));
      }
      expect(worst, `residual ${residualKm} km`).toBeLessThan(0.5);
    }
  });

  // The cold review's finding 6: in the bend the view looks along its
  // travel, ahead of the target; the target must stay on the screen (half of
  // fovY 50, with 5 degrees to spare), for landings 2-12 km.
  it("keeps the target on screen through the bend", () => {
    for (const landingKm of [2, 5, 8, 12]) {
      const h1 = landingKm * KM;
      const arc = 0.6;
      const curve = planTravel(10_100 * KM, h1, arc, { landingM: h1 });
      let worst = 0;
      for (let i = 0; i < 4_000; i++) {
        const s = (curve.length * i) / 4_000;
        if (curve.at(s).h > bendAltitudeM(h1)) continue;
        worst = Math.max(worst, targetOffCentreDeg(curve, arc, h1, s));
      }
      expect(worst, `landing ${landingKm} km`).toBeLessThan(20);
    }
  });

  // WHY (found while building R1): a replan in a flight's last
  // milliseconds is already at the landing's altitude, a level pan; at the
  // level travel's horizon floor its view snapped up by about 40 degrees.
  it("looks as the landing does when it pans at the landing's altitude", () => {
    for (const landingKm of [2, 12]) {
      const h1 = landingKm * KM;
      const curve = planTravel(h1, h1, 1e-6, { landingM: h1 });
      expect(curve.pitchAt(0)).toBeCloseTo(45, 6);
      expect(curve.pitchAt(curve.length)).toBeCloseTo(45, 6);
    }
  });

  // The replans match speeds in this measure (flight-replan's speedAt).
  it("measures its length as the flight's speed criterion does", () => {
    for (const { name, h0, h1, arc } of cases) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      let sum = 0;
      let last = curve.at(0);
      const n = 20_000;
      for (let i = 1; i <= n; i++) {
        const p = curve.at((curve.length * i) / n);
        const ground = Math.abs(p.share - last.share) * arc * R;
        const h = (p.h + last.h) / 2;
        sum += Math.hypot(Math.log(p.h / last.h), ground / h);
        last = p;
      }
      expect(Math.abs(sum - curve.length) / curve.length, name).toBeLessThan(
        1e-3,
      );
    }
  });

  it("moves smoothly: no kink in the camera's motion", () => {
    for (const { name, h0, h1, arc } of cases) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const n = 3_000;
      const d = curve.length / n;
      let worst = 0;
      for (let i = 2; i < n - 2; i++) {
        const a = curve.at(d * (i - 1));
        const b = curve.at(d * i);
        const c = curve.at(d * (i + 1));
        const v1 = Math.log(b.h / a.h);
        const v2 = Math.log(c.h / b.h);
        const scale = Math.max(Math.abs(v1), Math.abs(v2), 1e-6);
        worst = Math.max(worst, Math.abs(v2 - v1) / scale);
      }
      expect(worst, name).toBeLessThan(0.05);
    }
  });

  // WHY (R4/R5 milestone review, 2026-10-08): a climb eased its residual
  // with a smoothstep, whose slope is 0 at the start, so every climb left
  // straight up and turned sideways within about a millisecond: a corner
  // in the camera's motion that a replan's join could not hide (14 of 138
  // climb replans jumped up to 28 % in velocity). The direction of travel
  // (the CF1 measure's two parts) must turn smoothly from the first instant.
  it("leaves a climb in a smooth direction, with no corner at its start", () => {
    const climbs = [
      { name: "a raised landing", h0: 12.6 * KM, h1: 14.7 * KM, arc: 0.0275 },
      { name: "low and near", h0: 2 * KM, h1: 20 * KM, arc: 0.01 },
      { name: "a little higher, far", h0: 5 * KM, h1: 6 * KM, arc: 0.3 },
    ];
    for (const { name, h0, h1, arc } of climbs) {
      const curve = planTravel(h0, h1, arc, { landingM: h1 });
      const direction = (from: number, to: number) => {
        const a = curve.at(from);
        const b = curve.at(to);
        const h = (a.h + b.h) / 2;
        return Math.atan2(Math.log(b.h / a.h), (R * (b.angle - a.angle)) / h);
      };
      for (const share of [1e-5, 1e-4, 1e-3]) {
        const e = share * curve.length;
        const turn = Math.abs(direction(0, e) - direction(e, 2 * e)) / DEG;
        expect(turn, `${name} at ${share}`).toBeLessThan(2);
      }
    }
  });

  it("rejects altitudes that are not positive and an arc that is not finite", () => {
    expect(() => planTravel(0, 2 * KM, 1, { landingM: 2 * KM })).toThrow(
      RangeError,
    );
    expect(() =>
      planTravel(10 * KM, 2 * KM, Number.NaN, { landingM: 2 * KM }),
    ).toThrow(RangeError);
  });
});

// WHY (round-3 plan 2026-10-08-2345, F1 and F1b; the owner on r805: "very
// steep, then 45 rather late; like a meteor"; on r807: "a continuous
// direction, never bending abruptly", and his DEC-R3-9: land at the entry
// angle): a meteor arrives on a straight line, cos(gamma) = p / r with
// p = (R + landing) cos(beta). The law with `meteorDeg` beta is that line
// at every altitude, down to beta at the landing; beta 90 is R1 exactly
// (its ease to 45 below the bend).
describe("the meteor law (travelLawDeg with meteorDeg)", () => {
  const line = (h: number, landing: number, beta: number) =>
    Math.acos(Math.min(1, ((R + landing) * Math.cos(beta * DEG)) / (R + h))) /
    DEG;

  it("is R1 exactly at beta 90", () => {
    for (const h of [1, 3, 30, 300, 3_000, 30_000].map((k) => k * KM)) {
      for (const landing of [1, 2, 12].map((k) => k * KM)) {
        expect(travelLawDeg(h, landing, 90)).toBe(travelLawDeg(h, landing));
      }
    }
  });

  it("follows the straight line above the bend", () => {
    for (const beta of [30, 45, 60]) {
      for (const hKm of [65_000, 10_000, 4_000, 1_000, 200]) {
        expect(
          travelLawDeg(hKm * KM, 2 * KM, beta),
          `${beta} at ${hKm}`,
        ).toBeCloseTo(line(hKm * KM, 2 * KM, beta), 9);
      }
    }
    // The owner's numbers at beta 45: 3.6, 16.0, 25.8, 37.7 off the vertical.
    expect(90 - travelLawDeg(65_000 * KM, 2 * KM, 45)).toBeCloseTo(3.6, 1);
    expect(90 - travelLawDeg(4_000 * KM, 2 * KM, 45)).toBeCloseTo(25.8, 1);
  });

  // F1b (DEC-R3-9): no bend and no ease below it: the line all the way
  // down, so the law ends at beta itself, for every beta and landing.
  it("follows the straight line below the bend too, ending at beta, for every beta", () => {
    for (const beta of [15, 20, 30, 45, 60, 75, 89]) {
      for (const landing of [1, 2, 5, 12].map((k) => k * KM)) {
        const bend = bendAltitudeM(landing);
        for (const h of [bend, bend / 3, landing * 2, landing]) {
          expect(
            travelLawDeg(h, landing, beta),
            `${beta} at ${h} for ${landing}`,
          ).toBeCloseTo(line(h, landing, beta), 9);
        }
        expect(travelLawDeg(landing, landing, beta)).toBeCloseTo(beta, 9);
      }
    }
  });

  // DEC-R3-12 (the owner, 2026-10-09): a press fits a steeper line than
  // asked when its fix is close; it eases to the asked angle near the
  // ground, so every landing looks the same. The landing angle is the
  // law's fourth argument: its line above the bend, an ease from the line's
  // own angle at the bend to the landing angle below it (continuous), R1
  // (beta 90) included; without it a line lands at beta and R1 at 45.
  it("eases a steeper line, and R1, to the asked landing angle below the bend", () => {
    for (const landDeg of [20, 30, 45]) {
      for (const beta of [landDeg + 10, 60, 75, 90]) {
        for (const landing of [1, 2, 5].map((k) => k * KM)) {
          const bend = bendAltitudeM(landing);
          const above = beta >= 90 ? 90 : line(bend * 3, landing, beta);
          expect(
            travelLawDeg(bend * 3, landing, beta, landDeg),
            `${beta} -> ${landDeg} above the bend`,
          ).toBeCloseTo(above, 9);
          expect(
            Math.abs(
              travelLawDeg(bend * 1.0001, landing, beta, landDeg) -
                travelLawDeg(bend * 0.9999, landing, beta, landDeg),
            ),
            `${beta} -> ${landDeg} at the bend`,
          ).toBeLessThan(0.01);
          expect(travelLawDeg(landing, landing, beta, landDeg)).toBe(landDeg);
        }
      }
    }
    expect(travelLawDeg(2 * KM, 2 * KM, 90)).toBe(45);
    expect(travelLawDeg(2 * KM, 2 * KM, 30)).toBeCloseTo(30, 9);
    expect(() => travelLawDeg(10 * KM, 2 * KM, 60, 0)).toThrow(RangeError);
    expect(() => travelLawDeg(10 * KM, 2 * KM, 60, 91)).toThrow(RangeError);
  });
});

describe("the meteor's dive track and its fit (meteorDiveArcRad, fitMeteorDeg)", () => {
  // The line sweeps acos(p / r) - beta of arc from r to the landing: from
  // 65,000 km at beta 45 about 41.4 degrees (the review's 41.38).
  it("sweeps the line's arc", () => {
    expect(meteorDiveArcRad(65_000 * KM, 2 * KM, 45) / DEG).toBeCloseTo(
      41.4,
      0,
    );
    // Falls strictly as beta rises (bisection needs it); R1's is tiny.
    let last = Infinity;
    for (const beta of [20, 30, 45, 60, 75, 85, 90]) {
      const arc = meteorDiveArcRad(2_000 * KM, 2 * KM, beta);
      expect(arc).toBeLessThan(last);
      last = arc;
    }
    expect((meteorDiveArcRad(2_000 * KM, 2 * KM, 90) * R) / KM).toBeLessThan(
      20,
    );
  });

  // A press whose arc is shorter than the line's sweep takes the flattest
  // beta, no flatter than the asked one, whose sweep fits: it never backs
  // off; one with room flies the asked beta.
  it("fits the flattest beta that fits the arc, no flatter than asked", () => {
    const h0 = 10_000 * KM;
    const full = meteorDiveArcRad(h0, 2 * KM, 45);
    expect(fitMeteorDeg(h0, 2 * KM, full * 1.2, 45)).toBe(45);
    // Every candidate lands at the asked 45 (DEC-R3-12).
    const half = fitMeteorDeg(h0, 2 * KM, full / 2, 45);
    expect(half).toBeGreaterThan(45);
    expect(meteorDiveArcRad(h0, 2 * KM, half, 45)).toBeLessThanOrEqual(
      full / 2 + 1e-6,
    );
    expect(meteorDiveArcRad(h0, 2 * KM, half, 45)).toBeGreaterThan(
      full / 2 - 1e-3,
    );
    expect(fitMeteorDeg(h0, 2 * KM, 0, 45)).toBe(90);
    expect(fitMeteorDeg(h0, 2 * KM, -0.1, 45)).toBe(90);
  });
});

// WHY (F1): a link starts ON the meteor's line, so its curve is the line
// itself (no residual turn), and the view looks along the travel at every
// altitude, except where the horizon floor (dip + 5 degrees) keeps the
// Earth on screen (above about 15,800 km at beta 45, the second review).
describe("planTravel on the meteor's line (meteorDeg)", () => {
  const landing = 2 * KM;
  const h0 = 65_000 * KM;
  const beta = 45;
  const arc = meteorDiveArcRad(h0, landing, beta);
  const curve = planTravel(h0, landing, arc, {
    landingM: landing,
    meteorDeg: beta,
  });

  /** The curve's point and pitch at the altitude h (found along its length). */
  const atAltitude = (h: number) => {
    let lo = 0;
    let hi = curve.length;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (curve.at(mid).h > h) lo = mid;
      else hi = mid;
    }
    return { s: lo, pitch: curve.pitchAt(lo) };
  };
  const floorAt = (h: number) =>
    Math.acos(R / (R + h)) / DEG + FLIGHT_TRAVEL.horizonMarginDeg;

  // F1b (DEC-R3-10): no horizon floor for a meteor: it looks along its line
  // at every altitude, even where the floor would have held it (above about
  // 15,800 km at beta 45), and lands at beta (DEC-R3-9).
  it("looks along the line at every altitude, the floor's reach included, landing at beta", () => {
    for (const hKm of [60_000, 30_000, 10_000, 4_000, 1_000, 300]) {
      const h = hKm * KM;
      const { pitch } = atAltitude(h);
      expect(pitch, `${hKm} km`).toBeCloseTo(travelLawDeg(h, landing, beta), 0);
    }
    // Where the floor used to bind, the line is the flatter of the two.
    expect(travelLawDeg(60_000 * KM, landing, beta)).toBeLessThan(
      floorAt(60_000 * KM),
    );
    expect(curve.pitchAt(curve.length)).toBeCloseTo(beta, 6);
  });

  it("flies the line: its ground track at each altitude is the line's own", () => {
    for (const hKm of [10_000, 1_000, 100]) {
      const h = hKm * KM;
      const { s } = atAltitude(h);
      const sweptToHere = (arc - meteorDiveArcRad(h, landing, beta)) / arc;
      expect(curve.at(s).share, `${hKm} km`).toBeCloseTo(sweptToHere, 2);
    }
  });

  it("is R1 exactly without a meteorDeg", () => {
    const r1 = planTravel(10_000 * KM, landing, 0.3, { landingM: landing });
    const same = planTravel(10_000 * KM, landing, 0.3, {
      landingM: landing,
      meteorDeg: 90,
    });
    for (const k of [0, 0.25, 0.5, 0.9]) {
      expect(same.at(r1.length * k)).toEqual(r1.at(r1.length * k));
      expect(same.pitchAt(r1.length * k)).toBe(r1.pitchAt(r1.length * k));
    }
  });
});

// WHY (the milestone review, finding 2): the fit ran a 2,048-step sweep 40
// times on the frame the fix arrived (about 32 ms on a desktop, more on a
// phone, against the 50 ms frame rule). The coarser sweep must stay within
// 50 m of a fine reference over the starts and betas the flights use.
describe("the meteor's sweep at its working resolution", () => {
  const fine = (h0: number, landing: number, b: number) => {
    const n = 16_384;
    const a = Math.log(landing);
    const step = (Math.log(h0) - a) / n;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const h = Math.exp(a + i * step);
      const g = travelLawDeg(h, landing, b) * DEG;
      const f = ((Math.cos(g) / Math.sin(g)) * h) / (R + h);
      sum += f * (i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2);
    }
    return (sum * step) / 3;
  };
  it("stays within 50 m of a fine reference", () => {
    for (const h0 of [2_000, 10_000, 65_000].map((k) => k * KM)) {
      for (const b of [20, 45, 70, 89]) {
        const err =
          Math.abs(meteorDiveArcRad(h0, 2 * KM, b) - fine(h0, 2 * KM, b)) * R;
        expect(err, `${h0 / KM} km, ${b}`).toBeLessThan(50);
      }
    }
  });
});
