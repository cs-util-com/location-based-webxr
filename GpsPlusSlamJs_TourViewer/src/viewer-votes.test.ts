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
 * feed on itself. The M2b milestone review added the rules below the
 * first two blocks, each with its own "why". The tracking controller is
 * replaced by a capture of the config it is given, and each lock replays
 * the controller's documented order (detection, stable pose, votes, lock);
 * the fused pose is a controllable stand-in (its own tests are
 * `fused-pose-wiring.test.ts`). Times are the page clock (`now`): a lock
 * at `atMs`, a fix ARRIVING at `atMs` with its own stamp.
 */
import { describe, expect, it, vi } from "vitest";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  createGpsPositionHandler,
  qrFrameChanged,
  recordGpsEvent,
  setAlignmentOverrides,
  setZeroPos,
  startSession,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
  webxrToNUE,
} from "gps-plus-slam-app-framework/core";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_KEEP_ALIVE_FADE_MS,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import { SCAN_GATE_ESCAPE_MS } from "./scan-gate.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  endQrPipeline,
  endTourCodeVotes,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { VIEWER_SOFT_TRIM } from "./viewer-vote-sink.js";

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

function viewer() {
  captured.configs.length = 0;
  captured.stablePose = CODE_POSE;
  /** The page clock: lock times and fix ARRIVALS (the placement's `now`). */
  const clock = { nowMs: T0 };
  /** Whether the device has a detector (the next entry reads it). */
  const device = { detector: true };
  /** The scan gate's escape clock, fired by hand. */
  const scheduled: { run: () => void; delayMs: number }[] = [];
  const seams = {
    schedule: (run: () => void, delayMs: number) => {
      scheduled.push({ run, delayMs });
      return () => undefined;
    },
    // A device without a BarcodeDetector makes the entry plain AR.
    createQrFrontEnd: () =>
      device.detector
        ? { kind: "barcode-detector", detect: () => Promise.resolve(null) }
        : null,
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => null,
    canShareZip: () => false,
  } as unknown as TourViewerSeams;
  const escapeListeners: (() => void)[] = [];
  const escapeButton = {
    hidden: true,
    addEventListener: (_type: string, listener: () => void) => {
      escapeListeners.push(listener);
    },
  };
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
    escapeButton: escapeButton as unknown as HTMLButtonElement,
    hooks,
    now: () => clock.nowMs,
  });
  ctx.currentLevels = new Map([["m2b", LEVEL]]);
  ctx.levelByText.set(TEXT, LEVEL);
  placement.startViewerPipeline();
  placement.startScanGate();
  const config = () => captured.configs.at(-1)!;

  /** One locked frame at page time `atMs`, in the controller's order
   *  (`qr-tracking-controller` onLocked): the detection, the stable pose,
   *  the frame's votes, the lock. */
  const lock = (atMs: number): void => {
    clock.nowMs = Math.max(clock.nowMs, atMs);
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
    const c = config();
    c.onDetection?.(detection);
    const pose = c.resolveStablePose?.(TEXT) ?? null;
    if (pose !== null) {
      c.dispatchVotes(
        buildQrGpsVotes({
          qrPoseWorld: pose,
          sizeM: 0.2,
          qrGeo: LEVEL.qr.geo!,
          syntheticAccuracyM: c.syntheticAccuracyM,
          ...(c.voteBaselineM !== undefined
            ? { baselineM: c.voteBaselineM }
            : {}),
          ...(c.voteCount !== undefined ? { count: c.voteCount } : {}),
          timestamp: atMs,
        }),
      );
    }
    c.onLocked?.({} as never, LEVEL);
  };

  /** One device GPS fix ARRIVING at page time `atMs` and carrying its own
   *  (Geolocation) time `stampMs` (the session zero on the first), through
   *  the page's device-fix path: the coordinator's `recordFix` is the
   *  placement's `recordDeviceFix` (main.ts). */
  let fixes = 0;
  const fixPayload = (
    stampMs: number,
    over: Partial<RecordGpsEventPayload["rawGpsPoint"]> = {},
  ): RecordGpsEventPayload => ({
    odomPosition: [fixes * 0.7, 1.4, -fixes * 0.3],
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `gps-${String(fixes)}`,
      latitude: ZERO.lat + fixes * 0.000004,
      longitude: ZERO.lon + fixes * 0.000003,
      altitude: 401,
      latLongAccuracy: 3,
      timestamp: stampMs,
      ...over,
    },
  });
  const fix = (
    atMs: number,
    stampMs: number = atMs,
    over: Partial<RecordGpsEventPayload["rawGpsPoint"]> = {},
  ): void => {
    clock.nowMs = atMs;
    if (fixes === 0) arStore.dispatch(setZeroPos(ZERO));
    fixes += 1;
    placement.recordDeviceFix(fixPayload(stampMs, over));
  };
  const positions = () =>
    arStore.getState().gpsData?.gpsEvents?.gpsPositions ?? [];
  const clickEscape = () => {
    for (const listener of escapeListeners) listener();
  };
  return {
    ctx,
    arStore,
    placement,
    config,
    lock,
    fix,
    positions,
    scheduled,
    escapeButton,
    clickEscape,
    device,
  };
}

