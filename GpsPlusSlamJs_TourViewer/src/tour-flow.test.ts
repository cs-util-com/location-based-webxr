import { describe, expect, it } from "vitest";

import {
  arStatusLine,
  contentSegment,
  clearCacheLabel,
  isPlacementReady,
  placementSegment,
  qrSegment,
  type ArStatusInput,
  type PlacementState,
} from "./tour-flow.js";

/**
 * Why these tests matter (flows plan M1): the AR status line is the ONLY
 * feedback a visitor gets during a session (`#error` is outside the DOM
 * overlay). Its copy used to be composed inline in `main.ts`'s
 * `renderArStatus`, where no test could pin it - and the first on-phone
 * session found it promising a printed code to a tour that cannot carry one
 * (F3). Every branch of the line is pinned here, string-exact, so a copy
 * regression is a red test and not a field report.
 */

const RUNNING_BASE: ArStatusInput = {
  mode: "visitor",
  arStatus: "running",
  cameraFrames: 3,
  tour: { kind: "none" },
  qr: {
    status: null,
    unknownCode: null,
    unusableCode: null,
    votedLocks: 0,
    lockedText: null,
    reprojectionErrorPx: null,
  },
  readiness: null,
  placement: { kind: "idle" },
  planesError: null,
  gate: { kind: "idle" },
  content: { kind: "none" },
};

describe("the scan gate and the content in the composed line (M5)", () => {
  it("a scanning gate shows its line and suppresses the placement's coaching hint", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      gate: { kind: "scanning", escapeOffered: false },
      placement: { kind: "waiting-ready" },
      readiness: {
        phase: "move-around",
        hint: "Walk around a few steps.",
        percentReady: 40,
      },
    });
    expect(line).toContain("Point the phone at the printed code");
    expect(line).not.toContain("Walk around");
  });

  it("a passed gate lets the placement segment back in, and names the placed content", () => {
    const line = arStatusLine({
      ...RUNNING_BASE,
      gate: { kind: "passed", via: "code" },
      placement: { kind: "waiting-ready" },
      readiness: {
        phase: "move-around",
        hint: "Walk around a few steps.",
        percentReady: 40,
      },
      content: { kind: "placed", count: 2, skipped: 1 },
    });
    expect(line).toContain("Code recognised");
    expect(line).toContain("Walk around");
    expect(line).toContain("2 placed objects (1 could not load)");
    expect(contentSegment({ kind: "placed", count: 1, skipped: 0 })).toBe(
      "1 placed object",
    );
  });
});

describe("arStatusLine - the fixed prefix", () => {
  it("renders mode and status while the session is not running", () => {
    expect(arStatusLine({ ...RUNNING_BASE, arStatus: "ready" })).toBe(
      "Visitor mode — ready",
    );
    expect(
      arStatusLine({ ...RUNNING_BASE, mode: "creator", arStatus: "starting" }),
    ).toBe("Creator mode — starting");
  });

  it("keeps the e2e-pinned running prefix exactly", () => {
    // ar-mode.spec.js asserts this literal text; the prefix is a contract.
    expect(arStatusLine(RUNNING_BASE)).toBe(
      "Visitor mode — AR running · 3 camera frames",
    );
  });
});

describe("qrSegment - the printed-code line", () => {
  const scanning = {
    ...RUNNING_BASE.qr,
    status: { state: "scanning" } as unknown as NonNullable<
      ArStatusInput["qr"]["status"]
    >,
  };

  it("says the tour has no printed codes instead of scanning for one (F3)", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 0 },
        qr: scanning,
      }),
    ).toBe("This tour has no printed codes.");
  });

  it("keeps scanning while the tour's levels are still loading", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: null },
        qr: scanning,
      }),
    ).toBe("Scanning for the printed code…");
  });

  it("keeps scanning with no tour open - the 2026-09-04 verdict (DEC-T9)", () => {
    expect(qrSegment({ ...RUNNING_BASE, qr: scanning })).toBe(
      "Scanning for the printed code…",
    );
  });

  it("lets a detected unknown code override the no-codes line", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 0 },
        qr: { ...scanning, unknownCode: "abc" },
      }),
    ).toBe("Code abc has no level in this tour.");
  });

  it("is empty in author mode and before the pipeline reports", () => {
    expect(qrSegment({ ...RUNNING_BASE, mode: "creator", qr: scanning })).toBe(
      "",
    );
    expect(qrSegment(RUNNING_BASE)).toBe("");
  });
});

describe("placementSegment - what the photo placement did", () => {
  const cases: [PlacementState, string][] = [
    [{ kind: "idle" }, ""],
    [
      { kind: "placing", phase: "reading-walk", done: 3, total: 10 },
      "reading the walk 3/10…",
    ],
    [
      { kind: "placing", phase: "loading-photos", done: 2, total: 5 },
      "loading photos 2/5…",
    ],
    [
      {
        kind: "placed",
        placedKind: "capture-spots",
        count: 7,
        fixes: 4,
        gpsAccuracyMedianM: 5,
      },
      "7 photos at capture spots (4 fixes, median GPS ±5.0m)",
    ],
    [
      {
        kind: "placed",
        placedKind: "capture-spots",
        count: 7,
        fixes: 4,
        gpsAccuracyMedianM: null,
      },
      "7 photos at capture spots (4 fixes)",
    ],
    [
      { kind: "declined", reason: "no recording in this tour" },
      "photo ring (no recording in this tour)",
    ],
  ];

  it.each(cases)("renders %j", (placement, expected) => {
    expect(placementSegment(placement)).toBe(expected);
  });
});

