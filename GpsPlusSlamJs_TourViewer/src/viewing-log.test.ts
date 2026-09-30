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
});