/** The stored points of `v` from index `from` on, each with the
 *  odometry position (NUE) it was paired with - the store keeps parallel
 *  lists. */
function pairsFrom(
  v: ReturnType<typeof viewer>,
  from: number,
): { point: RecordGpsEventPayload["rawGpsPoint"]; odom: readonly number[] }[] {
  const events = v.arStore.getState().gpsData?.gpsEvents;
  const points = events?.gpsPositions ?? [];
  return points.slice(from).map((point, i) => ({
    point,
    odom: events!.odometryPositions[from + i]!,
  }));
}

/** The odometry centroid of the synthetic votes among `pairs` - the pose
 *  their ring was built around. */
function voteCentroid(
  pairs: readonly { point: { source?: string }; odom: readonly number[] }[],
): { count: number; at: number[] } {
  const votes = pairs.filter(
    (p) => gpsPointSourceOf(p.point) === GPS_POINT_SOURCE_SYNTHETIC_QR,
  );
  const at = [0, 0, 0];
  for (const v of votes) {
    for (let k = 0; k < 3; k += 1) at[k]! += v.odom[k]! / votes.length;
  }
  return { count: votes.length, at };
}

/** The session zero, a fix, then a scan of `votedLocks` locks that vote
 *  plus a few that no longer do once the budget is spent. */
function scanned(votedLocks = MAX_VOTED_LOCKS_PER_CODE) {
  const v = viewer();
  v.fix(T0);
  const locks =
    votedLocks >= MAX_VOTED_LOCKS_PER_CODE ? votedLocks + 3 : votedLocks;
  for (let i = 0; i < locks; i += 1) v.lock(T0 + 500 + i * 125);
  return v;
}