describe("readiness - the placement trigger and its waiting copy (F3, flows plan M4)", () => {
  // Why this matters: at the first GPS fix the alignment is the identity
  // (no heading), so placing then can start the scene up to 180° wrong.
  // The trigger is the tracking-quality `ready` phase, and while waiting
  // the visitor reads the framework's coaching line - never silence and
  // never "Scanning for the printed code…".
  it("isPlacementReady is true only for a report in the ok state", () => {
    expect(isPlacementReady(null)).toBe(false);
    expect(
      isPlacementReady({
        state: "warming-up",
        confidence: 0.2,
        subScores: {
          convergence: 0,
          residualConsensus: 0,
          gpsAccuracy: 0,
          coverage: 0.2,
        },
      } as never),
    ).toBe(false);
    expect(
      isPlacementReady({
        state: "ok",
        confidence: 0.9,
        subScores: {
          convergence: 1,
          residualConsensus: 1,
          gpsAccuracy: 1,
          coverage: 1,
        },
      } as never),
    ).toBe(true);
  });

  it("waiting-ready renders the phase's coaching hint, or a generic wait without one", () => {
    expect(
      placementSegment(
        { kind: "waiting-ready" },
        {
          phase: "move-around",
          percentReady: 0.3,
          hint: "Walk around a few steps so tracking can warm up.",
        },
      ),
    ).toBe("Walk around a few steps so tracking can warm up.");
    expect(placementSegment({ kind: "waiting-ready" }, null)).toBe(
      "Waiting for tracking to warm up…",
    );
  });

  it("nothing-to-place names why, and the composed line carries it", () => {
    const input: ArStatusInput = {
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 0 },
      placement: { kind: "nothing-to-place" },
    };
    expect(arStatusLine(input)).toBe(
      "Visitor mode — AR running · 3 camera frames · nothing to place: this tour has no recording and no printed codes",
    );
  });

  it("derives nothing-to-place from a declined join on a tour with no recording and no codes", () => {
    // The levels can arrive AFTER the decline; the line must follow the
    // tour's facts at render time, not the order events happened in.
    const declined: ArStatusInput = {
      ...RUNNING_BASE,
      tour: { kind: "open", levelCount: 0 },
      placement: { kind: "declined", reason: "no recording in this tour" },
    };
    expect(arStatusLine(declined)).toContain("nothing to place");
    expect(arStatusLine(declined)).not.toContain("photo ring");
    // A RECORDING whose join declined (no GPS in the walk) on a code-less
    // tour is the same case: a decline means the recording path is out,
    // and with zero codes a ring can never come (milestone review #1).
    expect(
      arStatusLine({
        ...declined,
        tour: { kind: "open", levelCount: 0 },
        placement: { kind: "declined", reason: "no GPS fixes in the walk" },
      }),
    ).toContain("nothing to place");
    // With codes the ring is still coming: the decline stands as written.
    expect(
      arStatusLine({
        ...declined,
        tour: { kind: "open", levelCount: 2 },
      }),
    ).toContain("photo ring (no recording in this tour)");
  });

  it("a placed ring is confirmed, not left on the decline copy (milestone review #2)", () => {
    expect(
      placementSegment({ kind: "placed", placedKind: "ring", count: 3 }),
    ).toBe("3 photos in a ring around the code");
  });
});

describe("clearCacheLabel - the Clear-cache confirmation (F1)", () => {
  // Why this matters: the old label read "Cache cleared" whatever happened,
  // and a count read AFTER the open session's eviction would say 0 for the
  // single-tour case - the exact "nothing happened" the report was about.
  it("names the count, singular and plural, and the empty case", () => {
    expect(clearCacheLabel(0)).toBe("Cache cleared - nothing was stored");
    expect(clearCacheLabel(1)).toBe("Cache cleared - 1 stored tour removed");
    expect(clearCacheLabel(3)).toBe("Cache cleared - 3 stored tours removed");
  });
});

describe("arStatusLine - composition", () => {
  it("joins prefix, QR line, placement and the images error with middle dots", () => {
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 1 },
        qr: {
          ...RUNNING_BASE.qr,
          status: { state: "scanning" } as unknown as NonNullable<
            ArStatusInput["qr"]["status"]
          >,
        },
        placement: { kind: "declined", reason: "no recording in this tour" },
        planesError: "That file does not exist.",
      }),
    ).toBe(
      "Visitor mode — AR running · 3 camera frames · Scanning for the printed code… · photo ring (no recording in this tour) · images failed: That file does not exist.",
    );
  });

  it("omits empty segments", () => {
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        placement: {
          kind: "placing",
          phase: "loading-photos",
          done: 1,
          total: 2,
        },
      }),
    ).toBe("Visitor mode — AR running · 3 camera frames · loading photos 1/2…");
  });
});
