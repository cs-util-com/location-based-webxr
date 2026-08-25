import { describe, expect, it, vi } from "vitest";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
  buildViewerControllerConfig,
  imagePlaneRingNue,
  viewerStatusLine,
  type ViewerPipelineDeps,
} from "./qr-viewer-mode";

/**
 * Why these tests matter: viewer mode is where a stranger's phone WRITES
 * into the alignment via synthetic GPS votes — the two guardrails the plan
 * ordered are a per-code VOTE BUDGET (review #6: every locked frame
 * dispatches a fresh vote set, so an unbounded visitor standing at the
 * poster injects thousands of near-identical points and pins the alignment
 * centroid) and the wide-baseline CAP (delta #6: minted rotation error
 * enters every wide-baseline correspondence at ~0.17 m per degree per 10 m,
 * so `voteBaselineM` starts ≤ 2 and only M5's measured numbers may raise
 * it). The level lookup's placeholder is the deferred negative cache: a
 * scanned code with no level must not flap the controller at 8 Hz.
 */

const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  },
};

function fakeDeps(
  overrides: Partial<ViewerPipelineDeps> = {},
): ViewerPipelineDeps {
  return {
    frontEnd: {
      kind: "barcode-detector" as const,
      detect: () => Promise.resolve(null),
    },
    solvePose: () => null,
    getCameraPose: () => null,
    getIntrinsics: () => null,
    getLevels: () => new Map([["1", LEVEL]]),
    dispatchVote: vi.fn(),
    canAcceptVotes: () => true,
    resolveStablePose: () => null,
    recordDetection: vi.fn(),
    onError: vi.fn(),
    onUnknownCode: vi.fn(),
    onUnusableLevel: vi.fn(),
    ...overrides,
  };
}

const TEXT = "https://gps.csutil.com/tour/?qr=x&c=1";

describe("buildViewerControllerConfig", () => {
  it("pins the wide-baseline cap at 2 m — only M5's measurements may raise it", () => {
    const config = buildViewerControllerConfig(fakeDeps());
    expect(VIEWER_VOTE_BASELINE_M).toBe(2);
    expect(config.voteBaselineM).toBe(VIEWER_VOTE_BASELINE_M);
    expect(config.voteCount).toBe(VIEWER_VOTE_COUNT);
    expect(config.syntheticAccuracyM).toBe(VIEWER_SYNTHETIC_ACCURACY_M);
    expect(config.minIntervalMs).toBe(0); // single cadence owner (Option A)
  });

  it("resolves the DETECTED code's level from the open tour", async () => {
    const config = buildViewerControllerConfig(fakeDeps());
    await expect(config.fetchLevel(TEXT)).resolves.toBe(LEVEL);
  });

  it("resolves a geo-less placeholder for an unknown code (the negative cache)", async () => {
    // A rejecting fetchLevel would drive the controller into an
    // error↔scanning flap at the detection cadence; a resolved geo-less
    // level is cached per text and simply never votes.
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    const level = await config.fetchLevel(
      "https://gps.csutil.com/tour/?qr=x&c=7",
    );
    expect(level).toEqual({ version: 1, qr: {} });
    expect(deps.onUnknownCode).toHaveBeenCalledWith("7");
  });

  it("stops dispatching votes after the per-code budget", () => {
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    const votes = [{ v: 1 }, { v: 2 }] as never[];
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE + 3; i += 1) {
      // The controller's documented ordering: onDetection fires before the
      // vote of the same frame — the budget keys off that text.
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes(votes);
    }
    expect(deps.dispatchVote).toHaveBeenCalledTimes(
      MAX_VOTED_LOCKS_PER_CODE * votes.length,
    );
  });

  it("budgets per code, not globally", () => {
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    const votes = [{ v: 1 }] as never[];
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes(votes);
    }
    config.onDetection?.({
      text: "https://gps.csutil.com/tour/?qr=x&c=2",
      timestamp: 99,
    } as QrDetectionEvent);
    config.dispatchVotes(votes);
    expect(deps.dispatchVote).toHaveBeenCalledTimes(
      MAX_VOTED_LOCKS_PER_CODE + 1,
    );
  });

  it("does not charge the budget while the store cannot accept votes", () => {
    // Why this matters (M4 milestone review #2): recordGpsEvent silently
    // no-ops until the session zero exists (first real GPS fix). Ten locked
    // frames arrive in ~1.3 s — comfortably inside first-fix latency — so a
    // budget charged for dropped votes told the visitor "Relocalized" after
    // writing NOTHING, with no recovery inside the session.
    let canAccept = false;
    const deps = fakeDeps({ canAcceptVotes: () => canAccept });
    const config = buildViewerControllerConfig(deps);
    const votes = [{ v: 1 }] as never[];
    for (let i = 0; i < 5; i += 1) {
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes(votes);
    }
    expect(deps.dispatchVote).not.toHaveBeenCalled();

    canAccept = true; // the first fix landed — the FULL budget is available
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      config.onDetection?.({
        text: TEXT,
        timestamp: 10 + i,
      } as QrDetectionEvent);
      config.dispatchVotes(votes);
    }
    expect(deps.dispatchVote).toHaveBeenCalledTimes(MAX_VOTED_LOCKS_PER_CODE);
  });

  it("wires the stability gate the controller skips unconverged votes on", () => {
    // Why this matters (M4 milestone review #3): without resolveStablePose
    // the controller votes the RAW single-frame solve — the jittery pose
    // the plan's minting delta explicitly rejected — and the budget bounds
    // volume without buying any averaging.
    const stable = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as never;
    const deps = fakeDeps({ resolveStablePose: () => stable });
    const config = buildViewerControllerConfig(deps);
    expect(config.resolveStablePose?.(TEXT)).toBe(stable);
  });

  it("falls back to the PAGE's launch code for payloads without a discriminator", async () => {
    // Why this matters (M4 milestone review #6): a printed payload that is
    // not a URL, or a URL without &c=, must resolve to the code the visitor
    // actually scanned to get here — not silently to "1".
    const deps = fakeDeps({
      pageCode: "2",
      getLevels: () => new Map([["2", LEVEL]]),
    });
    const config = buildViewerControllerConfig(deps);
    await expect(
      config.fetchLevel("https://gps.csutil.com/tour/?qr=x"),
    ).resolves.toBe(LEVEL);
  });

  it("reports a level that exists but cannot solve (no printed size)", async () => {
    const deps = fakeDeps({
      getLevels: () =>
        new Map([["1", { version: 1, qr: { geo: LEVEL.qr.geo } } as QrLevel]]),
    });
    const config = buildViewerControllerConfig(deps);
    await config.fetchLevel(TEXT);
    expect(deps.onUnusableLevel).toHaveBeenCalledWith("1");
  });

  it("still records every detection while the budget is spent", () => {
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    config.onDetection?.({ text: TEXT, timestamp: 1 } as QrDetectionEvent);
    expect(deps.recordDetection).toHaveBeenCalledTimes(1);
  });
});

