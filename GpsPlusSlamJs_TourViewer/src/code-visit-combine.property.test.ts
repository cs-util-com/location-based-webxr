/**
 * Properties of `combineCodeVisits` (authoring plan 2026-09-28-0953 §3.3,
 * M3a).
 *
 * Why these properties matter: the combined pose is what a summary screen
 * would show and, if the owner chooses so, what a Finish could re-estimate
 * the code's reference to - every note anchored to the code would move
 * with it. So it must behave as a weighted mean for ANY set of visits: not
 * depend on the order the visits happened to be stored in, never land
 * outside the visits it averages, never turn the face outside their arc,
 * and never predict a worse error from more evidence.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
} from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { combineCodeVisits, type CodeVisitPose } from "./code-visit-combine.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

createTourViewerStore();

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };

interface Spec {
  n: number;
  e: number;
  normalOffsetDeg: number;
  accuracyM: number;
  baselineM: number;
}

const spec: fc.Arbitrary<Spec> = fc.record({
  n: fc.double({ min: -50, max: 50, noNaN: true }),
  e: fc.double({ min: -50, max: 50, noNaN: true }),
  normalOffsetDeg: fc.double({ min: -60, max: 60, noNaN: true }),
  accuracyM: fc.double({ min: 0.5, max: 20, noNaN: true }),
  baselineM: fc.double({ min: 0, max: 200, noNaN: true }),
});
const visits = fc.array(spec, { minLength: 1, maxLength: 6 });
const centre = fc.double({ min: -180, max: 180, noNaN: true });

function toVisit(s: Spec, centreDeg: number): CodeVisitPose {
  const ll = calcGpsCoords(ORIGIN, [s.n, 401.5, s.e]);
  const headingDeg = centreDeg + s.normalOffsetDeg - 90;
  const half = (-headingDeg * Math.PI) / 360;
  const geo: QrGeoPose = {
    lat: ll.lat,
    lon: ll.lon,
    alt: 401.5,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  };
  return { geo, gpsAccuracyM: s.accuracyM, baselineM: s.baselineM };
}

function read(geo: QrGeoPose): { n: number; e: number; normalDeg: number } {
  const nue = calcRelativeCoordsInMeters(
    ORIGIN,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  const [x, y, z, w] = geo.rotation!;
  return {
    n: nue[0],
    e: nue[2],
    normalDeg:
      (Math.atan2(1 - 2 * (x * x + y * y), 2 * (x * z + w * y)) * 180) /
      Math.PI,
  };
}

const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

describe("combineCodeVisits properties", () => {
  it("does not depend on the order of the visits", () => {
    fc.assert(
      fc.property(visits, centre, (specs, c) => {
        const a = combineCodeVisits(specs.map((s) => toVisit(s, c)))!;
        const b = combineCodeVisits(
          [...specs].reverse().map((s) => toVisit(s, c)),
        )!;
        const pa = read(a.geo);
        const pb = read(b.geo);
        expect(Math.hypot(pa.n - pb.n, pa.e - pb.e)).toBeLessThan(0.01);
        expect(Math.abs(wrapDeg(pa.normalDeg - pb.normalDeg))).toBeLessThan(
          1e-3,
        );
        expect(a.predictedHorizontalM).toBeCloseTo(b.predictedHorizontalM, 9);
        expect(a.predictedHeadingDeg).toBeCloseTo(b.predictedHeadingDeg, 9);
      }),
    );
  });

  it("lands inside the visits' extent and turns inside their arc", () => {
    fc.assert(
      fc.property(visits, centre, (specs, c) => {
        const result = combineCodeVisits(specs.map((s) => toVisit(s, c)))!;
        const p = read(result.geo);
        const ns = specs.map((s) => s.n);
        const es = specs.map((s) => s.e);
        expect(p.n).toBeGreaterThanOrEqual(Math.min(...ns) - 0.01);
        expect(p.n).toBeLessThanOrEqual(Math.max(...ns) + 0.01);
        expect(p.e).toBeGreaterThanOrEqual(Math.min(...es) - 0.01);
        expect(p.e).toBeLessThanOrEqual(Math.max(...es) + 0.01);
        const offset = wrapDeg(p.normalDeg - c);
        const offsets = specs.map((s) => s.normalOffsetDeg);
        expect(offset).toBeGreaterThanOrEqual(Math.min(...offsets) - 1e-3);
        expect(offset).toBeLessThanOrEqual(Math.max(...offsets) + 1e-3);
      }),
    );
  });

  // The horizontal half is the M3a/M3b review's #3: with 1/accuracy
  // weights over every visit, a much worse visit raised the prediction, and
  // the summary's "scan it again" then made the code look worse.
  it("never predicts a larger error from one more visit, horizontally or in heading, nor beyond the worst visit", () => {
    fc.assert(
      fc.property(visits, spec, centre, (specs, extra, c) => {
        const base = combineCodeVisits(specs.map((s) => toVisit(s, c)))!;
        const more = combineCodeVisits(
          [...specs, extra].map((s) => toVisit(s, c)),
        )!;
        expect(more.predictedHeadingDeg).toBeLessThanOrEqual(
          base.predictedHeadingDeg + 1e-9,
        );
        expect(more.predictedHorizontalM).toBeLessThanOrEqual(
          base.predictedHorizontalM + 1e-9,
        );
        const worst = Math.max(...specs.map((s) => Math.max(s.accuracyM, 1)));
        expect(base.predictedHorizontalM).toBeLessThanOrEqual(worst + 1e-9);
      }),
    );
  });

  it("returns the pose itself for identical visits, with sigma / sqrt(k)", () => {
    fc.assert(
      fc.property(spec, fc.integer({ min: 1, max: 6 }), centre, (s, k, c) => {
        const one = toVisit(s, c);
        const result = combineCodeVisits(Array.from({ length: k }, () => one))!;
        const p = read(result.geo);
        expect(Math.hypot(p.n - s.n, p.e - s.e)).toBeLessThan(0.01);
        expect(
          Math.abs(wrapDeg(p.normalDeg - c - s.normalOffsetDeg)),
        ).toBeLessThan(1e-3);
        expect(result.predictedHorizontalM).toBeCloseTo(
          Math.max(s.accuracyM, 1) / Math.sqrt(k),
          9,
        );
        expect(result.maxOffsetM).toBeLessThan(0.01);
      }),
    );
  });
});
