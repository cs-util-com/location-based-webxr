/**
 * Viewer content follows the live alignment (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.2 "Viewing - content follows the alignment", owner
 * decision D10a, milestone M2d).
 *
 * Why this test matters: it pins a DECISION, so that nobody "fixes" the
 * viewer into per-note GPS anchors (`FW/visualization/gps-anchor.ts`)
 * without meeting it. The plan's cold review showed an anchor moves only
 * while off screen and by more than `threshold x (1 + 0.1 x distance)`
 * (at least ~2.2 m), and sets position only - so a scan's correction would
 * stay hidden while the visitor looks at the note, and the 0.3 m field
 * acceptance would be out of reach. The viewer therefore places the tour's
 * content ONCE at the scene root in the session's GPS-world NUE, and the
 * alignment (applied to the odometry group the camera lives in) carries it:
 * every alignment change moves the content in the visitor's view, and a
 * scan's correction reaches it in the same dispatch as the votes.
 *
 * It drives the REAL call site (M2b/M2d milestone review #9): the viewer's
 * placement (`viewer-placement.ts`, `tryPlaceContent`) with the real QR
 * tracking controller and the real viewer store - only the device is
 * faked (a detector that always sees the code, a pose solve that returns
 * its true pose) and the fused pose is a stand-in that has converged. So
 * it also pins the controller's order the scan gate relies on: a frame's
 * votes are dispatched BEFORE its lock is reported, which is why the gate
 * passes - and the content is placed - on the very first locked frame,
 * already through the corrected alignment.
 *
 * Scenario: exact odometry whose frame equals GPS-world NUE up to the
 * absolute altitude (the true alignment is a lift by the altitude), GPS
 * biased by B to the north-east, a ~40 m walk to a code minted at its true
 * pose, a pin 3.6 m beside it. "Where the visitor sees the pin" is the
 * pin's scene position mapped into the odometry frame through the store's
 * alignment - what the aligned world group makes of it, once its lerp
 * settles.
 */
import { describe, expect, it, vi } from "vitest";
import { Matrix4, Object3D, Scene, Vector3 } from "three";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import {
  calcGpsCoords,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
  webxrToNUE,
  type Vector3 as NumTriple,
} from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

/** The code's converged (fused) pose: a stand-in, its own tests are
 *  `fused-pose-wiring.test.ts`. */
const fused = vi.hoisted(() => ({ pose: null as Pose | null }));
vi.mock("gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source", () => ({
  createFusedQrPoseSource: () => ({
    resolve: () => fused.pose,
    evaluate: () => null,
    last: () => null,
  }),
}));

const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const ALT = 400;
const TEXT = "https://gps.csutil.com/tour/?qr=m2d";
/** The TRUE alignment: odometry NUE lifted to absolute altitude (GPS-world
 *  Up is absolute altitude in this stack), no rotation, no offset. */
const TRUE_ALIGNMENT: readonly number[] = new Matrix4()
  .makeTranslation(0, ALT, 0)
  .toArray();

/** The code: 22 m north, 6 m east of the zero at 1.5 m, facing +z (WebXR). */
const CODE_ODOM: Pose = { position: [6, 1.5, -22], rotation: [0, 0, 0, 1] };
/** The pin's true position, 3.6 m from the code (NUE: north, up, east). */
const PIN_TRUE_NUE: NumTriple = [20, 1.5, 9];

/** `A · p` for a column-major 4x4 alignment and a NUE point. */
function apply(a: readonly number[], p: NumTriple): NumTriple {
  const v = new Vector3(...p).applyMatrix4(new Matrix4().fromArray([...a]));
  return [v.x, v.y, v.z];
}

/** Where the visitor sees a scene-root point, in the odometry frame. */
function inView(a: readonly number[], sceneNue: NumTriple): NumTriple {
  return apply(
    new Matrix4()
      .fromArray([...a])
      .invert()
      .toArray(),
    sceneNue,
  );
}

