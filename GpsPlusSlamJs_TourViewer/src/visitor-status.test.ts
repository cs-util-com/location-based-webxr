/**
 * Why these tests matter (UI round 1, U1; usability review F1, F15): the
 * visitor's only feedback in AR is one line. It used to be a debug readout
 * ("Visitor mode - AR running · 412 camera frames · Relocalizing - 2 of 3
 * vote batches. Pose error 1.3 px."). Each state a visitor can be in must
 * now read as ONE plain sentence with no counters, and every state that
 * exists must still be told apart (the cold review's G-1 list), because a
 * silent or wrong line is how a visitor gets lost. The `state` name is the
 * stable channel tests and the page read instead of the wording.
 */
import { describe, expect, it } from "vitest";

import type { ArStatusInput } from "./tour-flow";
import { visitorStatus } from "./visitor-status";

function input(overrides: Partial<ArStatusInput> = {}): ArStatusInput {
  return {
    mode: "visitor",
    arStatus: "running",
    cameraFrames: 412,
    tour: { kind: "open", levelCount: 1 },
    qr: {
      status: "scanning",
      unknownCode: null,
      unusableCode: null,
      votedLocks: 0,
      lockedText: null,
      reprojectionErrorPx: null,
    },
    readiness: null,
    placement: { kind: "idle" },
    planesError: null,
    contentError: null,
    gate: { kind: "scanning", escapeOffered: false },
    content: { kind: "none" },
    ...overrides,
  };
}

const qr = (o: Partial<ArStatusInput["qr"]>) => ({ ...input().qr, ...o });

describe("visitorStatus - one plain sentence per state", () => {
  it.each<[string, Partial<ArStatusInput>, string, string]>([
    [
      "checking AR support",
      { arStatus: "checking" },
      "checking",
      "Checking whether this phone can show the tour in AR…",
    ],
    ["starting AR", { arStatus: "starting" }, "starting", "Starting AR…"],
    [
      "an unsupported phone",
      { arStatus: "unsupported" },
      "unsupported",
      "This phone or browser can't show the tour in AR. Open this page in Chrome on an Android phone that supports AR.",
    ],
    [
      "AR failed to start",
      { arStatus: "error" },
      "error",
      "AR could not start. Tap Try again.",
    ],
    ["ready, before AR", { arStatus: "ready" }, "before-ar", ""],
    [
      "scanning for the code",
      {},
      "scan",
      "Point your phone at the tour's code (on the poster).",
    ],
    [
      "scanning, the GPS escape offered",
      { gate: { kind: "scanning", escapeOffered: true } },
      "scan",
      "Point your phone at the tour's code (on the poster), or tap Continue with GPS only below.",
    ],
    [
      "the code in view, its position still being measured",
      {
        qr: qr({
          status: "tracking",
          fusedHint: "Measuring the code: keep moving slowly, still measuring.",
        }),
      },
      "measuring-code",
      "Measuring the code: keep moving slowly, still measuring.",
    ],
    [
      "a code of another tour",
      { qr: qr({ unknownCode: "https://example.test/other" }) },
      "code-other-tour",
      "This code isn't part of this tour. Point your phone at the tour's own code.",
    ],
    [
      "a code that cannot line up the tour",
      { qr: qr({ unusableCode: "https://example.test/t" }) },
      "code-unusable",
      "This code can't line up the tour. Point your phone at another of the tour's codes, or continue with GPS only.",
    ],
    [
      "a code the moved-code check ignores",
      {
        qr: qr({ ignoredCode: "https://example.test/t" }),
        gate: { kind: "passed", via: "ignored" },
      },
      "code-moved",
      "This code seems to have been moved, so the tour is placed by GPS (less exact).",
    ],
    [
      "the code found, the tour not placed yet",
      {
        gate: { kind: "passed", via: "code" },
        qr: qr({ status: "tracking", lockedText: "t", votedLocks: 1 }),
      },
      "locking",
      "Code found - placing the tour…",
    ],
    [
      "waiting for tracking, the framework's hint",
      {
        gate: { kind: "passed", via: "code" },
        placement: { kind: "waiting-ready" },
        readiness: {
          phase: "walk",
          hint: "Walk a few steps so the phone finds its bearings.",
        } as never,
      },
      "warming-up",
      "Walk a few steps so the phone finds its bearings.",
    ],
    [
      "loading the photos",
      {
        gate: { kind: "passed", via: "code" },
        placement: {
          kind: "placing",
          phase: "loading-photos",
          done: 3,
          total: 12,
        },
      },
      "placing",
      "Loading photos (3 of 12)…",
    ],
    [
      "reading the walk",
      {
        gate: { kind: "passed", via: "code" },
        placement: {
          kind: "placing",
          phase: "reading-walk",
          done: 50,
          total: 900,
        },
      },
      "placing",
      "Placing the photos…",
    ],
    [
      "placed through the code",
      {
        gate: { kind: "passed", via: "code" },
        placement: {
          kind: "placed",
          placedKind: "capture-spots",
          count: 12,
          fixes: 34,
          gpsAccuracyMedianM: 3.2,
        },
      },
      "placed",
      "Tour placed. Look around.",
    ],
    [
      "only the tour's content placed",
      {
        gate: { kind: "passed", via: "code" },
        content: { kind: "placed", count: 4, skipped: 0 },
      },
      "placed",
      "Tour placed. Look around.",
    ],
    [
      "placed by GPS after the escape",
      {
        gate: { kind: "passed", via: "skipped" },
        placement: { kind: "placed", placedKind: "ring", count: 3 },
      },
      "placed-gps",
      "Tour placed by GPS (less exact). Look around. Find the poster's code to line it up.",
    ],
    [
      "a browser without a code reader",
      {
        gate: { kind: "not-required", reason: "no-detector" },
        content: { kind: "placed", count: 2, skipped: 0 },
      },
      "placed-gps",
      "Tour placed by GPS (less exact): this browser can't read codes. Look around.",
    ],
    [
      "the tour's code file unreadable",
      {
        gate: { kind: "not-required", reason: "levels-unavailable" },
        placement: {
          kind: "placing",
          phase: "loading-photos",
          done: 1,
          total: 4,
        },
      },
      "placing",
      "Loading photos (1 of 4)…",
    ],
    [
      "a tour with nothing to show",
      {
        gate: { kind: "not-required", reason: "no-lockable-level" },
        placement: { kind: "nothing-to-place" },
      },
      "nothing",
      "This tour has nothing to show here.",
    ],
  ])("%s", (_name, overrides, state, text) => {
    expect(visitorStatus(input(overrides))).toEqual({ state, text });
  });
});

