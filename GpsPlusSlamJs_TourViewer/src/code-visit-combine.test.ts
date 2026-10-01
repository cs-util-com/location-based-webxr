/**
 * Unit tests of `combineCodeVisits` (authoring plan 2026-09-28-0953 §3.3,
 * M3a): one printed code's world pose from the poses several AR visits
 * measured, weighted the way the M3a spike measured best.
 */
import { describe, expect, it } from "vitest";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
} from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  CODE_YAW_NOISE_DEG,
  MIN_BASELINE_M,
  MIN_VISIT_ACCURACY_M,
  combineCodeVisits,
  type CodeVisitPose,
} from "./code-visit-combine.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// The library gates its geodesy helpers on a licence the store activates.
createTourViewerStore();

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };
const ALT = 401.5;

/** A vertical poster `n` m North and `e` m East of ORIGIN whose printed
 *  face looks toward `normalDeg` (its local +X at `normalDeg - 90`). */
function poster(n: number, e: number, normalDeg: number): QrGeoPose {
  const ll = calcGpsCoords(ORIGIN, [n, ALT, e]);
  const headingDeg = normalDeg - 90;
  const half = (-headingDeg * Math.PI) / 360;
  return {
    lat: ll.lat,
    lon: ll.lon,
    alt: ALT,
    headingDeg,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  };
}

function visit(
  n: number,
  e: number,
  normalDeg: number,
  gpsAccuracyM = 5,
  baselineM = 30,
): CodeVisitPose {
  return { geo: poster(n, e, normalDeg), gpsAccuracyM, baselineM };
}

