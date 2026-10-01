/**
 * The per-code verdict of the summary after Finish (authoring plan
 * 2026-09-28-0953 §3.3, M3b), wired to `combineCodeVisits`.
 *
 * Why these tests matter: the verdict is what the author acts on - walk
 * further, wait, scan again, or stop. Each test pins one branch of the M3a
 * rule with a realistic visit (the thresholds are provisional, the ORDER
 * of the reasons is the design), and the property pins what a verdict must
 * never do: call a code good past the thresholds, or turn a good code bad
 * because the author scanned it once more under the same conditions.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { combineCodeVisits, type CodeVisitPose } from "./code-visit-combine.js";
import {
  codeVerdict,
  VERDICT_GOOD_HEADING_DEG,
  VERDICT_GOOD_HORIZONTAL_M,
  VERDICT_TEXT,
  walkNeededM,
} from "./code-verdict.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// The library gates its geodesy helpers on a licence the store activates.
createTourViewerStore();

const ORIGIN: LatLong = { lat: 47.5, lon: 8.7 };

function poster(n: number, e: number, headingDeg: number): QrGeoPose {
  const ll = calcGpsCoords(ORIGIN, [n, 400, e]);
  const half = (-headingDeg * Math.PI) / 360;
  return {
    lat: ll.lat,
    lon: ll.lon,
    alt: 400,
    headingDeg,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  };
}

function visit(gpsAccuracyM: number, baselineM: number, n = 0): CodeVisitPose {
  return { geo: poster(n, 0, 30), gpsAccuracyM, baselineM };
}

function verdictOf(visits: CodeVisitPose[]) {
  return codeVerdict(visits, combineCodeVisits(visits));
}

describe("codeVerdict", () => {
  it("calls two decent visits with a real walk Good, with the numbers behind it", () => {
    const v = verdictOf([visit(4, 40), visit(5, 30, 2)]);
    expect(v.kind).toBe("good");
    expect(v.text).toBe("Good");
    expect(v.numbers?.visitCount).toBe(2);
    expect(v.numbers?.predictedHorizontalM).toBeLessThanOrEqual(5);
    expect(v.numbers?.bestAccuracyM).toBe(4);
    expect(v.numbers?.longestWalkM).toBe(40);
    expect(v.numbers?.maxOffsetM).toBeGreaterThan(0);
    expect(v.walkM).toBeNull();
  });

  it("asks for a longer walk first when the heading cannot be trusted", () => {
    // 5 m GPS over a 10 m walk: atan(5/10) is 27 degrees. The GPS is also
    // too poor for "Good" on position; the walk still comes first.
    const v = verdictOf([visit(5, 10)]);
    expect(v.kind).toBe("walk-further");
    expect(v.text).toBe("Walk further from the code");
    expect(v.walkM).toBeCloseTo(walkNeededM(5), 9);
  });

  it("asks to wait for better GPS when even the best visit is poor", () => {
    const v = verdictOf([visit(12, 200), visit(10, 200)]);
    expect(v.numbers!.predictedHeadingDeg).toBeLessThanOrEqual(
      VERDICT_GOOD_HEADING_DEG,
    );
    expect(v.kind).toBe("wait-for-gps");
    expect(v.text).toBe("Wait for better GPS");
  });

  it("asks for another visit when one decent visit is not enough on its own", () => {
    const v = verdictOf([visit(6, 40)]);
    expect(v.kind).toBe("scan-again");
    expect(v.text).toBe("Scan it again in another AR visit");
    // And a second visit like it is what makes it good.
    expect(verdictOf([visit(6, 40), visit(6, 40, 1)]).kind).toBe("good");
  });

  it("says scan again, with no numbers, for a code no visit measured", () => {
    const v = codeVerdict([], null);
    expect(v).toEqual({
      kind: "scan-again",
      text: VERDICT_TEXT["scan-again"],
      numbers: null,
      walkM: null,
    });
  });

  it("needs about 24 m of walk at 5 m GPS (the M3a results' example)", () => {
    expect(walkNeededM(5)).toBeGreaterThan(23);
    expect(walkNeededM(5)).toBeLessThan(25);
  });

  it("can lose its Good to one more POOR visit: the adopted 1/accuracy weighting predicts it so", () => {
    // Not a defect of the verdict, a property of the M3a weighting the
    // owner may want to revisit (open question 1 of the results): with
    // weights 1/a the predicted error is sqrt(k) / sum(1/a), which a visit
    // much worse than the others RAISES. 1/a² weighting would not.
    const good = [visit(30, 60), visit(3.7, 60, 1)];
    expect(verdictOf(good).kind).toBe("good");
    expect(verdictOf([...good, visit(30, 60, 2)]).kind).toBe("scan-again");
  });

  it("is never Good past the thresholds, and one more visit like the BEST never makes a Good code worse (property)", () => {
    const visitArb = fc.record({
      gpsAccuracyM: fc.double({ min: 1, max: 20, noNaN: true }),
      baselineM: fc.double({ min: 1, max: 200, noNaN: true }),
      n: fc.double({ min: -10, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(visitArb, { minLength: 1, maxLength: 5 }), (raw) => {
        const visits = raw.map((r) => visit(r.gpsAccuracyM, r.baselineM, r.n));
        const v = verdictOf(visits);
        expect(Object.values(VERDICT_TEXT)).toContain(v.text);
        const n = v.numbers!;
        const within =
          n.predictedHorizontalM <= VERDICT_GOOD_HORIZONTAL_M &&
          n.predictedHeadingDeg <= VERDICT_GOOD_HEADING_DEG;
        expect(v.kind === "good").toBe(within);
        const best = visits.reduce((a, b) =>
          b.gpsAccuracyM < a.gpsAccuracyM ? b : a,
        );
        const again = verdictOf([...visits, best]).kind;
        expect(v.kind !== "good" || again === "good").toBe(true);
      }),
    );
  });
});
