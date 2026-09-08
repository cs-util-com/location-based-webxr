import { describe, expect, it } from "vitest";

import {
  arStatusLine,
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
  authorMode: false,
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
  placement: { kind: "idle" },
  planesError: null,
};

describe("arStatusLine - the fixed prefix", () => {
  it("renders mode and status while the session is not running", () => {
    expect(arStatusLine({ ...RUNNING_BASE, arStatus: "ready" })).toBe(
      "Viewer mode — ready",
    );
    expect(
      arStatusLine({ ...RUNNING_BASE, authorMode: true, arStatus: "starting" }),
    ).toBe("Author mode — starting");
  });

  it("keeps the e2e-pinned running prefix exactly", () => {
    // ar-mode.spec.js asserts this literal text; the prefix is a contract.
    expect(arStatusLine(RUNNING_BASE)).toBe(
      "Viewer mode — AR running · 3 camera frames",
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
        tour: { kind: "open", levelCount: 0, hasRecording: true },
        qr: scanning,
      }),
    ).toBe("This tour has no printed codes.");
  });

  it("keeps scanning while the tour's levels are still loading", () => {
    expect(
      qrSegment({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: null, hasRecording: true },
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
        tour: { kind: "open", levelCount: 0, hasRecording: true },
        qr: { ...scanning, unknownCode: "abc" },
      }),
    ).toBe("Code abc has no level in this tour.");
  });

  it("is empty in author mode and before the pipeline reports", () => {
    expect(qrSegment({ ...RUNNING_BASE, authorMode: true, qr: scanning })).toBe(
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

describe("arStatusLine - composition", () => {
  it("joins prefix, QR line, placement and the images error with middle dots", () => {
    expect(
      arStatusLine({
        ...RUNNING_BASE,
        tour: { kind: "open", levelCount: 1, hasRecording: true },
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
      "Viewer mode — AR running · 3 camera frames · Scanning for the printed code… · photo ring (no recording in this tour) · images failed: That file does not exist.",
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
    ).toBe("Viewer mode — AR running · 3 camera frames · loading photos 1/2…");
  });
});