function distance(a: NumTriple, b: NumTriple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Lets the controller's async steps settle: the level lookup hashes the
 *  code's text with Web Crypto, which is not a microtask. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** The code and the pin as the creator's zip stores them: the code minted
 *  at its TRUE pose (true alignment), the pin at its true spot. */
function tourAtTruth(): { level: QrLevel; pin: TourPin } {
  const codeWorld = qrWorldPoseFromOdom(CODE_ODOM, [
    ...TRUE_ALIGNMENT,
  ] as never);
  const qrGeo = mintQrGeoPose({
    worldNuePosition: codeWorld.position,
    worldNueRotation: codeWorld.rotation,
    zero: ZERO,
  });
  const pinGeo = calcGpsCoords(ZERO, [PIN_TRUE_NUE[0], 0, PIN_TRUE_NUE[2]]);
  return {
    level: { version: 1, qr: { physicalSizeM: 0.2, geo: qrGeo } },
    pin: {
      id: "pin",
      kind: "pin",
      label: "Here",
      createdAtIso: "2026-09-30T00:00:00.000Z",
      geo: {
        lat: pinGeo.lat,
        lon: pinGeo.lon,
        alt: ALT + PIN_TRUE_NUE[1],
        rotation: [0, 0, 0, 1],
      },
    },
  };
}

/**
 * A visitor session over the real placement, controller and store; GPS
 * biased by `biasM` at bearing 60°. Returns what the scan and the checks
 * need.
 */
async function visitorSession(biasM: number) {
  const bias = [biasM * 0.5, biasM * Math.sqrt(3) * 0.5] as const; // N, E
  // First: the store's construction activates the licence-gated geodesy.
  const arStore = createTourViewerStore();
  const { level, pin } = tourAtTruth();
  const scene = new Scene();
  const label = new Object3D();
  const syntheticVotes = (): number =>
    (arStore.getState().gpsData?.gpsEvents?.gpsPositions ?? []).filter(
      (p) => gpsPointSourceOf(p) === GPS_POINT_SOURCE_SYNTHETIC_QR,
    ).length;
  /** The synthetic votes in the store when the pin's label was made. */
  const atRender: { votes: number | null } = { votes: null };
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () =>
        Promise.resolve({
          text: TEXT,
          corners: [
            { x: 300, y: 200 },
            { x: 340, y: 200 },
            { x: 340, y: 240 },
            { x: 300, y: 240 },
          ],
        }),
    }),
    solveQrPose: () => ({
      qrPoseWorld: CODE_ODOM,
      qrPoseInCamera: { position: [0, 0, -1.5], rotation: [0, 0, 0, 1] },
      reprojectionErrorPx: 0.4,
    }),
    getIntrinsics: () => ({ fx: 500, fy: 500, cx: 320, cy: 240 }),
    getScene: () => scene,
    createLabel: () => {
      atRender.votes = syntheticVotes();
      return { object: label, dispose: () => undefined };
    },
    canShareZip: () => false,
  } as unknown as TourViewerSeams;
  /** The page clock: the controller's lock times (set after the walk). */
  const clock = { nowMs: T0 };
  const ctx = createTourViewerSession();
  ctx.session = {
    hasRecording: false,
    archive: { url: "https://example.test/tour.zip" },
    loadContentEntry: () => Promise.reject(new Error("no photos here")),
  } as unknown as TourSession;
  ctx.tourManifest = { version: 1, objects: [pin] } as never;
  ctx.tourManifestStatus = "settled";
  ctx.currentLevels = new Map([[await qrCodeId(TEXT), level]]);
  ctx.placementUnsubscribe = () => undefined; // a viewer session is live
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
    hooks: createUnwiredHooks(),
    now: () => clock.nowMs,
  });
  fused.pose = CODE_ODOM;
  placement.startViewerPipeline();
  placement.startScanGate();

  /** A device fix at odometry `p` (WebXR), reported biased. */
  const fix = (p: NumTriple, t: number): void => {
    const nue = webxrToNUE(p);
    const geo = calcGpsCoords(ZERO, [nue[0] + bias[0], 0, nue[2] + bias[1]]);
    // Through the page's device-fix path (main.ts: the coordinator's
    // `recordFix`), where the keep-alive casts its ring with the fix.
    placement.recordDeviceFix({
      odomPosition: p,
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `gps-${String(t)}`,
        latitude: geo.lat,
        longitude: geo.lon,
        altitude: ALT + nue[1],
        latLongAccuracy: 3,
        timestamp: t,
      },
    });
  };
  /** One camera frame through the real controller. */
  let frameNo = 0;
  const frame = async (): Promise<void> => {
    frameNo += 1;
    ctx.qrController!.offerFrame({
      image: { data: new Uint8ClampedArray(4), width: 640, height: 480 },
      cameraPose: { position: [6, 1.5, -20.5], rotation: [0, 0, 0, 1] },
      capturedAtMs: frameNo * 125,
    } as never);
    await flush();
  };
  arStore.dispatch(setZeroPos(ZERO));
  return {
    ctx,
    arStore,
    scene,
    label,
    fix,
    frame,
    syntheticVotes,
    atRender,
    clock,
  };
}

/** The walk from the zero north, then east, towards the code: 1 Hz fixes. */
function walk(s: Awaited<ReturnType<typeof visitorSession>>, laps = 0): void {
  let t = T0;
  for (let n = 0; n <= 22; n += 1) s.fix([0, 1.5, -n], (t += 1000));
  for (let e = 1; e <= 6; e += 1) s.fix([e, 1.5, -22], (t += 1000));
  for (let lap = 0; lap < laps; lap += 1) {
    for (let e = 5; e >= 0; e -= 1) s.fix([e, 1.5, -22], (t += 1000));
    for (let e = 1; e <= 6; e += 1) s.fix([e, 1.5, -22], (t += 1000));
  }
  s.clock.nowMs = t + 500; // the scan follows the walk
}