/** `at` (the store keeps odometry in NUE) is the WebXR `pose`'s position. */
function expectNear(at: readonly number[], pose: Pose): void {
  const nue = webxrToNUE([...pose.position]);
  for (let k = 0; k < 3; k += 1) expect(at[k]).toBeCloseTo(nue[k]!, 4);
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
      // ring's own points, each of its points would have cast another ring.
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

// Why (M2b review #1): a re-scan used to restart the hold from the pose the
// budget's last voted lock used, however old - a code scanned again 20
// minutes later pulled the placement toward a pose with 20 minutes of
// tracking drift in it, at full strength, and the hold's own "ended" line
// told the visitor to do exactly that. A kept pose also belongs to one
// odometry frame: after a tracking restart it names a place that no longer
// exists (the framework drops old-frame detections for the same reason).
describe(
  "a re-scan votes afresh once the kept pose is stale, and a frame change ends the hold (M2b review #1)",
  { timeout: 30_000 },
  () => {
    const MOVED: Pose = { position: [1.4, 1.5, -2.7], rotation: [0, 0, 0, 1] };

    it("a code scanned again 20 minutes later votes from where it reads NOW, and the keep-alive re-votes from there", () => {
      const v = scanned();
      const late = T0 + 20 * 60_000;
      v.fix(late - 1000);
      captured.stablePose = MOVED; // the same code, 20 minutes of drift on
      let from = v.positions().length;
      v.lock(late);
      const burst = voteCentroid(pairsFrom(v, from));
      expect(burst.count).toBe(VIEWER_VOTE_COUNT);
      expectNear(burst.at, MOVED);
      from = v.positions().length;
      v.fix(late + 1000);
      const ring = voteCentroid(pairsFrom(v, from));
      expect(ring.count).toBe(VIEWER_VOTE_COUNT);
      expectNear(ring.at, MOVED);
      expect(v.ctx.viewerKeepAlive?.phase(late + 1000)).toEqual({
        kind: "holding",
        text: TEXT,
        remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS - 1000,
      });
    });

    it("a change of odometry frame ends the hold, and the next scan votes in the new frame", () => {
      const v = scanned();
      v.arStore.dispatch(qrFrameChanged());
      expect(v.ctx.viewerKeepAlive?.phase(T0 + 3000)).toEqual({ kind: "none" });
      let from = v.positions().length;
      v.fix(T0 + 3000);
      expect(v.positions()).toHaveLength(from + 1); // the fix, no ring
      captured.stablePose = MOVED; // where the code reads in the new frame
      from = v.positions().length;
      v.lock(T0 + 4000);
      const burst = voteCentroid(pairsFrom(v, from));
      expect(burst.count).toBe(VIEWER_VOTE_COUNT);
      expectNear(burst.at, MOVED);
    });
  },
);

// Why (M2b review #4): the hold was scheduled on two clocks - the lock on
// the page clock, each fix on its Geolocation timestamp (the acquisition
// time, cached up to `maximumAge`, from a clock set independently). A skew
// of X moved the hand-off by X; a fix stamped before the lock always read
// as full strength, so a phone whose GPS time lagged by an hour never
// handed over at all. The schedule now runs on the fix's arrival; its own
// time only stamps the votes.
describe(
  "the keep-alive's hold runs on one clock (M2b review #4)",
  { timeout: 60_000 },
  () => {
    it.each([-3_600_000, -5000, 5000, 3_600_000])(
      "hands over by arrival with the fix's clock skewed by %i ms, and stamps the votes with the fix's own time",
      (skewMs) => {
        const v = scanned();
        const lastLock = T0 + 500 + (MAX_VOTED_LOCKS_PER_CODE + 2) * 125;
        const inHold = lastLock + 60_000;
        let from = v.positions().length;
        v.fix(inHold, inHold + skewMs);
        const added = pairsFrom(v, from);
        expect(added).toHaveLength(1 + VIEWER_VOTE_COUNT);
        for (const { point } of added) {
          expect(point.timestamp).toBe(inHold + skewMs);
        }
        const over =
          lastLock + VIEWER_KEEP_ALIVE_HOLD_MS + VIEWER_KEEP_ALIVE_FADE_MS + 1;
        from = v.positions().length;
        v.fix(over, over + skewMs);
        expect(v.positions()).toHaveLength(from + 1);
      },
    );
  },
);

// Why (M2b review #6): the vote budget lived in the pipeline's closure,
// which outlives a tour switch, and the switch reset only the controller
// and the keep-alive. Reopening a tour in the same AR entry therefore found
// its code already "voted": the new gate passed on a lock that cast
// nothing, and a spent code never voted - or kept a hold - again.
describe(
  "a tour reopened in the same AR entry starts its codes' votes again (M2b review #6)",
  { timeout: 30_000 },
  () => {
    it.each([3, MAX_VOTED_LOCKS_PER_CODE])(
      "after %i voted locks: its gate waits for a vote, which it gets, and the hold starts again",
      (votedLocks) => {
        const v = scanned(votedLocks);
        expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
        // What the tour switch does to the votes and the gate
        // (`archive-open.ts`), then the reopened tour's gate.
        endTourCodeVotes(v.ctx);
        v.placement.resetScanGate();
        v.placement.startScanGate();
        expect(v.ctx.scanGate.kind).toBe("scanning");
        const from = v.positions().length;
        captured.stablePose = null; // converging: this lock casts nothing
        v.lock(T0 + 10_000);
        expect(v.positions()).toHaveLength(from);
        expect(v.ctx.scanGate.kind).toBe("scanning");
        captured.stablePose = CODE_POSE;
        v.lock(T0 + 10_125);
        expect(v.positions()).toHaveLength(from + VIEWER_VOTE_COUNT);
        expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
        expect(v.ctx.viewerKeepAlive?.phase(T0 + 10_125)).toEqual({
          kind: "holding",
          text: TEXT,
          remainingMs: VIEWER_KEEP_ALIVE_HOLD_MS,
        });
      },
    );
  },
);

// Why (M2b review #8): since M2b the gate passes only on a lock that cast
// votes, so a code that locks but never votes - no GPS zero yet, or a pose
// that never converges - leaves the visitor at the gate. The 45 s escape
// is their way out; the e2e covers only a code that never locks, and the
// wiring stubbed the clock away, so nothing proved a vote-less lock does
// not cancel it.
describe(
  "the gate's escape is offered to a code that locks but never votes (M2b review #8)",
  { timeout: 30_000 },
  () => {
    it.each([
      ["no GPS zero yet", false],
      ["a pose that never converges", true],
    ] as const)("%s", (_cause, withZero) => {
      const v = viewer();
      if (withZero) {
        v.fix(T0);
        captured.stablePose = null;
      }
      expect(v.scheduled).toHaveLength(1);
      expect(v.scheduled[0]!.delayMs).toBe(SCAN_GATE_ESCAPE_MS);
      const before = v.positions().length;
      for (let i = 0; i < 3 * MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 500 + i * 125);
      }
      expect(v.positions()).toHaveLength(before);
      expect(v.ctx.scanGate).toEqual({
        kind: "scanning",
        escapeOffered: false,
      });
      expect(v.escapeButton.hidden).toBe(true);
      v.scheduled[0]!.run(); // 45 s later
      expect(v.ctx.scanGate).toEqual({
        kind: "scanning",
        escapeOffered: true,
      });
      expect(v.escapeButton.hidden).toBe(false);
      v.clickEscape();
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "skipped" });
      expect(v.escapeButton.hidden).toBe(true);
    });
  },
);