describe("visitorStatus - why AR did not start, in plain words (review F5)", () => {
  it.each<[string, string, string]>([
    [
      "a blocked camera or AR permission",
      "NotAllowedError: Permission denied",
      "Camera access was blocked. Allow the camera for this site in the browser settings, then tap Try again.",
    ],
    [
      "a session the browser refuses",
      "NotSupportedError: The specified session configuration is not supported.",
      "This phone can't start AR for this tour. Open this page in Chrome on an Android phone that supports AR.",
    ],
    [
      "anything else",
      "world group missing",
      "AR could not start. Tap Try again.",
    ],
  ])("%s", (_name, error, text) => {
    expect(visitorStatus(input({ arStatus: "error", arError: error }))).toEqual(
      {
        state: "error",
        text,
      },
    );
  });
});

describe("visitorStatus - what must never reach a visitor", () => {
  it("no counters, mode prefix or debug numbers in any running state", () => {
    const states: Partial<ArStatusInput>[] = [
      {},
      {
        gate: { kind: "passed", via: "code" },
        qr: qr({
          status: "tracking",
          lockedText: "t",
          votedLocks: 2,
          reprojectionErrorPx: 1.3,
        }),
        placement: {
          kind: "placed",
          placedKind: "capture-spots",
          count: 12,
          fixes: 34,
          gpsAccuracyMedianM: 3.2,
        },
      },
    ];
    for (const s of states) {
      const { text } = visitorStatus(input(s));
      expect(text).not.toMatch(
        /Visitor mode|camera frames|vote batch|px|fixes|±/,
      );
    }
  });

  it("never tells a visitor who walked on to scan the code again (the hold ended)", () => {
    const { text, state } = visitorStatus(
      input({
        gate: { kind: "passed", via: "code" },
        qr: qr({
          status: "tracking",
          lockedText: "t",
          votedLocks: 10,
          hold: { kind: "ended", text: "t" } as never,
        }),
        placement: { kind: "placed", placedKind: "ring", count: 3 },
      }),
    );
    expect(state).toBe("placed");
    expect(text).not.toMatch(/scan the code again/i);
  });

  it("says what could not load, after the state's sentence", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          content: { kind: "placed", count: 4, skipped: 2 },
          planesError: "HTTP 404",
        }),
      ),
    ).toEqual({
      state: "placed",
      text: "Tour placed. Look around. 2 items could not load. Some photos could not load.",
    });
  });
});