describe("viewer content follows the live alignment (D10a, M2d)", () => {
  it("is placed at the scene root on the first voted lock, through the alignment that lock's votes already corrected, and never re-placed", async () => {
    const s = await visitorSession(8);
    walk(s);

    // Before the scan: nothing is placed (the gate scans), and the biased
    // alignment would show the pin ~8 m off its true spot.
    expect(s.ctx.scanGate.kind).toBe("scanning");
    expect(s.label.parent).toBeNull();
    const before = selectAlignmentMatrix(s.arStore.getState())!;
    expect(
      distance(inView(before, PIN_TRUE_NUE), PIN_TRUE_NUE),
    ).toBeGreaterThan(6);

    // Frames until the first one that votes: the controller locks after a
    // few consistent detections.
    let frames = 0;
    while (s.syntheticVotes() === 0 && frames < 20) {
      await s.frame();
      frames += 1;
    }
    // The votes-before-lock order: the frame that cast the first votes is
    // the frame whose lock passed the gate and placed the content, and the
    // label was made with those votes already in the store. Were the lock
    // reported first, this lock would find no vote and the gate would pass
    // one frame later.
    expect(s.syntheticVotes()).toBe(VIEWER_VOTE_COUNT);
    expect(s.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
    expect(s.atRender.votes).toBe(VIEWER_VOTE_COUNT);

    await flush();
    // At the scene root, in the session's NUE: no anchor, not under the
    // odometry group, and exactly where the pin's geo puts it.
    expect(s.label.parent?.parent).toBe(s.scene);
    const placed = s.label.getWorldPosition(new Vector3());
    const pinScene: NumTriple = [placed.x, placed.y, placed.z];
    expect(
      distance(pinScene, [
        PIN_TRUE_NUE[0],
        ALT + PIN_TRUE_NUE[1],
        PIN_TRUE_NUE[2],
      ]),
    ).toBeLessThan(1e-6);

    // The rest of the scan's burst moves the alignment and never the pin.
    const afterFirst = selectAlignmentMatrix(s.arStore.getState())!;
    for (let i = 1; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) await s.frame();
    expect(s.syntheticVotes()).toBe(
      MAX_VOTED_LOCKS_PER_CODE * VIEWER_VOTE_COUNT,
    );
    const after = selectAlignmentMatrix(s.arStore.getState())!;
    expect(after).not.toEqual(afterFirst);
    expect(s.label.getWorldPosition(new Vector3()).toArray()).toEqual(
      placed.toArray(),
    );
    // WHAT THIS PINS, and what it does not (M2b/M2d review #9): the whole
    // correction reaches the pin. It is not an accuracy claim: at B = 8 m
    // every biased fix lies beyond the core's 5 m hard outlier trim once
    // the votes are in, so the solve is the votes' alone and the pin lands
    // on its true spot to the millimetre (measured 0.0000 m; 0.05 m after
    // the first lock alone). The 0.3 m field acceptance is the vote-strength
    // harness's to measure (`viewer-vote-strength.test.ts`).
    expect(distance(inView(after, pinScene), PIN_TRUE_NUE)).toBeLessThan(0.01);
  }, 60_000);

  // Why: the case above is exact by construction, so it cannot tell "the
  // content follows the alignment" from "the solve happens to be exact".
  // Here the GPS keeps its say - B = 3 m is inside the hard trim, and a
  // longer walk (10 laps, 149 fixes) weighs against the 160 votes - so the
  // alignment is a compromise and the pin must show exactly that
  // compromise: neither the pre-scan error nor zero. Measured (walk laps x
  // bias, residual in view): 0 laps 3-8 mm at B 2-5 m (exact from 6 m, the
  // trim); 10 laps 16 / 24 / 40 / 11 mm at B 2 / 3 / 5 / 8 m; 50 laps
  // 65 / 98 / 163 / 131 mm. What would break the bounds: a vote count or
  // solver weighting change that makes this case exact (below 5 mm) or
  // loses the scan's hold on it (above 0.1 m).
  it("shows the alignment's compromise when the GPS keeps its say, not an exact result", async () => {
    const s = await visitorSession(3);
    walk(s, 10);
    const before = selectAlignmentMatrix(s.arStore.getState())!;
    let frames = 0;
    while (
      s.syntheticVotes() < MAX_VOTED_LOCKS_PER_CODE * VIEWER_VOTE_COUNT &&
      frames < 40
    ) {
      await s.frame();
      frames += 1;
    }
    await flush();
    const placed = s.label.getWorldPosition(new Vector3());
    const pinScene: NumTriple = [placed.x, placed.y, placed.z];
    const after = selectAlignmentMatrix(s.arStore.getState())!;
    expect(distance(inView(before, pinScene), PIN_TRUE_NUE)).toBeGreaterThan(
      2.5,
    );
    const residual = distance(inView(after, pinScene), PIN_TRUE_NUE);
    expect(residual).toBeGreaterThan(0.005);
    expect(residual).toBeLessThan(0.1);
  }, 120_000);
});