/** Every action a caller dispatches into the viewer's store from now on
 *  (the listener middleware's own dispatches are not callers'). */
function dispatchLog(v: ReturnType<typeof viewer>) {
  const spy = vi.spyOn(v.arStore, "dispatch");
  return {
    types: () => spy.mock.calls.map(([a]) => a.type),
    actions: () =>
      spy.mock.calls.map(
        ([a]): { type: string; payload?: unknown } =>
          a as unknown as { type: string; payload?: unknown },
      ),
  };
}

// Why (authoring plan 2026-09-28-0953 D18, M2e): every `recordGpsEvent`
// re-solves over the whole history, so a lock's 16 votes as 16 dispatches
// cost 16 solves, and a keep-alive tick 17. The core (1.26) stores the same
// events and solves ONCE; the compass memory steps once per batch (D18). The
// owner chose
// one batch per lock and one per keep-alive tick holding the DEVICE fix and
// its ring. These pin that through the real wiring, without a clock: the
// cost check is the number of store actions, never wall time.
describe(
  "one solve per voted lock and per keep-alive tick (D18, M2e)",
  { timeout: 30_000 },
  () => {
    it("a voted lock stores its whole ring as ONE batch", () => {
      const v = viewer();
      v.fix(T0);
      const log = dispatchLog(v);
      const before = v.positions().length;
      v.lock(T0 + 500);
      expect(log.types().filter((t) => t.startsWith("gpsData/record"))).toEqual(
        ["gpsData/recordGpsEventBatch"],
      );
      expect(v.positions()).toHaveLength(before + VIEWER_VOTE_COUNT);
    });

    it("a keep-alive tick is exactly ONE store action: the device fix first, then its ring", () => {
      const v = scanned();
      const before = v.positions().length;
      const log = dispatchLog(v);
      v.fix(T0 + 3000);
      expect(log.types()).toEqual(["gpsData/recordGpsEventBatch"]);
      const events = (
        log.actions()[0]!.payload as { events: RecordGpsEventPayload[] }
      ).events;
      expect(events).toHaveLength(1 + VIEWER_VOTE_COUNT);
      expect(gpsPointSourceOf(events[0]!.rawGpsPoint)).toBe(
        GPS_POINT_SOURCE_DEVICE,
      );
      for (const vote of events.slice(1)) {
        expect(gpsPointSourceOf(vote.rawGpsPoint)).toBe(
          GPS_POINT_SOURCE_SYNTHETIC_QR,
        );
      }
      expect(v.positions()).toHaveLength(before + 1 + VIEWER_VOTE_COUNT);
    });

    it("a fix the keep-alive does not answer is the plain recordGpsEvent: before any vote, after the fade, after AR exit", () => {
      const v = viewer();
      const log = dispatchLog(v);
      v.fix(T0);
      expect(log.types()).toEqual([
        "gpsData/setZeroPos",
        "gpsData/recordGpsEvent",
      ]);
      const s = scanned();
      const lastLock = T0 + 500 + (MAX_VOTED_LOCKS_PER_CODE + 2) * 125;
      const over =
        lastLock + VIEWER_KEEP_ALIVE_HOLD_MS + VIEWER_KEEP_ALIVE_FADE_MS;
      const done = dispatchLog(s);
      s.fix(over + 1);
      endQrPipeline(s.ctx);
      s.fix(over + 2000);
      expect(done.types()).toEqual([
        "gpsData/recordGpsEvent",
        "gpsData/recordGpsEvent",
      ]);
    });

    it("a malformed device fix inside a tick is dropped alone by the core: its ring is stored and nothing throws", () => {
      // Why: a receiver can hand over a fix with a non-finite coordinate.
      // Sent alone it is the core's problem as before; sent WITH its ring
      // it must not take the ring down, nor throw out of the GPS callback
      // (core 1.26 judges each event of a batch as a single dispatch would).
      const v = scanned();
      const before = v.positions().length;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(() => {
          v.fix(T0 + 3000, T0 + 3000, { latitude: Number.NaN });
        }).not.toThrow();
      } finally {
        warn.mockRestore();
      }
      const added = v.positions().slice(before);
      expect(added).toHaveLength(VIEWER_VOTE_COUNT);
      for (const vote of added) {
        expect(gpsPointSourceOf(vote)).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
      }
    });

    it("the page's composed GPS handler routes each device fix here (main.ts: the coordinator's recordFix)", () => {
      const v = scanned();
      v.arStore.dispatch(
        startSession({
          contextTag: "tour-viewer",
          sessionName: "entry",
          startTime: T0,
        }),
      );
      const handler = createGpsPositionHandler({
        store: v.arStore,
        getArPose: () => ({
          position: { x: 0.2, y: 1.4, z: -0.5 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        }),
        recordFix: v.placement.recordDeviceFix,
      });
      const log = dispatchLog(v);
      const before = v.positions().length;
      handler({
        lat: ZERO.lat + 0.00001,
        lon: ZERO.lon,
        altitude: 401,
        accuracy: 3,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: T0 + 3000,
      });
      expect(log.types()).toEqual(["gpsData/recordGpsEventBatch"]);
      expect(v.positions()).toHaveLength(before + 1 + VIEWER_VOTE_COUNT);
    });
  },
);

