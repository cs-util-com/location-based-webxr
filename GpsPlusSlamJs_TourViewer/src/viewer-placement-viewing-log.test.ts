/**
 * The viewer pipeline's hooks into the `?debug=1` viewer recording
 * (authoring recording plan 2026-09-28-0953, M1b), driven through the REAL
 * viewer controller config (`buildViewerControllerConfig`) in the order the
 * framework's controller calls it: the detection, the lock's votes one by
 * one, then the voted lock.
 *
 * Why these tests matter: the log is only as good as the seams it hangs
 * on. A hook that reads the lock's code after the next frame, or the votes
 * of the wrong batch, would make a recording say something that did not
 * happen. And the visitor who records nothing must see exactly today's
 * dispatches.
 */
import { describe, expect, it, vi } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import type { TourViewerSeams } from "./seams.js";
import type { TourViewingAction } from "./tour-viewing-actions.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { createViewingLog } from "./viewing-log.js";

// The pipeline builds its controller from this module; capture the config
// it hands it and give back a controller that does nothing.
const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
}));
vi.mock("gps-plus-slam-app-framework/ar/qr/qr-tracking-controller", () => ({
  createQrTrackingController: (config: QrTrackingControllerConfig) => {
    captured.configs.push(config);
    return {
      offerFrame: () => undefined,
      isBusy: () => false,
      status: "idle",
      reset: () => undefined,
      dispose: () => undefined,
    };
  },
}));

const TEXT = "https://example.test/t?c=1";
const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 90 },
  },
};

function detection(): QrDetectionEvent {
  return {
    text: TEXT,
    qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
    qrPoseInCamera: { position: [0, 0, -2], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 0.5,
    timestamp: 0,
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
      latitude: 47.5,
      longitude: 8.7 + i * 1e-5,
      altitude: 400,
      latLongAccuracy: 5,
      timestamp: 0,
    },
  };
}

function harness(recording: "none" | "off" | "on") {
  captured.configs.length = 0;
  const ctx = createTourViewerSession();
  ctx.levelByText.set(TEXT, LEVEL);
  const store = createTourViewerStore();
  store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
  const dispatchSpy = vi.spyOn(store, "dispatch");
  const logged: TourViewingAction[] = [];
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => null,
  } as unknown as TourViewerSeams;
  const placement = createViewerPlacement({
    ctx,
    mode: "visitor",
    arStore: store,
    arController: { getState: () => ({ status: "running" }) } as never,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton: {
      hidden: true,
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement,
    hooks: createUnwiredHooks(),
    ...(recording === "none"
      ? {}
      : {
          viewingLog: createViewingLog({
            enabled: () => recording === "on",
            dispatch: (action) => logged.push(action),
            alignmentMatrix: () => null,
            scanGate: () => ctx.scanGate.kind,
            arVisitIndex: () => ctx.arSessionGeneration,
            now: () => 1000,
          }),
        }),
  });
  placement.startViewerPipeline();
  const config = captured.configs[0];
  if (config === undefined) throw new Error("no controller was built");
  /** One locked frame, in the controller's order. */
  const lock = (votes: RecordGpsEventPayload[]) => {
    config.onDetection?.(detection());
    config.dispatchVotes(votes);
  };
  return { ctx, logged, dispatchSpy, lock };
}

describe("the viewer pipeline's tourViewing hooks", () => {
  it("a recorded lock logs the scan lock, then the votes it cast as one batch with its code", () => {
    const h = harness("on");
    h.lock([vote(0), vote(1)]);

    expect(h.logged.map((a) => a.type)).toEqual([
      "tourViewing/codeLocked",
      "tourViewing/votesCast",
    ]);
    expect(h.logged[0]?.payload).toMatchObject({
      text: TEXT,
      level: LEVEL.qr,
      reprojectionErrorPx: 0.5,
    });
    expect(h.logged[1]?.payload).toMatchObject({
      text: TEXT,
      votedLocks: 1,
      votes: [
        { latitude: 47.5, longitude: 8.7, odomPosition: [0, 0, -2] },
        { latitude: 47.5, longitude: 8.7 + 1e-5, odomPosition: [1, 0, -2] },
      ],
    });
  });

  it("the next locked frame of the same code logs its votes but no second lock", () => {
    const h = harness("on");
    h.lock([vote(0)]);
    // The controller reports tracking after the first locked frame.
    h.ctx.viewerQrStatus = "tracking";
    h.lock([vote(1)]);
    expect(h.logged.map((a) => a.type)).toEqual([
      "tourViewing/codeLocked",
      "tourViewing/votesCast",
      "tourViewing/votesCast",
    ]);
  });

  it("without the recording running, the store sees exactly the pipeline's own dispatches", () => {
    // Why: a visitor without ?debug=1 and the switch must pay nothing.
    for (const recording of ["none", "off"] as const) {
      const h = harness(recording);
      h.lock([vote(0), vote(1)]);
      expect(h.logged).toEqual([]);
      expect(h.dispatchSpy.mock.calls.map(([action]) => action.type)).toEqual([
        "qrDetected/recordQrDetection",
        "gpsData/recordGpsEvent",
        "gpsData/recordGpsEvent",
      ]);
    }
  });
});
