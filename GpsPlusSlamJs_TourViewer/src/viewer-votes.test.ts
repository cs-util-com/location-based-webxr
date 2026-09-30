/**
 * The viewer's code votes, wired (Tour Viewer authoring plan 2026-09-28-0953,
 * M2b): the scan gate, the keep-alive and its triggers, as `viewer-placement`
 * composes them with the real viewer store.
 *
 * Why these tests matter: each rule below failed silently before M2b or has
 * no other guard. The gate passed on a lock that had cast no vote (no GPS
 * zero yet, or a pose still converging), so the tour's content was placed
 * through an alignment no code had corrected while the visitor was told the
 * code had worked (plan §2.2 B3). The keep-alive re-votes on every device
 * fix, so a listener that could not tell its own votes from fixes would
 * feed on itself. The tracking controller is replaced by a capture of the
 * config it is given, and each lock replays the controller's documented
 * order (detection, stable pose, votes, lock); the fused pose is a
 * controllable stand-in (its own tests are `fused-pose-wiring.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { recordGpsEvent, setZeroPos } from "gps-plus-slam-app-framework/state";
import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  endQrPipeline,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
  /** What the fused pose source resolves: null while "converging". */
  stablePose: null as Pose | null,
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
vi.mock("gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source", () => ({
  createFusedQrPoseSource: () => ({
    resolve: () => captured.stablePose,
    evaluate: () => null,
    last: () => null,
  }),
}));

const TEXT = "https://gps.csutil.com/tour/?qr=m2b";
const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.50002, lon: 8.70001, alt: 401.5, headingDeg: 90 },
  },
};
const CODE_POSE: Pose = { position: [0.5, 1.5, -2], rotation: [0, 0, 0, 1] };

const seams = {
  schedule: () => () => undefined,
  createQrFrontEnd: () => ({
    kind: "barcode-detector",
    detect: () => Promise.resolve(null),
  }),
  solveQrPose: () => null,
  getIntrinsics: () => null,
  getScene: () => null,
  canShareZip: () => false,
} as unknown as TourViewerSeams;

function viewer() {
  captured.configs.length = 0;
  captured.stablePose = CODE_POSE;
  const ctx = createTourViewerSession();
  const arStore = createTourViewerStore();
  const hooks = createUnwiredHooks();
  const placement = createViewerPlacement({
    ctx,
    mode: "visitor",
    arStore,
    arController: { getState: () => ({ status: "running" }) } as never,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton: {
      hidden: true,
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement,
    hooks,
  });
  ctx.currentLevels = new Map([["m2b", LEVEL]]);
  ctx.levelByText.set(TEXT, LEVEL);
  placement.startViewerPipeline();
  placement.startScanGate();
  const config = captured.configs.at(-1)!;

  /** One locked frame, in the controller's order (`qr-tracking-controller`
   *  onLocked): the detection, the stable pose, the frame's votes, the lock. */
  const lock = (atMs: number): void => {
    const detection: QrDetectionEvent = {
      text: TEXT,
      timestamp: atMs,
      qrPoseWorld: CODE_POSE,
      qrPoseInCamera: CODE_POSE,
      reprojectionErrorPx: 0.5,
      corners: [],
      cameraPose: CODE_POSE,
      imageWidth: 640,
      imageHeight: 480,
      intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
    };
    config.onDetection?.(detection);
    const pose = config.resolveStablePose?.(TEXT) ?? null;
    if (pose !== null) {
      config.dispatchVotes(
        buildQrGpsVotes({
          qrPoseWorld: pose,
          sizeM: 0.2,
          qrGeo: LEVEL.qr.geo!,
          syntheticAccuracyM: config.syntheticAccuracyM,
          ...(config.voteBaselineM !== undefined
            ? { baselineM: config.voteBaselineM }
            : {}),
          ...(config.voteCount !== undefined
            ? { count: config.voteCount }
            : {}),
          timestamp: atMs,
        }),
      );
    }
    config.onLocked?.({} as never, LEVEL);
  };

  /** One device GPS fix (the session zero on the first). */
  let fixes = 0;
  const fix = (atMs: number): void => {
    if (fixes === 0) arStore.dispatch(setZeroPos(ZERO));
    fixes += 1;
    arStore.dispatch(
      recordGpsEvent({
        odomPosition: [fixes * 0.7, 1.4, -fixes * 0.3],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `gps-${String(atMs)}`,
          latitude: ZERO.lat + fixes * 0.000004,
          longitude: ZERO.lon + fixes * 0.000003,
          altitude: 401,
          latLongAccuracy: 3,
          timestamp: atMs,
        },
      }),
    );
  };
  const positions = () =>
    arStore.getState().gpsData?.gpsEvents?.gpsPositions ?? [];
  return { ctx, arStore, placement, config, lock, fix, positions };
}

