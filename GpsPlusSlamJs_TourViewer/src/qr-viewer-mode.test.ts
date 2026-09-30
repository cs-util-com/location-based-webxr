import { beforeAll, describe, expect, it, vi } from "vitest";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_KEEP_ALIVE_FADE_MS,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
  buildViewerControllerConfig,
  createViewerKeepAlive,
  imagePlaneRingNue,
  viewerStatusLine,
  type ViewerPipelineDeps,
} from "./qr-viewer-mode";
import { createTourViewerStore } from "./tour-viewer-session";

// The vote builder's geodesy is licence-gated; the store's construction
// activates it (the same activation main.ts performs at boot).
createTourViewerStore();

/**
 * Why these tests matter: viewer mode is where a stranger's phone WRITES
 * into the alignment via synthetic GPS votes — the two guardrails the plan
 * ordered are a per-code VOTE BUDGET (review #6: every locked frame
 * dispatches a fresh vote set, so an unbounded visitor standing at the
 * poster injects thousands of near-identical points and pins the alignment
 * centroid) and the vote geometry, which is now the MEASURED one (authoring
 * plan 2026-09-28-0953 M0b/M0c/M2a: a 30 m ring of 16 votes per lock; the old
 * 2 m cap left the heading 6-31° off after a scan). The level lookup's
 * placeholder is the deferred negative cache: a scanned code with no level
 * must not flap the controller at 8 Hz.
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
    getIntrinsics: () => null,
    getLevels: () => new Map([[TEXT_ID, LEVEL]]),
    dispatchVote: vi.fn(),
    canAcceptVotes: () => true,
    resolveStablePose: () => null,
    recordDetection: vi.fn(),
    onError: vi.fn(),
    onUnknownCode: vi.fn(),
    onUnusableLevel: vi.fn(),
    onLevelResolved: vi.fn(),
    ...overrides,
  };
}

const TEXT = "https://gps.csutil.com/tour/?qr=x";
/** The code identity TEXT hashes to — what a tour zip names its level. */
let TEXT_ID = "";
beforeAll(async () => {
  TEXT_ID = await qrCodeId(TEXT);
});

