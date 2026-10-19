import { describe, expect, it } from "vitest";
import {
  reportUpdated,
  type TrackingQualityReport,
} from "gps-plus-slam-app-framework/state";

import { createTourViewerStore } from "./tour-viewer-session";
import { stationAlignmentSignals } from "./visitor-stations";

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
