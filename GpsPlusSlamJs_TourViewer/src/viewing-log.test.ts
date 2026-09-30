/**
 * The visitor's `tourViewing/*` log (authoring recording plan
 * 2026-09-28-0953, M1b).
 *
 * Why these tests matter: the `?debug=1` viewer recording exists to answer
 * "why did the content land there?" after a field session - which lock cast
 * which votes, and what each placement used. The raw stream cannot say
 * which lock a vote came from. And without `?debug=1` and the switch, a
 * visitor must pay nothing: no action, no retained vote.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import { createQrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import type { TourViewingAction } from "./tour-viewing-actions.js";
import { createViewingLog } from "./viewing-log.js";

const T0 = Date.UTC(2026, 8, 30, 10, 0, 0);
const MATRIX = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 90 },
  },
};

function detection(text: string): QrDetectionEvent {
  return {
    text,
    qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
    qrPoseInCamera: { position: [0, 0, -2], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 0.7,
    timestamp: T0,
    corners: [],
    cameraPose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
    imageWidth: 640,
    imageHeight: 480,
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
  } as unknown as QrDetectionEvent;
}

function vote(i: number): RecordGpsEventPayload {
  return {
    odomPosition: [i, 0, -2],
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `vote-${String(i)}`,
      latitude: 47.5 + i * 1e-5,
      longitude: 8.7,
      altitude: 400,
      latLongAccuracy: 5,
      timestamp: T0,
    },
  };
}

function harness(initiallyEnabled = true) {
  const dispatched: TourViewingAction[] = [];
  let enabled = initiallyEnabled;
  let visit = 0;
  const log = createViewingLog({
    enabled: () => enabled,
    dispatch: (action) => dispatched.push(action),
    alignmentMatrix: () => MATRIX as never,
    scanGate: () => "scanning",
    arVisitIndex: () => visit,
    now: () => T0,
  });
  return {
    log,
    dispatched,
    enable: (next: boolean) => {
      enabled = next;
    },
    nextVisit: () => {
      visit += 1;
    },
  };
}

describe("the viewer's tourViewing log", () => {
  it("logs nothing and keeps nothing while the recording is off", () => {
    const h = harness(false);
    h.log.detection(detection("code-a"), LEVEL, "scanning");
    h.log.vote(vote(0));
    h.log.votedLock("code-a", 1);
    h.log.placed({
      what: "content",
      basis: "geo",
      count: 1,
      zero: { lat: 47.5, lon: 8.7 },
    });
    expect(h.dispatched).toEqual([]);
    // A vote cast while off is not carried into a later, recorded batch.
    h.enable(true);
    h.log.votedLock("code-a", 2);
    expect(h.dispatched[0]?.payload).toMatchObject({ votes: [] });
  });

  it("logs a scan lock with the level, the solve, the gate and the alignment it met", () => {
    const h = harness();
    h.log.detection(detection("code-a"), LEVEL, "scanning");
    expect(h.dispatched).toEqual([
      {
        type: "tourViewing/codeLocked",
        payload: {
          text: "code-a",
          level: LEVEL.qr,
          qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
          reprojectionErrorPx: 0.7,
          scanGate: "scanning",
          alignmentMatrix: MATRIX,
          arVisitIndex: 0,
          atMs: T0,
        },
      },
    ]);
  });

  it("logs each NEW lock: not every tracked frame, but after a miss, another code, or another visit", () => {
    // Why: the controller locks at the camera cadence (up to 8 Hz) and
    // every locked frame is already a `qrDetected/*` action; a lock worth
    // its own log is one that starts tracking.
    const h = harness();
    h.log.detection(detection("code-a"), LEVEL, "scanning");
    h.log.detection(detection("code-a"), LEVEL, "tracking");
    h.log.detection(detection("code-a"), LEVEL, "tracking");
    expect(h.dispatched).toHaveLength(1);
    h.log.detection(detection("code-a"), LEVEL, "scanning"); // after a miss
    h.log.detection(detection("code-b"), null, "tracking"); // another code
    h.nextVisit();
    h.log.detection(detection("code-b"), null, "tracking"); // another visit
    expect(h.dispatched.map((a) => a.payload)).toMatchObject([
      { text: "code-a" },
      { text: "code-a" },
      { text: "code-b", level: null },
      { text: "code-b", arVisitIndex: 1 },
    ]);
  });

  it("logs the votes a lock cast as one batch: the count, each vote's point, and the alignment after them", () => {
    const h = harness();
    h.log.vote(vote(0));
    h.log.vote(vote(1));
    h.log.votedLock("code-a", 3);
    h.log.vote(vote(2));
    h.log.votedLock("code-a", 4);
    expect(h.dispatched.map((a) => a.type)).toEqual([
      "tourViewing/votesCast",
      "tourViewing/votesCast",
    ]);
    expect(h.dispatched[0]?.payload).toEqual({
      text: "code-a",
      votedLocks: 3,
      votes: [
        {
          latitude: 47.5,
          longitude: 8.7,
          altitude: 400,
          accuracyM: 5,
          odomPosition: [0, 0, -2],
        },
        {
          latitude: 47.50001,
          longitude: 8.7,
          altitude: 400,
          accuracyM: 5,
          odomPosition: [1, 0, -2],
        },
      ],
      alignmentMatrix: MATRIX,
      arVisitIndex: 0,
      atMs: T0,
    });
    // The second batch holds its own vote only.
    expect(
      (h.dispatched[1]?.payload as unknown as { votes: unknown[] }).votes,
    ).toHaveLength(1);
  });

  it("logs a placement with what it used", () => {
    const h = harness();
    h.log.placed({
      what: "ring",
      basis: "code",
      count: 3,
      zero: { lat: 47.5, lon: 8.7 },
      code: {
        text: "code-a",
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 90 },
        centerNue: [0, 400, 0],
      },
    });
    expect(h.dispatched).toEqual([
      {
        type: "tourViewing/placed",
        payload: {
          what: "ring",
          basis: "code",
          count: 3,
          zero: { lat: 47.5, lon: 8.7 },
          code: {
            text: "code-a",
            geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 90 },
            centerNue: [0, 400, 0],
          },
          alignmentMatrix: MATRIX,
          arVisitIndex: 0,
          atMs: T0,
        },
      },
    ]);
  });

  it("every payload survives the JSON round trip the recording writes it through", () => {
    const h = harness();
    h.log.detection(detection("code-a"), LEVEL, "scanning");
    h.log.vote(vote(0));
    h.log.votedLock("code-a", 1);
    h.log.placed({
      what: "capture-spots",
      basis: "geo",
      count: 6,
      zero: { lat: 47.5, lon: 8.7 },
      join: { fixes: 12, gpsAccuracyMedianM: 4 },
    });
    for (const action of h.dispatched) {
      expect(JSON.parse(JSON.stringify(action))).toEqual(action);
    }
  });

  it("the keep-alive payload survives the JSON round trip too", () => {
    const h = harness();
    const keepAlive = h.log.keepAlive(createQrVoteKeepAlive(KEEP_SETTINGS));
    keepAlive.keep(KEPT, 0);
    keepAlive.votesForFix(1500);
    keepAlive.stop();
    expect(h.dispatched.length).toBeGreaterThan(0);
    for (const action of h.dispatched) {
      expect(JSON.parse(JSON.stringify(action))).toEqual(action);
    }
  });
});

// The geodesy the keep-alive's vote builder calls is licence-gated; the
// store's construction activates it (the same activation main.ts performs).
createTourViewerStore();

/** A short schedule, so the phases pass within a few calls. */
const KEEP_SETTINGS = {
  holdMs: 1000,
  fadeMs: 1000,
  votesPerFix: 3,
  baselineM: 30,
  syntheticAccuracyM: 5,
};
const KEPT = {
  text: "code-a",
  qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
  qrGeo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 90 },
  sizeM: 0.2,
} as const;