/** The combined pose back in metres from ORIGIN and the face's bearing. */
function read(geo: QrGeoPose): { n: number; e: number; normalDeg: number } {
  const nue = calcRelativeCoordsInMeters(
    ORIGIN,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  const [x, y, z, w] = geo.rotation!;
  const nx = 2 * (x * z + w * y);
  const nz = 1 - 2 * (x * x + y * y);
  return {
    n: nue[0],
    e: nue[2],
    normalDeg: (Math.atan2(nz, nx) * 180) / Math.PI,
  };
}

const headingSigmaDeg = (a: number, l: number): number =>
  (Math.hypot(
    (CODE_YAW_NOISE_DEG * Math.PI) / 180,
    Math.atan(a / Math.max(l, MIN_BASELINE_M)),
  ) *
    180) /
  Math.PI;

describe("combineCodeVisits", () => {
  // Why this test matters: one visit is today's case (the first visit's
  // pose is the reference, D10b). Combining must not move it, and its
  // predicted error must be that visit's own: accuracy for the position,
  // the heading model for the facing.
  it("returns a single visit's pose unchanged, with its own predicted error", () => {
    const result = combineCodeVisits([visit(10, -4, 180, 6, 20)]);
    expect(result).not.toBeNull();
    const pose = read(result!.geo);
    expect(pose.n).toBeCloseTo(10, 2);
    expect(pose.e).toBeCloseTo(-4, 2);
    expect(pose.normalDeg).toBeCloseTo(180, 2);
    expect(result!.visitCount).toBe(1);
    expect(result!.predictedHorizontalM).toBeCloseTo(6, 6);
    expect(result!.predictedHeadingDeg).toBeCloseTo(headingSigmaDeg(6, 20), 6);
    expect(result!.maxOffsetM).toBeCloseTo(0, 2);
    expect(result!.maxHeadingOffsetDeg).toBeCloseTo(0, 2);
  });

  // Why this test matters: the position weight is 1/accuracy (the M3a
  // spike's robust choice between trusting the reported accuracy fully,
  // 1/a², and not at all). A visit twice as accurate counts twice.
  it("weights the position by 1/accuracy", () => {
    const result = combineCodeVisits([
      visit(0, 0, 180, 3),
      visit(9, 0, 180, 6),
    ]);
    const pose = read(result!.geo);
    expect(pose.n).toBeCloseTo(3, 2);
    expect(pose.e).toBeCloseTo(0, 2);
    // sqrt(k) / sum(1/a): 1.414 / 0.5
    expect(result!.predictedHorizontalM).toBeCloseTo(Math.SQRT2 / 0.5, 6);
    expect(result!.maxOffsetM).toBeCloseTo(6, 2);
  });

  // Why this test matters: with 1/accuracy weights, sqrt(k) / sum(1/a)
  // RISES when a much worse visit joins (3.7 m alone 3.7 m, with a 30 m
  // visit 4.66 m, with two 5.14 m), so the summary's "scan it again" would
  // make the code worse on screen (M3a/M3b review #3). The position combines
  // only the best visits by accuracy - the prefix that minimises the
  // prediction - so the estimate, its ring and its verdict all describe
  // the same subset, and a worse visit is simply not used.
  it("combines the position from the best prefix of visits by accuracy, so a much worse visit is not used", () => {
    const good = visit(0, 0, 180, 3.7, 30);
    const poor = visit(20, 0, 180, 30, 30);
    const poor2 = visit(0, 20, 180, 30, 30);
    const one = combineCodeVisits([good])!;
    const two = combineCodeVisits([poor, good])!;
    const three = combineCodeVisits([poor, good, poor2])!;
    for (const result of [two, three]) {
      expect(result.predictedHorizontalM).toBeCloseTo(3.7, 6);
      expect(result.positionVisitCount).toBe(1);
      const pose = read(result.geo);
      expect(pose.n).toBeCloseTo(0, 2);
      expect(pose.e).toBeCloseTo(0, 2);
    }
    expect(one.positionVisitCount).toBe(1);
    // Every usable visit still counts, and still has its say in the heading.
    expect(three.visitCount).toBe(3);
  });

  // Why this test matters: the subset rule must still average visits that
  // help: 4 m and 5 m together predict sqrt(2) / (1/4 + 1/5) = 3.14 m,
  // better than the 4 m visit alone.
  it("keeps a worse visit that still lowers the prediction", () => {
    const result = combineCodeVisits([
      visit(0, 0, 180, 4),
      visit(9, 0, 180, 5),
    ])!;
    expect(result.positionVisitCount).toBe(2);
    expect(result.predictedHorizontalM).toBeCloseTo(Math.SQRT2 / 0.45, 6);
    expect(read(result.geo).n).toBeCloseTo((9 * 0.2) / 0.45, 2);
  });

  // Why this test matters: the heading of a visit is as good as its walked
  // baseline lets the GPS alignment be (`atan(accuracy / baseline)`), so a
  // short visit must not drag a long one's facing. The spike measured this
  // weighting best in every arm.
  it("weights the heading by the heading model", () => {
    const long = visit(0, 0, 180, 5, 60);
    const short = visit(0, 0, 200, 5, 6);
    const wLong = 1 / headingSigmaDeg(5, 60) ** 2;
    const wShort = 1 / headingSigmaDeg(5, 6) ** 2;
    const expected = 180 + (20 * wShort) / (wLong + wShort);
    const result = combineCodeVisits([long, short]);
    // A weighted circular mean; at 20 degrees apart it is within 0.05°
    // of the weighted linear mean computed here.
    const off = read(result!.geo).normalDeg - expected;
    expect(Math.abs(((off + 540) % 360) - 180)).toBeLessThan(0.05);
    expect(result!.maxHeadingOffsetDeg).toBeGreaterThan(15);
  });

  // Why this test matters: headings wrap at ±180; a mean taken on raw
  // degrees would put two posters facing 179° and -179° facing 0°.
  it("averages headings across the ±180° wrap", () => {
    const result = combineCodeVisits([visit(0, 0, 179), visit(0, 0, -179)]);
    const normal = read(result!.geo).normalDeg;
    expect(Math.abs(Math.abs(normal) - 180)).toBeLessThan(0.05);
  });

  // Why this test matters: accuracy and baseline come from the page's own
  // bookkeeping and a restored draft (external data). A zero or tiny
  // accuracy would take all the weight; a zero baseline divides by zero.
  it("floors the accuracy and the baseline", () => {
    const tiny = combineCodeVisits([
      visit(0, 0, 180, 0.01),
      visit(10, 0, 180, MIN_VISIT_ACCURACY_M),
    ]);
    expect(read(tiny!.geo).n).toBeCloseTo(5, 2);
    const flat = combineCodeVisits([visit(0, 0, 180, 5, 0)]);
    expect(flat!.predictedHeadingDeg).toBeCloseTo(
      headingSigmaDeg(5, MIN_BASELINE_M),
      6,
    );
  });

  // Why this test matters: defensive at the boundary - an unusable visit
  // (non-finite numbers, a non-positive accuracy, no orientation) is
  // skipped rather than poisoning the mean, and nothing usable gives null.
  it("skips unusable visits and returns null when none is usable", () => {
    const good = visit(4, 4, 180);
    const bad: CodeVisitPose[] = [
      { ...visit(100, 0, 0), gpsAccuracyM: Number.NaN },
      { ...visit(100, 0, 0), gpsAccuracyM: -1 },
      { ...visit(100, 0, 0), baselineM: Number.POSITIVE_INFINITY },
      {
        geo: { lat: Number.NaN, lon: 0, alt: 0, headingDeg: 0 },
        gpsAccuracyM: 5,
        baselineM: 5,
      },
      {
        geo: { lat: 48, lon: 11, alt: 0 } as QrGeoPose,
        gpsAccuracyM: 5,
        baselineM: 5,
      },
    ];
    const result = combineCodeVisits([...bad, good]);
    expect(result!.visitCount).toBe(1);
    expect(read(result!.geo).n).toBeCloseTo(4, 2);
    expect(combineCodeVisits(bad)).toBeNull();
    expect(combineCodeVisits([])).toBeNull();
  });

  // Why this test matters: a heading-only level (no quaternion, as older
  // levels and hand-edited ones are) must combine the same as its
  // quaternion twin.
  it("reads a heading-only level like its quaternion twin", () => {
    const withRotation = visit(2, 3, 150);
    const headingOnly: CodeVisitPose = {
      ...withRotation,
      geo: {
        lat: withRotation.geo.lat,
        lon: withRotation.geo.lon,
        alt: withRotation.geo.alt,
        headingDeg: 60,
      },
    };
    const a = read(combineCodeVisits([withRotation])!.geo);
    const b = read(combineCodeVisits([headingOnly])!.geo);
    expect(b.normalDeg).toBeCloseTo(a.normalDeg, 6);
  });
});
