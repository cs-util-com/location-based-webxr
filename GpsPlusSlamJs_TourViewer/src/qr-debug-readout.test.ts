/**
 * The TourViewer's fused-pose readout and visitor hint (QR near-frontal
 * pose plan §66-§67).
 *
 * Why these tests matter: since b4b a code votes only while its fused pose
 * is stable, so "the tour did not place" needs to say why. The readout is
 * the owner's only attribution in a field session, and the hint is what a
 * visitor reads instead of "Scanning for the printed code…" while the code
 * IS read - it must never describe a code that left the view, and never
 * send the visitor walking when the votes wait for GPS.
 */
import { describe, expect, it } from "vitest";
import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import {
  HINT_STALE_MS,
  codeLabel,
  debugReadoutLines,
  tallyEvaluation,
  visitorFusedHint,
  type FusedTallies,
} from "./qr-debug-readout.js";

function result(over: Partial<QrFusedPose> = {}): QrFusedPose {
  return {
    status: "measuring",
    pose: null,
    method: "joint",
    views: 3,
    droppedViews: 0,
    fitPx: 0.8,
    windowEntries: 3,
    averagedRotationDeltaDeg: 1,
    frameEpoch: 0,
    oldestTimestamp: 0,
    newestTimestamp: Number.NaN,
    motion: null,
    edgePx: 200,
    notStableReason: "views",
    nativeIgnored: 0,
    ...over,
  };
}

const URL_A = "https://gps.csutil.com/?qr=~abcdefgh&n=1";
const URL_B = "https://gps.csutil.com/?qr=~abcdefgh&n=2";

describe("debugReadoutLines", () => {
  it("shows the controller state, then one line per code with its counts", () => {
    const tallies: FusedTallies = new Map();
    tallyEvaluation(tallies, URL_A, result());
    tallyEvaluation(tallies, URL_A, result({ notStableReason: "fit" }));
    tallyEvaluation(
      tallies,
      URL_A,
      result({ status: "stable", notStableReason: null }),
    );
    tallyEvaluation(tallies, URL_B, result({ notStableReason: "order" }));
    expect(
      debugReadoutLines({
        status: "tracking",
        unknownCode: null,
        unusableCode: null,
        tallies,
      }),
    ).toEqual([
      "qr: tracking",
      "…abcdefgh&n=1: locks 3, stable 1 | views 1 (empty 0), fit 1, fallback 0, motion 0, order 0 | re-reads 0, natives ignored 0",
      "…abcdefgh&n=2: locks 1, stable 0 | views 0 (empty 0), fit 0, fallback 0, motion 0, order 1 | re-reads 0, natives ignored 0",
    ]);
  });

  // A code that is never evaluated (no level, no size) leaves no tally; the
  // head line is then the only attribution.
  it("names an unknown or unusable code and says when nothing was evaluated", () => {
    expect(
      debugReadoutLines({
        status: "scanning",
        unknownCode: "c1",
        unusableCode: "c2",
        tallies: null,
      }),
    ).toEqual([
      "qr: scanning | no level: c1 | no size: c2",
      "no code evaluated yet",
    ]);
  });
});

describe("codeLabel", () => {
  it("keeps a short text and cuts a long one to its end", () => {
    expect(codeLabel("short")).toBe("short");
    expect(codeLabel(URL_A)).toBe("…abcdefgh&n=1");
    expect(codeLabel(URL_A).length).toBeLessThanOrEqual(13);
  });
});

describe("visitorFusedHint", () => {
  const last = (over: Partial<QrFusedPose> = {}, atMs = 1000) => ({
    text: URL_A,
    result: result(over),
    atMs,
  });

  it("says what the fused pose waits for, in the creator's words", () => {
    expect(
      visitorFusedHint({ last: last(), status: "tracking", nowMs: 1000 }),
    ).toBe("Measuring the code: walk slowly around the code.");
    expect(
      visitorFusedHint({
        last: last({ notStableReason: "order" }),
        status: "tracking",
        nowMs: 1000,
      }),
    ).toBe("Measuring the code: code not read clearly, move closer.");
  });

  // Plan §67 #1: a stable pose that did not vote waits for the GPS zero.
  it("does not send the visitor walking when the pose is stable", () => {
    expect(
      visitorFusedHint({
        last: last({ status: "stable", notStableReason: null }),
        status: "tracking",
        nowMs: 1000,
      }),
    ).toBe("Code measured - waiting for the first GPS fix.");
  });

  // Plan §67 #5: never describe a code that left the view.
  it("is silent while not tracking, once stale, and before any evaluation", () => {
    expect(
      visitorFusedHint({ last: last(), status: "scanning", nowMs: 1000 }),
    ).toBeNull();
    expect(
      visitorFusedHint({
        last: last(),
        status: "tracking",
        nowMs: 1000 + HINT_STALE_MS + 1,
      }),
    ).toBeNull();
    expect(
      visitorFusedHint({
        last: last(),
        status: "tracking",
        nowMs: 1000 + HINT_STALE_MS,
      }),
    ).not.toBeNull();
    expect(
      visitorFusedHint({ last: null, status: "tracking", nowMs: 0 }),
    ).toBeNull();
  });
});