describe("viewerStatusLine", () => {
  it("covers the visitor-facing states in plain words", () => {
    expect(
      viewerStatusLine({
        status: null,
        unknownCode: null,
        votedLocks: 0,
        lockedText: null,
      }),
    ).toBe("");
    expect(
      viewerStatusLine({
        status: "scanning",
        unknownCode: null,
        votedLocks: 0,
        lockedText: null,
      }),
    ).toMatch(/scanning/i);
    expect(
      viewerStatusLine({
        status: "tracking",
        unknownCode: null,
        votedLocks: 4,
        lockedText: TEXT,
      }),
    ).toMatch(/4 of \d+/);
    expect(
      viewerStatusLine({
        status: "tracking",
        unknownCode: null,
        votedLocks: MAX_VOTED_LOCKS_PER_CODE,
        lockedText: TEXT,
      }),
    ).toMatch(/placement holds/i);
    expect(
      viewerStatusLine({
        status: "scanning",
        unknownCode: "7",
        votedLocks: 0,
        lockedText: null,
      }),
    ).toMatch(/code 7 has no/i);
    expect(
      viewerStatusLine({
        status: "tracking",
        unknownCode: null,
        unusableCode: "3",
        votedLocks: 0,
        lockedText: null,
      }),
    ).toMatch(/no printed size/i);
    // The quality number (M4 review #8) rides the relocalizing states.
    expect(
      viewerStatusLine({
        status: "tracking",
        unknownCode: null,
        votedLocks: 2,
        lockedText: TEXT,
        reprojectionErrorPx: 1.234,
      }),
    ).toMatch(/pose error 1.2 px/i);
  });
});

describe("imagePlaneRingNue", () => {
  it("places count planes on a ring around the anchor at its height", () => {
    const positions = imagePlaneRingNue([10, 2, -4], 3, 1.5);
    expect(positions).toHaveLength(3);
    for (const [n, u, e] of positions) {
      expect(u).toBeCloseTo(2, 9);
      expect(Math.hypot(n - 10, e - -4)).toBeCloseTo(1.5, 9);
    }
    // Distinct directions — not all stacked on one spot.
    const unique = new Set(
      positions.map(([n, , e]) => `${n.toFixed(3)}|${e.toFixed(3)}`),
    );
    expect(unique.size).toBe(3);
  });
});
