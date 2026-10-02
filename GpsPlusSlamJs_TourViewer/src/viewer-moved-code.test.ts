/**
 * The viewer's post-scan veto of a moved code, wired (Tour Viewer authoring
 * plan 2026-09-28-0953 §3.6, D20, M5c): `viewer-placement` composes the
 * moved-code check with the real viewer store, the vote sink, the
 * keep-alive, the scan gate and the viewing log.
 *
 * Why these tests matter: a printed code re-hung 40 m from where it was
 * saved pins the whole tour 40 m off for as long as its votes hold the
 * alignment. Once the check reads it as moved, the viewer must (owner
 * decision 2026-10-02): stop the keep-alive; take every vote back (reset and
 * re-feed the device fixes, soft keys off - the only recovery that lands on
 * the GPS answer), so the content moves ONCE, to where GPS puts it; ignore
 * the code's later locks for the rest of the tour, checked by level id
 * before any fused pose is computed; tell the visitor in plain words; and
 * log what it decided on. The tracking controller is a capture of its
 * config and each lock replays the controller's order, as in
 * `viewer-votes.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import {
  calcGpsCoords,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import { objectPoseNue } from "./content-placement.js";
import {
  IGNORED_CODE_LINE,
  MAX_VOTED_LOCKS_PER_CODE,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { arStatusLine } from "./tour-flow.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  endQrPipeline,
  endTourCodeVotes,
} from "./tour-viewer-session.js";
import type { TourViewingAction } from "./tour-viewing-actions.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { createViewingLog } from "./viewing-log.js";

const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
  stablePose: null as Pose | null,
  /** How often the fused pose was asked for (the veto must come first). */
  resolves: 0,
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
    resolve: () => {
      captured.resolves += 1;
      return captured.stablePose;
    },
    evaluate: () => null,
    last: () => null,
  }),
}));

// The geodesy is licence-gated; building a store activates it.
createTourViewerStore();

const TEXT = "https://gps.csutil.com/tour/?qr=m5c";
const LEVEL_ID = "m5c";
const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const NUE_TO_WEBXR = WEBXR_TO_NUE.clone().invert();

/** The saved code: 20 m north, 10 m east of the zero, facing east, minted
 *  on a settled alignment. */
const SAVED_GEO = (() => {
  const g = calcGpsCoords(ZERO, [20, 400, 10]);
  return { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 90 };
})();
const LEVEL: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: SAVED_GEO,
    mintQuality: { alignmentSampleCount: 300, gpsAccuracyM: 3 },
  },
};
/** The poster hangs 40 m east of its saved spot. The odometry frame is the
 *  world frame here, so GPS alone converges on the identity. */
const MOVE_EAST_M = 40;
const SAVED = objectPoseNue(SAVED_GEO, ZERO);
const PHYSICAL: [number, number] = [
  SAVED.positionNue[0],
  SAVED.positionNue[2] + MOVE_EAST_M,
];

/** A world-NUE pose (odometry = world) as raw WebXR. */
function raw(position: readonly number[], rotation: Quaternion): Pose {
  const m = NUE_TO_WEBXR.clone().multiply(
    new Matrix4().compose(
      new Vector3(position[0], position[1], position[2]),
      rotation,
      new Vector3(1, 1, 1),
    ),
  );
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}
const CODE_POSE = raw(
  [PHYSICAL[0], SAVED.positionNue[1], PHYSICAL[1]],
  new Quaternion(...SAVED.rotationNue),
);

