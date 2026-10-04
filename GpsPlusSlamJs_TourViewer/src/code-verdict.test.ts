/**
 * The per-code verdict of the summary after Finish (authoring plan
 * 2026-09-28-0953 §3.3, M3b), wired to `combineCodeVisits`.
 *
 * Why these tests matter: the verdict is what the author acts on - walk
 * further, wait, scan again, or stop. Each test pins one branch of the M3a
 * rule with a realistic visit (the thresholds are provisional, the ORDER
 * of the reasons is the design), and the property pins what a verdict must
 * never do: call a code good past the thresholds, or turn a good code bad
 * because the author scanned it once more, under any conditions.
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
  verdictWithoutNumbers,
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

  // Why this test matters (M3a/M3b review #2): the STORED pose is graded
  // by the one visit that saved it, and visitors keep it whatever later
  // visits do (D10b) - so "scan it again" would promise an improvement no
  // further visit can bring. For it, a position short of Good with an
  // honest heading is the GPS that measured it.
  it("never asks to scan again when grading one saved pose: the GPS is what is left", () => {
    const decent = [visit(6.5, 200)];
    expect(verdictOf(decent).kind).toBe("scan-again");
    expect(
      codeVerdict(decent, combineCodeVisits(decent), { averaging: false }).kind,
    ).toBe("wait-for-gps");
    const short = [visit(5, 10)];
    expect(
      codeVerdict(short, combineCodeVisits(short), { averaging: false }).kind,
    ).toBe("walk-further");
  });

  it("names a stored pose it cannot grade, and a code with none, without numbers", () => {
    expect(verdictWithoutNumbers("unknown")).toEqual({
      kind: "unknown",
      text: "Not known on this device",
      numbers: null,
      walkM: null,
    });
    expect(verdictWithoutNumbers("not-saved").text).toBe(
      "No saved position yet",
    );
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

  it("needs 4.77 x the accuracy of walk (24 m at 5 m GPS, the M3a results' example)", () => {
    expect(walkNeededM(5)).toBeCloseTo(23.87, 2);
    expect(walkNeededM(1)).toBeCloseTo(4.773, 3);
  });

  it("keeps its Good when one more POOR visit is added: the position combines only the visits that help", () => {
    // The M3a/M3b review (#3): with 1/a weights over every visit the
    // predicted error sqrt(k) / sum(1/a) ROSE when a much worse visit
    // joined (3.7 m and 30 m: 4.66 m), so "scan it again" could turn a good
    // code bad. The best-prefix rule leaves the 30 m visits out.
    const good = [visit(30, 60), visit(3.7, 60, 1)];
    expect(verdictOf(good).kind).toBe("good");
    expect(verdictOf([...good, visit(30, 60, 2)]).kind).toBe("good");
  });

  it("is never Good past the thresholds, and one more visit of ANY quality never makes a Good code worse (property)", () => {
    const visitArb = fc.record({
      gpsAccuracyM: fc.double({ min: 1, max: 20, noNaN: true }),
      baselineM: fc.double({ min: 1, max: 200, noNaN: true }),
      n: fc.double({ min: -10, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(visitArb, { minLength: 1, maxLength: 5 }),
        visitArb,
        (raw, more) => {
          const visits = raw.map((r) =>
            visit(r.gpsAccuracyM, r.baselineM, r.n),
          );
          const extra = visit(more.gpsAccuracyM, more.baselineM, more.n);
          const v = verdictOf(visits);
          expect(Object.values(VERDICT_TEXT)).toContain(v.text);
          const n = v.numbers!;
          const within =
            n.predictedHorizontalM <= VERDICT_GOOD_HORIZONTAL_M &&
            n.predictedHeadingDeg <= VERDICT_GOOD_HEADING_DEG;
          expect(v.kind === "good").toBe(within);
          const again = verdictOf([...visits, extra]).kind;
          expect(v.kind !== "good" || again === "good").toBe(true);
        },
      ),
    );
  });
});
