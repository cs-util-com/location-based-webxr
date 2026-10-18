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
  selectZeroReference,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import { objectPoseNue } from "./content-placement.js";
import {
  IGNORED_CODE_LINE,
  MAX_VOTED_LOCKS_PER_CODE,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import {
  arStatusLine,
  codePlacedTour,
  type ArStatusInput,
} from "./tour-flow.js";
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
import { stationAlignmentSignals } from "./visitor-stations.js";
import { visitorStatus } from "./visitor-status.js";

const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
  stablePose: null as Pose | null,
  /** A stable pose per code text (a second code); else `stablePose`. */
  poses: new Map<string, Pose>(),
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
    resolve: (text: string) => {
      captured.resolves += 1;
      return captured.poses.get(text) ?? captured.stablePose;
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

/** A second code, 30 m north and 30 m west of the zero, hung exactly where
 *  it was saved, facing north: a code that works. */
const TEXT_B = "https://gps.csutil.com/tour/?qr=m5c&n=2";
const LEVEL_ID_B = "m5c-b";
const SAVED_GEO_B = (() => {
  const g = calcGpsCoords(ZERO, [30, 400, -30]);
  return { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 0 };
})();
const LEVEL_B: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: SAVED_GEO_B,
    mintQuality: { alignmentSampleCount: 300, gpsAccuracyM: 3 },
  },
};
const SAVED_B = objectPoseNue(SAVED_GEO_B, ZERO);

