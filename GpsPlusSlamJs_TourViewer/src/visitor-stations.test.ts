import { describe, expect, it } from "vitest";
import {
  reportUpdated,
  type TrackingQualityReport,
} from "gps-plus-slam-app-framework/state";

import { createTourViewerStore } from "./tour-viewer-session";
import {
  createCallGuard,
  stationAlignmentSignals,
  walkDirectionsOf,
} from "./visitor-stations";
import { createWalkDirections } from "./walk-direction";

/**
 * Why these tests matter: the station guide trusts a position and judges
 * it on the aligned frame only by these two signals, read from the page's
 * session object and the real tracking-quality slice. A wrong wire (the
 * wrong slice, a stale field) would leave the guide on the raw fix for
 * ever, or trust a GPS-only alignment like a code's (r881 review L3).
 */

function report(state: TrackingQualityReport["state"]): TrackingQualityReport {
  return {
    state,
    confidence: state === "ok" ? 0.9 : 0.3,
    subScores: {
      convergence: 1,
      residualConsensus: 1,
      gpsAccuracy: 1,
      coverage: 1,
    },
    diagnostics: {},
  } as TrackingQualityReport;
}

describe("stationAlignmentSignals", () => {
  it("GPS only: ready exactly while the tracking-quality slice reads ok, and never code-lined-up", () => {
    const store = createTourViewerStore();
    const ctx = { viewerLockedText: null, viewerVotedLocks: 0 };
    const signals = stationAlignmentSignals(ctx, store);
    // No report yet: not ready (the guide judges by the raw fix).
    expect(signals.alignmentReady()).toBe(false);
    store.dispatch(reportUpdated(report("ok")));
    expect(signals.alignmentReady()).toBe(true);
    store.dispatch(reportUpdated(report("degraded")));
    expect(signals.alignmentReady()).toBe(false);
    store.dispatch(reportUpdated(report("warming-up")));
    expect(signals.alignmentReady()).toBe(false);
    expect(signals.codeLinedUp()).toBe(false);
  });

  it("a voted lock lines the alignment up and makes it ready whatever tracking reads; read live from the session", () => {
    const store = createTourViewerStore();
    const ctx: { viewerLockedText: string | null; viewerVotedLocks: number } = {
      viewerLockedText: null,
      viewerVotedLocks: 0,
    };
    const signals = stationAlignmentSignals(ctx, store);
    store.dispatch(reportUpdated(report("degraded")));
    ctx.viewerLockedText = "https://example.test/code";
    ctx.viewerVotedLocks = 1;
    expect(signals.codeLinedUp()).toBe(true);
    expect(signals.alignmentReady()).toBe(true);
    // A lock that cast no vote lines nothing up.
    ctx.viewerVotedLocks = 0;
    expect(signals.codeLinedUp()).toBe(false);
    expect(signals.alignmentReady()).toBe(false);
  });

  // Why: the guide decides what a lined-up code means for its latch, so
  // this signal must read the tracking slice and nothing else - neither
  // hide the report behind a lined-up code nor count a lock as ready.
  it("trackingReady reads the tracking report, not the lock state", () => {
    const store = createTourViewerStore();
    const ctx = {
      viewerLockedText: "https://example.test/code",
      viewerVotedLocks: 1,
    };
    const signals = stationAlignmentSignals(ctx, store);
    expect(signals.trackingReady()).toBe(false);
    store.dispatch(reportUpdated(report("degraded")));
    expect(signals.trackingReady()).toBe(false);
    store.dispatch(reportUpdated(report("ok")));
    expect(signals.trackingReady()).toBe(true);
    ctx.viewerVotedLocks = 0;
    expect(signals.trackingReady()).toBe(true);
  });
});

describe("createCallGuard (W4 build plan M2 review)", () => {
  // Why: a story's change (its `onChange`) can fire from inside a guide
  // call - a find starts the story - and a sheet drawn then reads the
  // guide's half-made view beside a store its batch has not reached yet.
  // The render waits for the outermost call and happens once after it.
  it("defers a render asked for inside a call until the outermost call ends, once", () => {
    let renders = 0;
    const guard = createCallGuard(() => {
      renders += 1;
    });
    guard.request();
    expect(renders).toBe(1);
    guard.during(() => {
      guard.request();
      guard.during(() => {
        guard.request();
      });
      expect(renders).toBe(1);
    });
    expect(renders).toBe(2);
    guard.during(() => undefined);
    expect(renders).toBe(2);
  });

  it("still ends the call and renders when the call throws", () => {
    let renders = 0;
    const guard = createCallGuard(() => {
      renders += 1;
    });
    expect(() => {
      guard.during(() => {
        guard.request();
        throw new Error("boom");
      });
    }).toThrow("boom");
    expect(renders).toBe(1);
    guard.request();
    expect(renders).toBe(2);
  });
});

describe("walkDirectionsOf (W4 build plan M3, §1.5)", () => {
  // Why: the peek and the rows say which way each station is only with a
  // heading and a position to point from (a code's or GPS); the angle is
  // the station's bearing from the camera's, positive to the right; and
  // the words keep their hysteresis across renders but start anew once
  // the directions lapse (a frozen radar, a lost heading).
  const view = (headingDeg: number | null) => ({
    headingDeg,
    bearings: new Map([
      ["a", 10],
      ["b", 100],
      ["c", 350],
      ["d", 190],
    ]),
  });

  it("measures each station from the camera's heading", () => {
    const m = walkDirectionsOf(view(0), "gps", createWalkDirections());
    expect([...m]).toEqual([
      ["a", { word: "ahead", angleDeg: 10 }],
      ["b", { word: "right", angleDeg: 100 }],
      ["c", { word: "ahead", angleDeg: -10 }],
      ["d", { word: "behind", angleDeg: -170 }],
    ]);
    expect(
      walkDirectionsOf(view(90), "code", createWalkDirections()).get("a"),
    ).toEqual({ word: "left", angleDeg: -80 });
  });

  it("says nothing without a heading or a position to point from", () => {
    const memory = createWalkDirections();
    expect(walkDirectionsOf(view(null), "gps", memory).size).toBe(0);
    for (const chip of ["weak", "none", "lost", "pending"] as const) {
      expect(walkDirectionsOf(view(0), chip, memory).size).toBe(0);
    }
  });

  it("holds a word by its hysteresis, and forgets it once they lapse", () => {
    const memory = createWalkDirections();
    // 30 deg: "right" from cold; held at 26 (inside the 5 deg band).
    const at = (deg: number) => ({
      headingDeg: 0,
      bearings: new Map([["a", deg]]),
    });
    expect(walkDirectionsOf(at(30), "gps", memory).get("a")?.word).toBe(
      "right",
    );
    expect(walkDirectionsOf(at(26), "gps", memory).get("a")?.word).toBe(
      "right",
    );
    walkDirectionsOf(at(26), "lost", memory);
    expect(walkDirectionsOf(at(26), "gps", memory).get("a")?.word).toBe(
      "ahead",
    );
  });
});
