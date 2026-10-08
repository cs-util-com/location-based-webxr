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

  it("rejects altitudes that are not positive and an arc that is not finite", () => {
    expect(() => planTravel(0, 2 * KM, 1, { landingM: 2 * KM })).toThrow(
      RangeError,
    );
    expect(() =>
      planTravel(10 * KM, 2 * KM, Number.NaN, { landingM: 2 * KM }),
    ).toThrow(RangeError);
  });
});