function viewer(level: QrLevel = LEVEL, withCodeB = false) {
  captured.configs.length = 0;
  captured.poses.clear();
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
    ctx.currentLevels = new Map([
      [LEVEL_ID, level],
      ...(withCodeB ? ([[LEVEL_ID_B, LEVEL_B]] as const) : []),
    ]);
    ctx.levelByText.set(TEXT, level);
    ctx.levelIdByText.set(TEXT, LEVEL_ID);
    if (withCodeB) {
      ctx.levelByText.set(TEXT_B, LEVEL_B);
      ctx.levelIdByText.set(TEXT_B, LEVEL_ID_B);
      captured.poses.set(
        TEXT_B,
        raw(
          [
            SAVED_B.positionNue[0],
            SAVED_B.positionNue[1],
            SAVED_B.positionNue[2],
          ],
          new Quaternion(...SAVED_B.rotationNue),
        ),
      );
    }
    placement.startViewerPipeline();
    placement.startScanGate();
  };
  enter();
  const config = () => captured.configs.at(-1)!;
  /** One frame of a lock of code A, or of code B with `which`. */
  const lock = (atMs: number, which: "A" | "B" = "A"): void => {
    clock.nowMs = Math.max(clock.nowMs, atMs);
    const c = config();
    const text = which === "A" ? TEXT : TEXT_B;
    c.onDetection?.({
      text,
      timestamp: atMs,
      qrPoseWorld: which === "A" ? CODE_POSE : captured.poses.get(TEXT_B)!,
      reprojectionErrorPx: 0.5,
    } as QrDetectionEvent);
    const pose = c.resolveStablePose?.(text) ?? null;
    if (pose !== null) {
      c.dispatchVotes(
        buildQrGpsVotes({
          qrPoseWorld: pose,
          sizeM: 0.2,
          qrGeo: which === "A" ? SAVED_GEO : SAVED_GEO_B,
          syntheticAccuracyM: c.syntheticAccuracyM,
          ...(c.voteBaselineM !== undefined
            ? { baselineM: c.voteBaselineM }
            : {}),
          ...(c.voteCount !== undefined ? { count: c.voteCount } : {}),
          timestamp: atMs,
        }),
      );
    }
    c.onLocked?.({} as never, which === "A" ? level : LEVEL_B);
  };
  let fixes = 0;
  /** A device fix at world [n, e] at page second `s` (GPS exact), with
   *  any extra payload fields (a compass reading). */
  const fixAt = (
    s: number,
    n: number,
    e: number,
    extra: Partial<RecordGpsEventPayload> = {},
    /** GPS error (north, east) m: the fix reads truth plus this. */
    gpsBias: readonly [number, number] = [0, 0],
  ): void => {
    clock.nowMs = T0 + s * 1000;
    // The coordinator's rule: a zero only when the session has none (a
    // code may have set it, QR-first M1).
    if (selectZeroReference(arStore.getState()) === null) {
      arStore.dispatch(setZeroPos(ZERO));
    }
    fixes += 1;
    const g = calcGpsCoords(ZERO, [n + gpsBias[0], 400, e + gpsBias[1]]);
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
      ...extra,
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
  const statusInput = (): ArStatusInput => ({
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
  const statusLine = () => arStatusLine(statusInput());
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
    statusInput,
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
        turnChecked: true,
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

    // Why (owner, 2026-10-02): "the global rotation of the QR code should
    // only ever come from the global pose in the GPS world space". A code
    // saved early (30 solved fixes) and re-hung turned in place, seen by a
    // visitor whose phone reports an absolute orientation with every fix:
    // whatever the compass says, the viewer must not judge the code by it.
    // The visitor stays near the code (under the 2 m spread), so the GPS
    // path decides nothing either.
    it("uses no compass reading: a turned code of an early save is never vetoed, whatever the device's compass reads", () => {
      const early: QrLevel = {
        ...LEVEL,
        qr: {
          ...LEVEL.qr,
          mintQuality: { alignmentSampleCount: 30, gpsAccuracyM: 3 },
        },
      };
      const turned = raw(
        [SAVED.positionNue[0], SAVED.positionNue[1], SAVED.positionNue[2]],
        new Quaternion(...SAVED.rotationNue).premultiply(
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            Math.PI * (150 / 180),
          ),
        ),
      );
      // Two device orientations (a quarter turn about the device's y axis,
      // and none): under the retired compass channel the first read this
      // code as turned 120 degrees and vetoed it at the first fix after the
      // scan (the second gave no bearing). One viewer run per orientation -
      // each fix is a full solve.
      for (const axis of [new Vector3(0, 1, 0)]) {
        for (const headingDeg of [90, 0]) {
          const q = new Quaternion().setFromAxisAngle(
            axis,
            (headingDeg * Math.PI) / 180,
          );
          const compass: Partial<RecordGpsEventPayload> = {
            rawAbsoluteOrientation: {
              quaternion: [q.x, q.y, q.z, q.w],
              referenceFrame: "device",
              screenAngleDeg: 0,
              sampleTimestamp: 0,
            },
          };
          const v = viewer(early);
          captured.stablePose = turned;
          v.fixAt(0, SAVED.positionNue[0], SAVED.positionNue[2], compass);
          for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
            v.lock(T0 + 1000 + i * 100);
          }
          for (let s = 1; s <= 90; s += 1) {
            const a = (2 * Math.PI * s) / 30;
            v.fixAt(
              s,
              SAVED.positionNue[0] + 1.2 * Math.cos(a),
              SAVED.positionNue[2] + 1.2 * Math.sin(a),
              compass,
            );
          }
          expect(v.ctx.ignoredCodes.size).toBe(0);
          expect(
            v.logged.some((a) => a.type === "tourViewing/codeIgnored"),
          ).toBe(false);
        }
      }
    });

    // Why (M5c review M1): a tour can have two codes. The veto of a moved
    // one must not overrule another that works: once code B casts votes,
    // the line stops saying "this code seems to have been moved", and the
    // gate says the code was recognised again.
    it("after a veto, another code's voted lock clears the ignored line and the gate", () => {
      const v = viewer(LEVEL, true);
      v.walk(0, 0);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 1000 + i * 100);
      }
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.statusLine()).toContain(IGNORED_CODE_LINE);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "ignored" });
      v.lock(T0 + 76_000, "B");
      expect(v.ctx.viewerIgnoredText).toBeNull();
      expect(v.statusLine()).not.toContain(IGNORED_CODE_LINE);
      expect(v.statusLine()).toMatch(/Relocalizing/);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
    });

    // Why (M5c review M1): the gate records which code passed it. Code B
    // passed it; code A, scanned later and found moved, must not flip B's
    // pass to "Code ignored".
    it("leaves the gate with the code that passed it when another code is vetoed", () => {
      const v = viewer(LEVEL, true);
      v.walk(0, 0);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 500 + i * 10, "B");
      }
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 1000 + i * 100);
      }
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID_B)).toBe(false);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
    });

    // Why (r881 review M1): the veto takes every vote back, but the page
    // kept its count of voted locks, so every reader of "a code lined the
    // tour up" kept believing it on what was a GPS-only alignment again:
    // the stations trusted it whatever the raw accuracy, and the status
    // line said "Tour placed." instead of naming the moved code.
    it("the veto forgets the voted locks: the stations stop trusting the alignment and the line names the moved code", () => {
      const v = scannedAndWalked();
      expect(v.ctx.viewerVotedLocks).toBeGreaterThan(0);
      expect(stationAlignmentSignals(v.ctx, v.arStore).codeLinedUp()).toBe(
        true,
      );
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.ctx.viewerVotedLocks).toBe(0);
      expect(v.ctx.viewerLockedText).toBeNull();
      expect(stationAlignmentSignals(v.ctx, v.arStore).codeLinedUp()).toBe(
        false,
      );
      expect(
        visitorStatus({
          ...v.statusInput(),
          content: { kind: "placed", count: 1, skipped: 0 },
        }),
      ).toEqual({
        state: "placed-gps",
        text: "Tour placed by GPS (less exact): its code seems to have been moved. Look around.",
      });
    });

    // Why (r881 review M1): code B passed the gate and keeps it, but the
    // veto of code A took B's votes back too. The placement trigger's
    // "a code placed the tour" must not hold on B's spent count, or the
    // walk's photos would place on a GPS-only alignment with no heading.
    it("after a veto the placement trigger no longer reads the tour as code-placed, until a code votes again", () => {
      const v = viewer(LEVEL, true);
      v.walk(0, 0);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 500 + i * 10, "B");
      }
      expect(codePlacedTour(v.ctx)).toBe(true);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 1000 + i * 100);
      }
      let s = 1;
      while (!v.ctx.ignoredCodes.has(LEVEL_ID) && s <= 90) {
        v.walk(s, s);
        s += 1;
      }
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
      expect(codePlacedTour(v.ctx)).toBe(false);
      // B's next lock votes again: code-placed once more.
      v.lock(T0 + s * 1000, "B");
      expect(codePlacedTour(v.ctx)).toBe(true);
    });

    // Why (M5c review M2): the veto takes EVERY vote back - another code's
    // too. Code B, scanned after A and spent, is the code the keep-alive
    // holds; without a budget reset its next lock casts nothing (its hold is
    // fresh, so the stale-code re-arm does not apply) and the tour leans on
    // GPS alone until the next device fix's ring. Its next lock must vote at
    // once; the vetoed code stays ignored.
    it("lets another code vote again by lock right after the veto, while the vetoed one stays ignored", () => {
      const v = viewer(LEVEL, true);
      v.walk(0, 0);
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 500 + i * 10);
      }
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + 700 + i * 10, "B");
      }
      let s = 1;
      while (!v.ctx.ignoredCodes.has(LEVEL_ID) && s <= 90) {
        v.walk(s, s);
        s += 1;
      }
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      expect(v.votesStored()).toBe(0);
      // The next lock of B, before any further device fix.
      v.lock(T0 + s * 1000, "B");
      const afterB = v.votesStored();
      expect(afterB).toBeGreaterThan(0);
      v.lock(T0 + s * 1000 + 100);
      expect(v.votesStored()).toBe(afterB);
    });

    // Why (polish round C5, owner decision Q-C5): a veto used to hold for
    // the rest of the tour. It is re-judged now: once a wider walk reads the
    // code consistent again, the code is used again - the ignored line
    // goes, the lift is logged, and its next lock votes. Here the GPS that
    // read the poster 40 m off turns biased by those 40 m (as a GPS bias
    // that later clears would), so the evidence ends up consistent.
    it("lifts the veto once wider evidence reads the code consistent, and the code places the tour again", () => {
      const v = scannedAndWalked();
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      for (let s = 76; s <= 420; s += 1) {
        const a = (2 * Math.PI * s) / 60;
        v.fixAt(
          s,
          PHYSICAL[0] + 25 * Math.cos(a),
          PHYSICAL[1] + 25 * Math.sin(a),
          {},
          [0, -MOVE_EAST_M],
        );
      }
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(false);
      expect(v.statusLine()).not.toContain(IGNORED_CODE_LINE);
      const restored = v.logged.filter(
        (a) => a.type === "tourViewing/codeRestored",
      );
      expect(restored).toHaveLength(1);
      expect(restored[0]!.payload).toMatchObject({
        text: TEXT,
        levelId: LEVEL_ID,
      });
      const before = v.votesStored();
      v.lock(T0 + 421_000);
      expect(v.votesStored()).toBeGreaterThan(before);
    });

    // Why (the M0a review #1): an AR exit and re-entry ended the vetoed
    // code's check, and nothing pinned a new one - the veto stuck for the
    // rest of the tour again. The ignored code's next lock pins a probation
    // check in the new entry, which lifts the veto on wider evidence.
    it("re-judges a veto across an AR re-entry: the ignored code's lock starts a probation check", () => {
      const v = scannedAndWalked();
      v.walk(1, 75);
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(true);
      endQrPipeline(v.ctx);
      v.enter();
      v.lock(T0 + 76_000);
      for (let s = 77; s <= 460; s += 1) {
        const a = (2 * Math.PI * s) / 60;
        v.fixAt(
          s,
          PHYSICAL[0] + 25 * Math.cos(a),
          PHYSICAL[1] + 25 * Math.sin(a),
          {},
          [0, -MOVE_EAST_M],
        );
      }
      expect(v.ctx.ignoredCodes.has(LEVEL_ID)).toBe(false);
      expect(
        v.logged.filter((a) => a.type === "tourViewing/codeRestored"),
      ).toHaveLength(1);
    });

    // Why (QR-first plan 2026-10-14-0445 §7 #9): a code scanned before any
    // device fix sets the session zero itself (M1), so a WRONG code - or a
    // phone whose GPS is somewhere else entirely - is first seen in the
    // fixes that follow. The check must still read it and take the votes
    // back, and the retraction must keep the session's frame (the zero stays
    // at the code: `resetGpsSessionData` keeps it). With no device fix at
    // all nothing can tell a wrong code from a right one.
    it("vetoes a code scanned before any fix when the fixes say the phone is 2 km away, and keeps the code's zero", () => {
      const v = viewer();
      captured.stablePose = raw(
        [SAVED.positionNue[0], SAVED.positionNue[1], SAVED.positionNue[2]],
        new Quaternion(...SAVED.rotationNue),
      );
      for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
        v.lock(T0 + i * 100);
      }
      const codeZero = { lat: SAVED_GEO.lat, lon: SAVED_GEO.lon };
      expect(selectZeroReference(v.arStore.getState())).toEqual(codeZero);
      expect(v.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
      let vetoAt = -1;
      for (let s = 1; s <= 120 && vetoAt < 0; s += 1) {
        const a = (2 * Math.PI * s) / 30;
        v.fixAt(
          s,
          SAVED.positionNue[0] + 10 * Math.cos(a),
          SAVED.positionNue[2] + 10 * Math.sin(a),
          {},
          [0, 2000],
        );
        if (v.ctx.ignoredCodes.has(LEVEL_ID)) vetoAt = s;
      }
      expect(vetoAt).toBeGreaterThanOrEqual(60);
      expect(v.votesStored()).toBe(0);
      expect(selectZeroReference(v.arStore.getState())).toEqual(codeZero);
    });

    // Why (QR-first M1 review #2): under M1 a code scanned before any fix
    // has no device fix before its pin, so the check reads a wrong code only
    // from the fixes that follow - at the earliest after the rule's 60 s of
    // evidence (CODE_MOVE_RULE.minSpanS), and below the 20 m floor
    // (MOVED_CODE_FLOOR_M) never: such a code holds the tour off by its
    // offset until its hold hands over to GPS. Measured here: 15 m never,
    // 25 m once 60 s of fixes are in.
    it.each([
      [15, false],
      [25, true],
    ] as const)(
      "reads a code scanned before any fix and hung %i m from its saved spot: vetoed = %s",
      (offsetM, vetoed) => {
        const v = viewer();
        captured.stablePose = raw(
          [
            SAVED.positionNue[0],
            SAVED.positionNue[1],
            SAVED.positionNue[2] + offsetM,
          ],
          new Quaternion(...SAVED.rotationNue),
        );
        for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
          v.lock(T0 + i * 100);
        }
        let vetoAt = -1;
        for (let s = 1; s <= 120 && vetoAt < 0; s += 1) {
          const a = (2 * Math.PI * s) / 30;
          v.fixAt(
            s,
            SAVED.positionNue[0] + 10 * Math.cos(a),
            SAVED.positionNue[2] + offsetM + 10 * Math.sin(a),
          );
          if (v.ctx.ignoredCodes.has(LEVEL_ID)) vetoAt = s;
        }
        const read =
          vetoAt < 0
            ? "never"
            : vetoAt >= 60 && vetoAt < 75
              ? "after 60-75 s"
              : `at ${String(vetoAt)} s`;
        expect(read).toBe(vetoed ? "after 60-75 s" : "never");
      },
    );

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