function viewer() {
  captured.configs.length = 0;
  captured.stablePose = CODE_POSE;
  captured.resolves = 0;
  const clock = { nowMs: T0 };
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
  const ctx = createTourViewerSession();
  const arStore = createTourViewerStore();
  const hooks = createUnwiredHooks();
  const logged: TourViewingAction[] = [];
  const viewingLog = createViewingLog({
    enabled: () => true,
    dispatch: (action) => logged.push(action),
    alignmentMatrix: () => selectAlignmentMatrix(arStore.getState()),
    scanGate: () => ctx.scanGate.kind,
    arVisitIndex: () => 0,
    now: () => clock.nowMs,
  });
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
    viewingLog,
    now: () => clock.nowMs,
  });
  const enter = (): void => {
    ctx.currentLevels = new Map([[LEVEL_ID, LEVEL]]);
    ctx.levelByText.set(TEXT, LEVEL);
    ctx.levelIdByText.set(TEXT, LEVEL_ID);
    placement.startViewerPipeline();
    placement.startScanGate();
  };
  enter();
  const config = () => captured.configs.at(-1)!;
  const lock = (atMs: number): void => {
    clock.nowMs = Math.max(clock.nowMs, atMs);
    const c = config();
    c.onDetection?.({
      text: TEXT,
      timestamp: atMs,
      qrPoseWorld: CODE_POSE,
      reprojectionErrorPx: 0.5,
    } as QrDetectionEvent);
    const pose = c.resolveStablePose?.(TEXT) ?? null;
    if (pose !== null) {
      c.dispatchVotes(
        buildQrGpsVotes({
          qrPoseWorld: pose,
          sizeM: 0.2,
          qrGeo: SAVED_GEO,
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
  let fixes = 0;
  /** A device fix at world [n, e] at page second `s` (GPS exact). */
  const fixAt = (s: number, n: number, e: number): void => {
    clock.nowMs = T0 + s * 1000;
    if (fixes === 0) arStore.dispatch(setZeroPos(ZERO));
    fixes += 1;
    const g = calcGpsCoords(ZERO, [n, 400, e]);
    const payload: RecordGpsEventPayload = {
      odomPosition: raw([n, 1.4, e], new Quaternion()).position,
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `gps-${String(fixes)}`,
        latitude: g.lat,
        longitude: g.lon,
        altitude: 400,
        latLongAccuracy: 4,
        timestamp: T0 + s * 1000,
      },
    };
    placement.recordDeviceFix(payload);
  };
  /** Walk a 10 m circle around the physical poster, one fix a second. */
  const walk = (from: number, to: number): void => {
    for (let s = from; s <= to; s += 1) {
      const a = (2 * Math.PI * s) / 30;
      fixAt(s, PHYSICAL[0] + 10 * Math.cos(a), PHYSICAL[1] + 10 * Math.sin(a));
    }
  };
  /** Where the store's alignment puts the poster now (world NUE), and its
   *  distance from where the poster really is. */
  const posterOffM = (): number => {
    const a = selectAlignmentMatrix(arStore.getState());
    if (a === null) return Number.NaN;
    const p = new Vector3(PHYSICAL[0], 1.5, PHYSICAL[1]).applyMatrix4(
      new Matrix4().fromArray([...a]),
    );
    return Math.hypot(p.x - PHYSICAL[0], p.z - PHYSICAL[1]);
  };
  const votesStored = () =>
    (arStore.getState().gpsData?.gpsEvents?.gpsPositions ?? []).filter(
      (p) => gpsPointSourceOf(p) === GPS_POINT_SOURCE_SYNTHETIC_QR,
    ).length;
  const statusLine = () =>
    arStatusLine({
      mode: "visitor",
      arStatus: "running",
      cameraFrames: 0,
      tour: { kind: "open", levelCount: 1 },
      qr: {
        status: "tracking",
        unknownCode: null,
        unusableCode: null,
        reprojectionErrorPx: null,
        ignoredCode: ctx.viewerIgnoredText,
        votedLocks: ctx.viewerVotedLocks,
        lockedText: ctx.viewerLockedText,
        hold: ctx.viewerKeepAlive?.phase(clock.nowMs) ?? null,
      },
      readiness: null,
      placement: ctx.placement,
      planesError: null,
      contentError: null,
      gate: ctx.scanGate,
      content: { kind: "none" },
    });
  return {
    ctx,
    arStore,
    placement,
    clock,
    lock,
    fixAt,
    walk,
    posterOffM,
    votesStored,
    statusLine,
    logged,
    enter,
  };
}

/** A scan at second 1 (the zero from a fix at second 0), the burst of
 *  voted locks, then a walk until the check decides. */
function scannedAndWalked() {
  const v = viewer();
  v.walk(0, 0);
  for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
    v.lock(T0 + 1000 + i * 100);
  }
  return v;
}

describe(
  "the viewer's post-scan veto of a moved code (D20, M5c)",
  { timeout: 120_000 },
  () => {
    it("vetoes a code 40 m from its saved spot once the walk has 60 s of evidence: the keep-alive stops, every vote is taken back, the tour moves once to where GPS puts it", () => {
      const v = scannedAndWalked();
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
      expect(v.votesStored()).toBeGreaterThan(0);
      // While the votes hold, the alignment puts the poster at its SAVED
      // spot: about the 40 m move off.
      const offs: number[] = [];
      let vetoAt = -1;
      for (let s = 1; s <= 90; s += 1) {
        v.walk(s, s);
        offs.push(v.posterOffM());
        if (vetoAt < 0 && v.ctx.ignoredCodes.has(LEVEL_ID)) vetoAt = s;
      }
      expect(vetoAt).toBeGreaterThanOrEqual(60);
      expect(vetoAt).toBeLessThan(75);
      // Before the veto the votes held the tour near the saved spot...
      expect(offs[vetoAt - 2]!).toBeGreaterThan(25);
      // ...at it, the content moved ONCE, to the GPS answer...
      expect(offs[vetoAt - 1]!).toBeLessThan(1);
      // ...and stayed there: no further step bigger than half a metre.
      for (let k = vetoAt; k < offs.length; k += 1) {
        expect(Math.abs(offs[k]! - offs[k - 1]!)).toBeLessThan(0.5);
      }
      expect(v.votesStored()).toBe(0);
      expect(v.ctx.viewerKeepAlive?.phase(v.clock.nowMs)).toEqual({
        kind: "none",
      });
      expect(
        v.arStore.getState().gpsData?.alignmentOverrides ?? null,
      ).toBeNull();
    });

    it("ignores the code's later locks for the rest of the tour: no fused pose, no vote, no keep-alive, and the gate and line say so", () => {
      const v = scannedAndWalked();
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "ignored" });
      const resolves = captured.resolves;
      for (let i = 0; i < 30; i += 1) v.lock(T0 + 76_000 + i * 100);
      expect(captured.resolves).toBe(resolves);
      expect(v.votesStored()).toBe(0);
      v.walk(76, 80);
      expect(v.votesStored()).toBe(0);
      expect(v.ctx.viewerKeepAlive?.phase(v.clock.nowMs)).toEqual({
        kind: "none",
      });
      const line = v.statusLine();
      expect(line).toContain(IGNORED_CODE_LINE);
      expect(line).not.toMatch(/Relocaliz|Point the phone|Scan the code again/);
      // The short gate pass is folded into the plain line, not said twice.
      expect(line).not.toContain("Code ignored - placing the tour by GPS.");
    });

    it("logs the veto once with the detector's inputs and the recovery", () => {
      const v = scannedAndWalked();
      v.walk(1, 80);
      const ignored = v.logged.filter(
        (a) => a.type === "tourViewing/codeIgnored",
      );
      expect(ignored).toHaveLength(1);
      const action = ignored[0]!;
      if (action.type !== "tourViewing/codeIgnored") throw new Error();
      const payload = action.payload;
      expect(payload).toMatchObject({ text: TEXT, levelId: LEVEL_ID });
      expect(payload.evidence).toMatchObject({
        decidedBy: "position",
        settled: true,
        outdoor: true,
        deviceAccuracyMedianM: 4,
      });
      expect(payload.evidence.magnitudeM).toBeGreaterThan(35);
      expect(payload.recovery.refedFixes).toBeGreaterThan(60);
      expect(payload.recovery.batches).toBe(1);
    });

    // Why (§7j #13): the veto is per tour per page session - an AR exit and
    // re-entry keeps it (the gate passes "ignored" at once for a tour whose
    // only code is ignored), a tour switch clears it.
    it("keeps the veto across an AR re-entry, and forgets it at a tour switch", () => {
      const v = scannedAndWalked();
      v.walk(1, 75);
      endQrPipeline(v.ctx);
      v.enter();
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "ignored" });
      const resolves = captured.resolves;
      v.lock(T0 + 200_000);
      expect(captured.resolves).toBe(resolves);
      endTourCodeVotes(v.ctx);
      expect(v.ctx.ignoredCodes.size).toBe(0);
      v.lock(T0 + 201_000);
      expect(captured.resolves).toBe(resolves + 1);
      expect(v.votesStored()).toBeGreaterThan(0);
    });

    it("never vetoes a code that hangs where it was saved", () => {
      captured.stablePose = null;
      const v = viewer();
      const savedPose = raw(
        [SAVED.positionNue[0], SAVED.positionNue[1], SAVED.positionNue[2]],
        new Quaternion(...SAVED.rotationNue),
      );
      captured.stablePose = savedPose;
      v.fixAt(0, SAVED.positionNue[0], SAVED.positionNue[2]);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 1000 + i * 100);
      }
      for (let s = 1; s <= 90; s += 1) {
        const a = (2 * Math.PI * s) / 30;
        v.fixAt(
          s,
          SAVED.positionNue[0] + 10 * Math.cos(a),
          SAVED.positionNue[2] + 10 * Math.sin(a),
        );
      }
      expect(v.ctx.ignoredCodes.size).toBe(0);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
      expect(v.logged.some((a) => a.type === "tourViewing/codeIgnored")).toBe(
        false,
      );
    });
  },
);