const overridesOf = (v: ReturnType<typeof viewer>) =>
  v.arStore.getState().gpsData?.alignmentOverrides ?? null;

// Why (the seam contract in viewer-placement.ts.md; the M2b/M2d review #3):
// the keep-alive is unsafe under the core's hard trim (B = 5 m fails the
// rule, 8 m jumps, 15 m never hands off), and the soft kernel M0c credited
// it with must never outlive the entry that turned it on -
// `resetGpsSessionData` keeps overrides, and the corpus never credited the
// soft kernel for GPS-only solving. Replaces `viewer-soft-trim-guard.test.ts`,
// the tripwire designed to break on the first core that took the keys.
describe(
  "the per-entry solver overrides, through the real wiring (M2e)",
  { timeout: 30_000 },
  () => {
    it("the soft trimming goes on right before the entry's first vote - never earlier, and once", () => {
      const v = viewer();
      v.fix(T0);
      expect(overridesOf(v)).toBeNull();
      const log = dispatchLog(v);
      v.lock(T0 + 500);
      v.lock(T0 + 625);
      expect(
        log
          .types()
          .filter(
            (t) =>
              t === setAlignmentOverrides.type ||
              t.startsWith("gpsData/record"),
          ),
      ).toEqual([
        setAlignmentOverrides.type,
        "gpsData/recordGpsEventBatch",
        "gpsData/recordGpsEventBatch",
      ]);
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
    });

    it("every entry starts by clearing them, before its plain-AR return: a plain-AR entry never keeps a previous entry's soft trimming", () => {
      const v = scanned();
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
      endQrPipeline(v.ctx); // AR exit (the store keeps overrides)
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
      v.device.detector = false;
      const log = dispatchLog(v);
      expect(v.placement.startViewerPipeline()).toBe(false);
      expect(log.actions()).toEqual([setAlignmentOverrides(null)]);
      expect(overridesOf(v)).toBeNull();
      // Its fixes take the plain path and change nothing.
      v.fix(T0 + 60_000);
      expect(overridesOf(v)).toBeNull();
    });

    it("a re-entry WITH a detector starts plain too, and its own first vote turns the soft trimming on", () => {
      const v = scanned();
      endQrPipeline(v.ctx);
      v.placement.startViewerPipeline();
      expect(overridesOf(v)).toBeNull();
      v.fix(T0 + 60_000);
      expect(overridesOf(v)).toBeNull();
      v.lock(T0 + 61_000);
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
    });

    // Why (M2e milestone review #1): the closed tour's votes stay in the GPS
    // history after a switch, so turning the soft kernel off there put the
    // hard trim back onto them - the regime M0b/M2b measured as a 2.8-5.8 m
    // jump at a 5-8 m bias. M0c: the viewer keeps the setting for the rest
    // of the session; only the next entry's start clears it.
    it("a tour switch inside the entry keeps the soft trimming on until AR exit, and the next entry clears it", () => {
      const v = scanned();
      const log = dispatchLog(v);
      endTourCodeVotes(v.ctx);
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
      // A fix between tours: the closed tour's votes are still in the solve.
      v.fix(T0 + 5000);
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
      v.lock(T0 + 10_000);
      expect(overridesOf(v)).toEqual(VIEWER_SOFT_TRIM);
      expect(log.types()).not.toContain(setAlignmentOverrides.type);
      endQrPipeline(v.ctx); // AR exit
      v.placement.startViewerPipeline(); // the next entry
      expect(overridesOf(v)).toBeNull();
    });
  },
);