describe("buildViewerControllerConfig", () => {
  // The values M0b/M0c measured (results doc 2026-09-28-1433): a 30 m ring
  // (heading 0.45° after the scan at 4 votes, B = 8 m, against 18.1° at
  // 2 m; the radius does not amplify the saved code's own heading error)
  // and 16 votes per lock (owner decision D13 on M2a's count lever: 8 left
  // the code 0.31-0.58 m off after 8+ minutes of GPS before the scan; 16
  // met the rule on every measured arm up to a 15-minute walk).
  // Changing one means re-running the harness, `viewer-vote-strength.test.ts`.
  it("pins the measured vote geometry: a 30 m ring of 16 votes per lock", () => {
    const config = buildViewerControllerConfig(fakeDeps());
    expect(VIEWER_VOTE_BASELINE_M).toBe(30);
    expect(VIEWER_VOTE_COUNT).toBe(16);
    expect(VIEWER_SYNTHETIC_ACCURACY_M).toBe(5);
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
    const other = "https://gps.csutil.com/tour/?qr=other";
    const level = await config.fetchLevel(other);
    expect(level).toEqual({ version: 1, qr: {} });
    expect(deps.onUnknownCode).toHaveBeenCalledWith(await qrCodeId(other));
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

  it("keys the budget by the decoded text, which IS the code's identity", () => {
    // Why this matters: the budget used to key by the resolved &c= value,
    // because two different payloads could name one code. Identity is now
    // the hash of the exact decoded text, so distinct texts are distinct
    // codes by construction and text is the equivalent key - the one
    // available synchronously here, where deriving a hash is not.
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    const votes = [{ v: 1 }] as never[];
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE + 3; i += 1) {
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes(votes);
    }
    // A payload one character apart is a different poster, with its own budget.
    config.onDetection?.({
      text: TEXT + "&n=2",
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

  // Plan §61 #6: the controller asks for the stable pose BEFORE it knows
  // the vote will be refused, and the fused pose costs ~10 ms per lock on
  // the phone. Once a code's budget is spent it must not be evaluated.
  it("stops asking for the stable pose once the code's vote budget is spent", () => {
    const resolveStablePose = vi.fn(() => ({
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    }));
    const deps = fakeDeps({ resolveStablePose });
    const config = buildViewerControllerConfig(deps);
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes([{ v: 1 }] as never[]);
    }
    resolveStablePose.mockClear();
    expect(config.resolveStablePose?.(TEXT)).toBeNull();
    expect(resolveStablePose).not.toHaveBeenCalled();
    expect(config.resolveStablePose?.("another code")).not.toBeNull();
  });

  it("reports the resolved level to the app's synchronous cache", async () => {
    // Why this matters: deriving a code's identity is async, but the debug
    // view and the image planes need the level synchronously. The one place
    // that can await it hands the answer over here, so nothing re-derives it
    // - and an unknown code reports null rather than the placeholder, which
    // would otherwise read as a real level.
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    await config.fetchLevel(TEXT);
    expect(deps.onLevelResolved).toHaveBeenCalledWith(TEXT, LEVEL);
    const other = "https://gps.csutil.com/tour/?qr=nope";
    await config.fetchLevel(other);
    expect(deps.onLevelResolved).toHaveBeenCalledWith(other, null);
  });

  it("reports a level that exists but cannot solve (no printed size)", async () => {
    const deps = fakeDeps({
      getLevels: () =>
        new Map([
          [TEXT_ID, { version: 1, qr: { geo: LEVEL.qr.geo } } as QrLevel],
        ]),
    });
    const config = buildViewerControllerConfig(deps);
    await config.fetchLevel(TEXT);
    expect(deps.onUnusableLevel).toHaveBeenCalledWith(TEXT_ID);
  });

  it("still records every detection while the budget is spent", () => {
    const deps = fakeDeps();
    const config = buildViewerControllerConfig(deps);
    config.onDetection?.({ text: TEXT, timestamp: 1 } as QrDetectionEvent);
    expect(deps.recordDetection).toHaveBeenCalledTimes(1);
  });
});

describe("buildViewerControllerConfig - the lock adapter (M5)", () => {
  // Why this matters (M5 review #4): the scan gate keys on this callback.
  // The adapter used to guard on the last detected text and could drop a
  // real lock without a diagnostic; now it forwards the level, always, and
  // stays absent when the app did not ask for it (the controller treats an
  // absent callback as "no lock reporting").
  it("forwards every lock's level, and is absent when the app does not listen", () => {
    const onLocked = vi.fn();
    const config = buildViewerControllerConfig(fakeDeps({ onLocked }));
    config.onLocked?.({} as never, LEVEL);
    expect(onLocked).toHaveBeenCalledWith(LEVEL, false);
    expect(buildViewerControllerConfig(fakeDeps()).onLocked).toBeUndefined();
  });

  // Why this matters (authoring plan 2026-09-28-0953 §2.2 B3, M2b): the
  // gate used to pass on ANY lock, including one that cast no vote - the
  // store not yet able to take votes, or the pose still converging - so the
  // content was placed through an alignment no code had corrected. The
  // adapter now says whether the locked code has voted in this AR entry.
  it("tells the app whether the locked code has cast votes in this entry", () => {
    const onLocked = vi.fn();
    let accepting = false;
    const config = buildViewerControllerConfig(
      fakeDeps({ onLocked, canAcceptVotes: () => accepting }),
    );
    const frame = (i: number): void => {
      config.onDetection?.({ text: TEXT, timestamp: i } as QrDetectionEvent);
      config.dispatchVotes([{ v: i }] as never[]);
      config.onLocked?.({} as never, LEVEL);
    };
    frame(1); // the store drops votes: none cast
    expect(onLocked).toHaveBeenLastCalledWith(LEVEL, false);
    accepting = true;
    frame(2);
    expect(onLocked).toHaveBeenLastCalledWith(LEVEL, true);
    // A lock without a vote of its own (the budget spent, the pose not
    // re-evaluated) still belongs to a code that has voted.
    config.onDetection?.({ text: TEXT, timestamp: 3 } as QrDetectionEvent);
    config.onLocked?.({} as never, LEVEL);
    expect(onLocked).toHaveBeenLastCalledWith(LEVEL, true);
  });
});

describe("buildViewerControllerConfig - the keep-alive (authoring plan M2b)", () => {
  // Why this matters: once the budget is spent the config stops asking for
  // the stable pose (§61 #6), so the keep-alive can only re-vote from a pose
  // the config KEPT when a lock last voted. These pin that hand-over, that a
  // lock which cast nothing hands nothing over, and (M2b review #1) that a
  // kept pose older than one hold window is never held again: a re-scan past
  // it earns a fresh voted lock from a fresh stable pose.
  const T = 1_790_000_000_000;
  const POSE = {
    position: [2, 1.5, -3] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  /** Where the same printed code reads after 20 minutes of tracking drift. */
  const MOVED = {
    position: [2.9, 1.5, -3.4] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  function pipeline(canAccept = true) {
    const keepAlive = createViewerKeepAlive();
    const stable = { pose: POSE };
    const dispatchVote = vi.fn();
    const config = buildViewerControllerConfig(
      fakeDeps({
        keepAlive,
        dispatchVote,
        canAcceptVotes: () => canAccept,
        resolveStablePose: () => stable.pose,
      }),
    );
    /** One locked frame in the controller's order; whether it voted. The
     *  vote carries the pose it was built from, so a test can tell which. */
    const frame = (atMs: number, text = TEXT): boolean => {
      config.onDetection?.({ text, timestamp: atMs } as QrDetectionEvent);
      const pose = config.resolveStablePose?.(text) ?? null;
      const before = dispatchVote.mock.calls.length;
      if (pose !== null) {
        config.dispatchVotes([{ odomPosition: pose.position }] as never[]);
      }
      config.onLocked?.({} as never, LEVEL);
      return dispatchVote.mock.calls.length > before;
    };
    return { keepAlive, config, frame, stable, dispatchVote };
  }
  const at = (t: number) => ({ atMs: t, stampMs: t });
  function centroidOf(
    votes: readonly { odomPosition: readonly number[] }[],
  ): number[] {
    const c = [0, 0, 0];
    for (const v of votes) {
      for (let k = 0; k < 3; k += 1) c[k]! += v.odomPosition[k]! / votes.length;
    }
    return c;
  }

  it("keeps the last voted pose after the budget stops resolving it, and re-votes from it", () => {
    const p = pipeline();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE + 3; i += 1) p.frame(T + i);
    expect(p.config.resolveStablePose?.(TEXT)).toBeNull(); // spent
    const votes = p.keepAlive.votesForFix(at(T + 1000));
    // The keep-alive's full-strength ring is the lock's count (D13: 16).
    expect(votes).toHaveLength(16);
    const c = centroidOf(votes);
    for (let k = 0; k < 3; k += 1)
      expect(c[k]).toBeCloseTo(POSE.position[k]!, 4);
  });

  // Why (M2b review #7): the docs said the keep-alive starts once the budget
  // is spent; it starts at the first voted lock, so its rings ride along
  // with the scan's own burst. This pins what the docs now say.
  it("is armed by the FIRST voted lock, not by the spent budget", () => {
    const p = pipeline();
    p.frame(T);
    expect(p.keepAlive.phase(T)).toEqual({
      kind: "holding",
      text: TEXT,
      remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS,
    });
    expect(p.keepAlive.votesForFix(at(T + 500))).toHaveLength(16);
  });

  it("keeps nothing for a lock that cast no votes", () => {
    const p = pipeline(false);
    p.frame(T);
    expect(p.keepAlive.phase(T)).toEqual({ kind: "none" });
    expect(p.keepAlive.votesForFix(at(T + 1000))).toEqual([]);
  });

  it("holds from the kept code's LAST lock: a re-scan inside the hold window restarts the hold, without new votes", () => {
    const p = pipeline();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) p.frame(T + i);
    const rescan = T + VIEWER_KEEP_ALIVE_HOLD_MS - 10_000;
    expect(p.frame(rescan)).toBe(false); // budget spent, pose still fresh
    expect(p.keepAlive.phase(rescan + 60_000)).toEqual({
      kind: "holding",
      text: TEXT,
      remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS - 60_000,
    });
  });

  it("a re-scan 20 minutes later votes afresh from the code's CURRENT stable pose, and the keep-alive re-votes from it", () => {
    const p = pipeline();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) p.frame(T + i);
    const late = T + 20 * 60_000;
    expect(p.keepAlive.phase(late).kind).toBe("ended");
    p.stable.pose = MOVED;
    // The re-scan's own frame votes: the budget was re-armed for it.
    expect(p.frame(late)).toBe(true);
    expect(p.dispatchVote).toHaveBeenLastCalledWith({
      odomPosition: MOVED.position,
    });
    expect(p.keepAlive.phase(late)).toEqual({
      kind: "holding",
      text: TEXT,
      remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS,
    });
    const c = centroidOf(p.keepAlive.votesForFix(at(late + 1000)));
    for (let k = 0; k < 3; k += 1)
      expect(c[k]).toBeCloseTo(MOVED.position[k]!, 4);
    // A full new burst, then spent again.
    for (let i = 1; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      expect(p.frame(late + i)).toBe(true);
    }
    expect(p.frame(late + MAX_VOTED_LOCKS_PER_CODE)).toBe(false);
  });

  it("re-arms a spent code the keep-alive no longer holds (stopped at a frame change)", () => {
    const p = pipeline();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) p.frame(T + i);
    p.keepAlive.stop(); // what the pipeline does when the odometry frame changes
    p.stable.pose = MOVED;
    expect(p.frame(T + 5000)).toBe(true);
    expect(p.keepAlive.holdsFreshPose(TEXT, T + 5000)).toBe(true);
  });

  it("a re-scan of a code another code took over from votes afresh and takes the keep-alive back", () => {
    const OTHER = "https://gps.csutil.com/tour/?qr=other";
    const p = pipeline();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) p.frame(T + i);
    p.frame(T + 30_000, OTHER);
    expect(p.keepAlive.phase(T + 30_000)).toMatchObject({ text: OTHER });
    expect(p.frame(T + 40_000)).toBe(true);
    expect(p.keepAlive.phase(T + 40_000)).toMatchObject({ text: TEXT });
  });

  it("without a keep-alive a spent code stays spent (the budget is the only rule)", () => {
    const dispatchVote = vi.fn();
    const config = buildViewerControllerConfig(
      fakeDeps({ dispatchVote, resolveStablePose: () => POSE }),
    );
    for (let i = 0; i <= MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      const atMs = i === MAX_VOTED_LOCKS_PER_CODE ? T + 20 * 60_000 : T + i;
      config.onDetection?.({ text: TEXT, timestamp: atMs } as QrDetectionEvent);
      if (config.resolveStablePose?.(TEXT) != null) {
        config.dispatchVotes([{ v: i }] as never[]);
      }
    }
    expect(dispatchVote).toHaveBeenCalledTimes(MAX_VOTED_LOCKS_PER_CODE);
  });

  it("pins the measured hold and fade: two minutes each (owner, D9 applied after M0c)", () => {
    expect(VIEWER_KEEP_ALIVE_HOLD_MS).toBe(120_000);
    expect(VIEWER_KEEP_ALIVE_FADE_MS).toBe(120_000);
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
    // A spent budget with no word from the keep-alive claims no hold.
    expect(
      viewerStatusLine({
        status: "tracking",
        unknownCode: null,
        votedLocks: MAX_VOTED_LOCKS_PER_CODE,
        lockedText: TEXT,
      }),
    ).not.toMatch(/hold/i);
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

  // Why this matters (authoring plan 2026-09-28-0953 §2.2 B1): the line
  // said "placement holds" once the budget was spent, while the code's
  // votes were already fading out of the solve and, above a 5 m GPS bias,
  // being trimmed within ~30 s. The line now says what the keep-alive does:
  // holds (with the time left), fades, or has ended.
  it("says what the keep-alive does once the budget is spent: holding, fading, ended", () => {
    const spent = {
      status: "tracking" as const,
      unknownCode: null,
      votedLocks: MAX_VOTED_LOCKS_PER_CODE,
      lockedText: TEXT,
      reprojectionErrorPx: 0.8,
    };
    expect(
      viewerStatusLine({
        ...spent,
        hold: { kind: "holding", text: TEXT, remainingMs: 95_200 },
      }),
    ).toBe(
      "Relocalized - the code holds the placement for 96 s more. Pose error 0.8 px.",
    );
    expect(
      viewerStatusLine({
        ...spent,
        hold: { kind: "fading", text: TEXT, share: 0.4 },
      }),
    ).toMatch(/^Relocalized - the code's hold is fading; GPS takes over/);
    expect(
      viewerStatusLine({ ...spent, hold: { kind: "ended", text: TEXT } }),
    ).toMatch(/hold has ended.*GPS.*scan the code again/i);
    // Still relocalizing: the budget states win over the hold.
    expect(
      viewerStatusLine({
        ...spent,
        votedLocks: 3,
        hold: { kind: "holding", text: TEXT, remainingMs: 120_000 },
      }),
    ).toMatch(/3 of \d+/);
  });

  // Plan §66-§67: since b4b a code votes only while its fused pose is
  // stable, so before the first vote the line says what the pose waits for
  // instead of "Scanning for the printed code…" - the code IS read. A code
  // problem still wins, and the vote states replace the hint.
  it("shows the fused pose's hint before the first vote, and only then", () => {
    const hint = "Measuring the code: keep it in view while you move slowly.";
    const base = {
      status: "tracking" as const,
      unknownCode: null,
      votedLocks: 0,
      lockedText: null,
      fusedHint: hint,
    };
    expect(viewerStatusLine(base)).toBe(hint);
    expect(viewerStatusLine({ ...base, fusedHint: null })).toMatch(/scanning/i);
    expect(viewerStatusLine({ ...base, unknownCode: "7" })).toMatch(
      /code 7 has no/i,
    );
    expect(viewerStatusLine({ ...base, unusableCode: "3" })).toMatch(
      /no printed size/i,
    );
    expect(
      viewerStatusLine({ ...base, votedLocks: 2, lockedText: TEXT }),
    ).toMatch(/2 of \d+/);
    expect(viewerStatusLine({ ...base, status: null })).toBe("");
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

describe("qr-viewer-mode - fetchLevel never rejects", () => {
  /**
   * Why this test matters (PR #386 review): `qrCodeId` documents that it
   * throws when Web Crypto is unavailable, and it was awaited bare inside
   * `fetchLevel`. The controller maps a rejection to `onError` ->
   * `setStatus("error")` and `detect()` flips back to "scanning" on the next
   * frame, so the status flaps at the detection cadence - exactly what the
   * module header promises will not happen. Worse than in the recorder, which
   * has a backoff ladder: nothing is cached here, so the throw would repeat on
   * every single detection.
   */
  it("resolves the placeholder when the id hash throws", async () => {
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      get: () => undefined,
    });
    try {
      const config = buildViewerControllerConfig(fakeDeps());
      const fetchLevel = config.fetchLevel as (t: string) => Promise<unknown>;
      await expect(fetchLevel("https://gps.csutil.com/?qr=x")).resolves.toEqual(
        { version: 1, qr: {} },
      );
    } finally {
      Object.defineProperty(globalThis.crypto, "subtle", {
        configurable: true,
        value: subtle,
      });
    }
  });
});