describe(
  "the scan gate passes on a lock that cast votes (M2b, plan §2.2 B3)",
  { timeout: 30_000 },
  () => {
    it("stays scanning on a lock before the first GPS fix - the store could not take its votes", () => {
      const v = viewer();
      expect(v.ctx.scanGate.kind).toBe("scanning");
      v.lock(T0);
      expect(v.positions()).toHaveLength(0);
      expect(v.ctx.scanGate.kind).toBe("scanning");
    });

    it("stays scanning on a lock whose pose is still converging", () => {
      const v = viewer();
      v.fix(T0);
      captured.stablePose = null;
      v.lock(T0 + 100);
      expect(v.positions()).toHaveLength(1);
      expect(v.ctx.scanGate.kind).toBe("scanning");
    });

    it("passes on the first lock that cast votes, and stays passed", () => {
      const v = viewer();
      v.fix(T0);
      v.lock(T0 + 100);
      expect(v.positions().length).toBeGreaterThan(1);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
    });
  },
);

// Every vote is a full re-solve in the reducer (80 at a scan), so a test
// here takes seconds, more on a loaded machine.
describe(
  "the keep-alive re-votes on device fixes (M2b, plan §3.2)",
  { timeout: 30_000 },
  () => {
    /** The session zero, a fix, then the scan: the budget's locks plus a few
     *  that no longer vote. */
    function scanned() {
      const v = viewer();
      v.fix(T0);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE + 3; i += 1) {
        v.lock(T0 + 500 + i * 125);
      }
      return v;
    }

    it("casts one full ring after each device fix once the budget is spent, stamped as synthetic, from the kept pose", () => {
      const v = scanned();
      const afterScan = v.positions().length;
      expect(afterScan).toBe(1 + MAX_VOTED_LOCKS_PER_CODE * VIEWER_VOTE_COUNT);
      // The spent code's pose is no longer resolved; the keep-alive must not
      // need it.
      captured.stablePose = null;
      v.fix(T0 + 3000);
      const added = v.positions().slice(afterScan);
      // Exactly the fix plus ONE ring: had any listener re-voted on the
      // ring's own points, each of the 8 would have cast another ring.
      expect(added).toHaveLength(1 + VIEWER_VOTE_COUNT);
      expect(gpsPointSourceOf(added[0]!)).toBe(GPS_POINT_SOURCE_DEVICE);
      for (const vote of added.slice(1)) {
        expect(gpsPointSourceOf(vote)).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
        expect(vote.timestamp).toBe(T0 + 3000);
      }
      expect(v.ctx.viewerKeepAlive?.phase(T0 + 3000)).toEqual({
        kind: "holding",
        text: TEXT,
        remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS - (3000 - 500 - 12 * 125),
      });
    });

    it("never re-votes on a synthetic point: a vote dispatched by anyone adds only itself", () => {
      const v = scanned();
      const before = v.positions().length;
      // One synthetic vote arriving through the store, as the lock burst's
      // votes do: every GPS listener sees it, none may answer it.
      v.arStore.dispatch(
        recordGpsEvent(
          buildQrGpsVotes({
            qrPoseWorld: CODE_POSE,
            sizeM: 0.2,
            qrGeo: LEVEL.qr.geo!,
            syntheticAccuracyM: 5,
            multiCorrespondence: false,
            timestamp: T0 + 4000,
          })[0]!,
        ),
      );
      expect(v.positions()).toHaveLength(before + 1);
    });

    it("stops at AR exit: a fix after the session's pipeline ended casts nothing", () => {
      const v = scanned();
      endQrPipeline(v.ctx);
      expect(v.ctx.viewerKeepAlive).toBeNull();
      const before = v.positions().length;
      v.fix(T0 + 3000);
      expect(v.positions()).toHaveLength(before + 1);
    });

    it("casts nothing before any code voted", () => {
      const v = viewer();
      v.fix(T0);
      v.fix(T0 + 1000);
      expect(v.positions()).toHaveLength(2);
    });

    it("a new AR entry starts a new keep-alive: the old one's code does not vote into it", () => {
      const v = scanned();
      const old = v.ctx.viewerKeepAlive;
      endQrPipeline(v.ctx);
      v.placement.startViewerPipeline();
      expect(v.ctx.viewerKeepAlive).not.toBeNull();
      expect(v.ctx.viewerKeepAlive).not.toBe(old);
      const before = v.positions().length;
      v.fix(T0 + 3000);
      expect(v.positions()).toHaveLength(before + 1);
    });
  },
);