describe("the viewer's tourViewing log of the code keep-alive (M1b review #5)", () => {
  // Why these tests matter: after a scan's budget the keep-alive keeps
  // voting for minutes, and its votes are in the raw stream only as stamped
  // GPS events. Without its state changes a replay cannot tell when the
  // hold started, what pose it re-voted from, whether a re-scan restarted
  // it, or when it faded out - the questions a misplaced tour asks.
  const keepAliveLog = (dispatched: TourViewingAction[]) =>
    dispatched
      .filter((a) => a.type === "tourViewing/keepAlive")
      .map((a) => a.payload as unknown as Record<string, unknown>);

  it("logs each state change - armed with the pose it re-votes from, a re-scan, the fade, the end, the stop - and nothing per tracked frame or per fix", () => {
    const h = harness();
    const keepAlive = h.log.keepAlive(createQrVoteKeepAlive(KEEP_SETTINGS));

    keepAlive.keep(KEPT, 0);
    expect(keepAlive.votesForFix(500)).toHaveLength(3); // holding: silent
    keepAlive.relock("code-a", 600); // a tracked frame of the same lock
    keepAlive.relock("code-b", 650); // another code: nothing kept for it
    keepAlive.votesForFix(1700); // past the hold (from 600): fading
    keepAlive.votesForFix(1800); // still fading: silent
    // A re-scan: the lock starts tracking again, then its relock.
    h.log.detection(detection("code-a"), LEVEL, "scanning");
    keepAlive.relock("code-a", 1900);
    keepAlive.relock("code-a", 1950); // its next tracked frame: silent
    keepAlive.votesForFix(3100); // fading again
    keepAlive.votesForFix(4000); // past the fade: ended
    keepAlive.votesForFix(4100);
    keepAlive.stop();
    keepAlive.stop(); // nothing kept any more: silent

    const log = keepAliveLog(h.dispatched);
    expect(log.map((e) => e["event"])).toEqual([
      "armed",
      "fading",
      "relocked",
      "fading",
      "ended",
      "stopped",
    ]);
    expect(log[0]).toEqual({
      event: "armed",
      text: "code-a",
      keepAliveMs: 0,
      phase: { kind: "holding", text: "code-a", remainingMs: 1000 },
      kept: {
        qrPoseWorld: KEPT.qrPoseWorld,
        qrGeo: KEPT.qrGeo,
        sizeM: 0.2,
      },
      arVisitIndex: 0,
      atMs: T0,
    });
    expect(log[1]).toMatchObject({
      keepAliveMs: 1700,
      phase: { kind: "fading", share: expect.closeTo(0.9, 9) as number },
    });
    // The re-scan restarted the hold: its phase says so.
    expect(log[2]).toMatchObject({
      text: "code-a",
      keepAliveMs: 1900,
      phase: { kind: "holding", remainingMs: 1000 },
    });
    expect(log[4]).toMatchObject({
      keepAliveMs: 4000,
      phase: { kind: "ended" },
    });
    expect(log[5]).toMatchObject({
      text: "code-a",
      keepAliveMs: null,
      phase: { kind: "none" },
    });
  });

  it("keeps the keep-alive's votes out of the lock batches", () => {
    // Why: `votesCast` answers "which lock cast which votes"; a keep-alive
    // ring folded into the next lock's batch would say something that did
    // not happen.
    const h = harness();
    const keepAlive = h.log.keepAlive(createQrVoteKeepAlive(KEEP_SETTINGS));
    keepAlive.keep(KEPT, 0);
    expect(keepAlive.votesForFix(100)).toHaveLength(3);
    h.log.votedLock("code-a", 2);
    const batch = h.dispatched.find((a) => a.type === "tourViewing/votesCast");
    expect(batch?.payload).toMatchObject({ votes: [] });
  });

  it("logs nothing while the recording is off, and the keep-alive works the same", () => {
    const h = harness(false);
    const keepAlive = h.log.keepAlive(createQrVoteKeepAlive(KEEP_SETTINGS));
    keepAlive.keep(KEPT, 0);
    expect(keepAlive.votesForFix(100)).toHaveLength(3);
    expect(keepAlive.phase(100)).toMatchObject({ kind: "holding" });
    keepAlive.votesForFix(2500);
    keepAlive.stop();
    expect(h.dispatched).toEqual([]);
    expect(keepAlive.phase(100)).toEqual({ kind: "none" });
  });
});
