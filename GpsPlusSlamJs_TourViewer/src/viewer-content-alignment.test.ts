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
import { tourOf } from "./test-support/v3-tour.js";
import { Matrix4, Object3D, Scene, Vector3 } from "three";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
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
  selectZeroReference,
  setZeroPos,
  teardownArSessionState,
} from "gps-plus-slam-app-framework/state";

import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { objectPoseNue } from "./content-placement.js";
import { wireStationGuide } from "./station-guide.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  endQrPipeline,
  endTourCodeVotes,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { stationPlacementAllowed } from "./visitor-stations.js";

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
/** A decoded photo, so a ring can be placed without a browser decoder. */
vi.mock(
  "gps-plus-slam-app-framework/visualization/frame-texture-decoder",
  async () => {
    const { Texture } = await import("three");
    return { decodeFrameTexture: () => Promise.resolve(new Texture()) };
  },
);

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
async function visitorSession(
  biasM: number,
  /** `false`: no device fix and no zero before the scan (QR-first M1). */
  withZero = true,
  /** Fields of the open tour's session over the default one (a tour
   *  without a recording whose photos cannot be read). */
  sessionOverrides: Record<string, unknown> = {},
) {
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
  /** The page timers (`seams.schedule`), fired by hand. */
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const seams = {
    schedule: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
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
    ...sessionOverrides,
  } as unknown as TourSession;
  ctx.tourManifest = tourOf([pin]);
  ctx.tourManifestStatus = "settled";
  ctx.currentLevels = new Map([[await qrCodeId(TEXT), level]]);
  ctx.placementUnsubscribe = () => undefined; // a viewer session is live
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
    now: () => clock.nowMs,
  });
  fused.pose = CODE_ODOM;
  placement.startViewerPipeline();
  placement.startScanGate();

  /** A device fix at odometry `p` (WebXR), reported biased; with
   *  `compassDeg`, carrying a compass reading of that heading (the phone
   *  faces north, so the reading's error is `compassDeg`). */
  const fix = (p: NumTriple, t: number, compassDeg?: number): void => {
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
      ...(compassDeg === undefined
        ? {}
        : { rawAbsoluteOrientation: uprightPhoneFacing(compassDeg, t) }),
    });
  };
  /** Fires every pending page timer, whatever its delay. */
  const fireAllTimers = (): number => {
    const due = timers.filter((x) => !x.cancelled);
    for (const timer of due) {
      timer.cancelled = true;
      timer.fn();
    }
    return due.length;
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
  if (withZero) arStore.dispatch(setZeroPos(ZERO));
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

    fireAllTimers,
    hooks,
    placement,
  };
}

/** The alignment's north bearing (deg, signed, 0 = the true alignment,
 *  which has no rotation here): how far the whole tour is turned in the
 *  visitor's view. Same read-out as the core's `alignmentNorthBearingDeg`
 *  (column-major: element 0 the north and element 2 the east component of
 *  the mapped north axis). */
function turnDeg(a: readonly number[]): number {
  return (Math.atan2(a[2]!, a[0]!) * 180) / Math.PI;
}

/** A compass reading from an upright phone facing heading `deg`: device
 *  X east, Y up, Z south, turned clockwise by the heading about the
 *  vertical (the core's own batch tests build it the same way). */
function uprightPhoneFacing(deg: number, t: number) {
  const h = (deg * Math.PI) / 180;
  return {
    quaternion: [
      Math.cos(-h / 2) * Math.SQRT1_2,
      Math.sin(-h / 2) * Math.SQRT1_2,
      Math.sin(-h / 2) * Math.SQRT1_2,
      Math.cos(-h / 2) * Math.SQRT1_2,
    ] as [number, number, number, number],
    referenceFrame: "device" as const,
    screenAngleDeg: 0,
    sampleTimestamp: t,
  };
}

/** Frames until the first one that votes; returns the voted locks so far. */
async function firstVotedLock(
  s: Awaited<ReturnType<typeof visitorSession>>,
): Promise<number> {
  let frames = 0;
  while (s.syntheticVotes() === 0 && frames < 20) {
    await s.frame();
    frames += 1;
  }
  return s.syntheticVotes() / VIEWER_VOTE_COUNT;
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

/** What the rendered content hangs under: a label's group, its station's
 *  group (version 3, tour editor plan W3), the content's root, then this. */
function hungUnder(label: Object3D): Object3D | null {
  return label.parent?.parent?.parent?.parent ?? null;
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
    expect(hungUnder(s.label)).toBe(s.scene);
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

  // Why (QR-first plan 2026-10-14-0445 §3 M1, the owner's field test): a
  // visitor who scans before the phone's first GPS fix used to read "waiting
  // for the first GPS fix" while nothing was placed. The code alone must
  // place the tour: through the real controller and store, with no device
  // fix at all, the first frame that votes sets the session zero at the
  // code's geo, passes the gate and places the pin where it belongs in the
  // visitor's view - the code is the session's whole GPS.
  it("is placed by a code alone, before any device fix, at its true spot in the visitor's view", async () => {
    const s = await visitorSession(8, false);
    s.clock.nowMs = T0 + 500;
    expect(selectZeroReference(s.arStore.getState())).toBeNull();
    let frames = 0;
    while (s.syntheticVotes() === 0 && frames < 20) {
      await s.frame();
      frames += 1;
    }
    expect(s.syntheticVotes()).toBe(VIEWER_VOTE_COUNT);
    const zero = selectZeroReference(s.arStore.getState())!;
    const level = [...s.ctx.currentLevels!.values()][0]!;
    expect(zero).toEqual({ lat: level.qr.geo!.lat, lon: level.qr.geo!.lon });
    expect(s.ctx.scanGate).toEqual({ kind: "passed", via: "code" });
    for (let i = 1; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) await s.frame();
    await flush();
    expect(hungUnder(s.label)).toBe(s.scene);
    const placed = s.label.getWorldPosition(new Vector3());
    const after = selectAlignmentMatrix(s.arStore.getState())!;
    // Votes alone, exact by construction: the pin lands on its true spot.
    expect(
      distance(inView(after, [placed.x, placed.y, placed.z]), PIN_TRUE_NUE),
    ).toBeLessThan(0.01);
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

// Why (r863, replacing the compass wait of 2026-10-14): after a code set the
// zero the first placement used to wait for 8 voted locks or 12 s, because
// the core's 9-solve compass window gave the first compass reading full
// weight over a short scan. The viewer's overrides now keep the code's
// rotation from its first lock (`VIEWER_SOFT_TRIM`), so the content, the
// photos and the stations show on the first voted lock again - and the
// harness (`CODE_YAW_PROBE=scan`) measured at most 0.27 deg seen after
// that with the code first (0.04 unless the first fix lands inside the
// scan), against up to 34.7 deg with the wait. These pin that nothing waits
// any more, on every entry and every tour.
describe("after a code-set zero the content shows on the first voted lock (no compass wait since r863)", () => {
  it("places the content on the first voted lock, and a 3-lock glance with 30 deg biased compass fixes keeps it within 1 deg", async () => {
    const s = await visitorSession(8, false);
    s.clock.nowMs = T0 + 500;
    expect(await firstVotedLock(s)).toBe(1);
    await flush();
    expect(hungUnder(s.label)).toBe(s.scene);
    await s.frame();
    await s.frame();
    expect(s.syntheticVotes()).toBe(3 * VIEWER_VOTE_COUNT);
    for (let i = 1; i <= 11; i += 1) {
      s.clock.nowMs = T0 + 500 + i * 1000;
      s.fix([6, 1.5, -20.5], s.clock.nowMs, 30);
      const a = selectAlignmentMatrix(s.arStore.getState())!;
      expect(Math.abs(turnDeg(a))).toBeLessThan(1);
    }
    // No page timer was armed for the placement.
    expect(s.fireAllTimers()).toBe(0);
  }, 60_000);

  // Why (r857 milestone review #1, now the other way round): the stations
  // waited with the content; with no wait, a station at the scanned code is
  // found on the very lock that places the tour. Since D16 (tour editor
  // plan 2026-10-17-1816) by its radius on the code-placed position, which
  // the lock's re-judge reads - never by the lock itself.
  it("finds the station at the scanned code on the first voted lock, by its radius", async () => {
    const s = await visitorSession(8, false);
    const levelGeo = [...s.ctx.currentLevels!.values()][0]!.qr.geo!;
    const stations: readonly TourStation[] = [
      {
        id: "tower",
        title: "TOWER",
        geo: levelGeo,
        items: [],
        activateRadiusM: 30,
        foundRadiusM: 5,
        hint: "arrow",
        steps: [
          {
            id: "s",
            block: { kind: "text", text: "Hi" },
            advance: { mode: "tap" },
          },
        ],
      },
    ];
    const found: { id: string; locks: number }[] = [];
    const guide = wireStationGuide({
      dom: {
        line: { textContent: "", hidden: true },
        skip: { textContent: "", hidden: true },
      },
      tour: () => ({ stations, order: "fixed" }),
      // The page's own gate (`visitor-stations.ts`).
      placementAllowed: () => stationPlacementAllowed(s.ctx, "visitor"),
      zero: () => selectZeroReference(s.arStore.getState()),
      // The phone at the code, once the code has placed it (an alignment
      // and a zero); no device fix at any point.
      visitor: () => {
        const state = s.arStore.getState();
        const zero = selectZeroReference(state);
        const placed = selectAlignmentMatrix(state) !== null && zero !== null;
        return {
          nue: placed ? objectPoseNue(levelGeo, zero).positionNue : null,
          accuracyM: null,
          fixNue: null,
          aligned: placed,
          fixAtMs: null,
        };
      },
      startHud: () => null,
      now: () => s.clock.nowMs,
      onFound: (station) => {
        found.push({ id: station.id, locks: s.ctx.viewerVotedLocks });
      },
    });
    s.hooks.stationCodeLocked = () => {
      guide.codeLocked();
    };
    s.clock.nowMs = T0 + 500;
    expect(await firstVotedLock(s)).toBe(1);
    expect(found).toEqual([{ id: "tower", locks: 1 }]);
  }, 60_000);

  // Why (r857 milestone review #3): a join that ran WITHOUT the code set
  // the loading latch and dropped the ring of the lock that placed the tour.
  // The trigger's join runs with the locked code, so a declining join falls
  // back to the ring in the same run - now from the first voted lock on.
  it("places the ring on a 3-lock glance when the recording declines the join", async () => {
    const s = await visitorSession(8, false, {
      hasRecording: true,
      loadSessionMeta: () => Promise.resolve(null),
      loadRecordingActions: () => Promise.resolve(null),
      entries: [{ filename: "photo.jpg", isImage: true, size: 3 }],
      loadEntry: () => Promise.resolve(new Blob(["jpg"])),
    });
    s.clock.nowMs = T0 + 500;
    expect(await firstVotedLock(s)).toBe(1);
    await s.frame();
    await s.frame();
    await flush();
    expect(s.ctx.joinDeclined).toBe(true);
    expect(s.ctx.placement).toMatchObject({
      kind: "placed",
      placedKind: "ring",
    });
  }, 60_000);

  // Why (PR #624 review, now the other way round): each AR entry clears the
  // overrides at its start (`startEntryVoteSink`), so the next entry's first
  // vote must set the compass keys again - or its scan would meet the core's
  // 9-solve window and the first compass reading would turn it.
  describe("on every AR entry and every tour", () => {
    /** The AR exit and the next entry, as `ar-entry.ts` `onSessionEnd`
     *  leaves what the placement reads: the store's session teardown (the
     *  zero kept), the entry's pipeline ended, the placed content, the gate
     *  and the lock count reset; then the next entry's pipeline. */
    function reEnterAr(s: Awaited<ReturnType<typeof visitorSession>>): void {
      teardownArSessionState(s.arStore);
      endQrPipeline(s.ctx);
      s.ctx.contentRendered?.dispose();
      s.ctx.contentRendered = null;
      s.ctx.contentAttempted = false;
      s.ctx.imagePlanes?.dispose();
      s.ctx.imagePlanes = null;
      s.ctx.scanGate = { kind: "idle" };
      s.ctx.viewerVotedLocks = 0;
      s.ctx.viewerLockedText = null;
      s.ctx.placement = { kind: "idle" };
      s.ctx.placementAttempted = false;
      s.ctx.joinDeclined = false;
      s.ctx.planesRunGeneration += 1;
      s.placement.startViewerPipeline();
      s.placement.startScanGate();
    }

    /** The same tour closed and opened again inside the entry, as
     *  `archive-open.ts` `teardownSession` leaves what the placement reads:
     *  the codes' caches, the code votes, the placed content, the gate and
     *  the lock count reset; the GPS history (old votes and all) and the
     *  zero stay. Then the reopened tour's gate. */
    function switchTour(s: Awaited<ReturnType<typeof visitorSession>>): void {
      s.ctx.qrController?.reset();
      s.ctx.levelByText.clear();
      s.ctx.levelIdByText.clear();
      endTourCodeVotes(s.ctx);
      s.ctx.imagePlanes?.dispose();
      s.ctx.imagePlanes = null;
      s.ctx.contentRendered?.dispose();
      s.ctx.contentRendered = null;
      s.ctx.contentAttempted = false;
      s.placement.resetScanGate();
      s.ctx.placementAttempted = false;
      s.ctx.joinDeclined = false;
      s.ctx.viewerVotedLocks = 0;
      s.ctx.viewerLockedText = null;
      s.ctx.planesRunGeneration += 1;
      s.placement.startScanGate();
    }

    /** A first entry: the code alone, a full scan, the content shown. */
    async function firstEntryShown(): Promise<
      Awaited<ReturnType<typeof visitorSession>>
    > {
      const s = await visitorSession(8, false);
      s.clock.nowMs = T0 + 500;
      expect(await firstVotedLock(s)).toBe(1);
      for (let i = 1; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) await s.frame();
      await flush();
      expect(hungUnder(s.label)).toBe(s.scene);
      return s;
    }

    /** Frames until one more voted lock has landed. */
    async function oneLock(
      s: Awaited<ReturnType<typeof visitorSession>>,
    ): Promise<void> {
      const target = s.syntheticVotes() + VIEWER_VOTE_COUNT;
      let frames = 0;
      while (s.syntheticVotes() < target && frames < 40) {
        await s.frame();
        frames += 1;
      }
      expect(s.syntheticVotes()).toBe(target);
      await flush();
    }

    /** Device fixes whose compass reads 20 deg off: the worst turn seen. */
    function biasedFixes(
      s: Awaited<ReturnType<typeof visitorSession>>,
      fromMs: number,
    ): number {
      const seen: number[] = [];
      for (let i = 1; i <= 10; i += 1) {
        s.clock.nowMs = fromMs + i * 1000;
        s.fix([6, 1.5, -20.5], s.clock.nowMs, 20);
        seen.push(
          Math.abs(turnDeg(selectAlignmentMatrix(s.arStore.getState())!)),
        );
      }
      return Math.max(...seen);
    }

    it("a second AR entry shows on its first voted lock, and its rotation holds against a 20 deg biased compass", async () => {
      const s = await firstEntryShown();
      reEnterAr(s);
      expect(selectZeroReference(s.arStore.getState())).not.toBeNull();
      expect(hungUnder(s.label)).not.toBe(s.scene);
      s.clock.nowMs = T0 + 60_000;
      await oneLock(s);
      expect(hungUnder(s.label)).toBe(s.scene);
      expect(biasedFixes(s, T0 + 60_000)).toBeLessThan(1);
    }, 60_000);

    it("a tour opened inside the entry shows on its first voted lock, and its rotation holds against a 20 deg biased compass", async () => {
      const s = await firstEntryShown();
      switchTour(s);
      s.clock.nowMs = T0 + 60_000;
      await oneLock(s);
      expect(hungUnder(s.label)).toBe(s.scene);
      expect(biasedFixes(s, T0 + 60_000)).toBeLessThan(1);
    }, 60_000);
  });
});

// Why (the owner's bug, 2026-10-15; GpsPlusSlamJs_Docs/docs/
// 2026-10-15-0511-code-rotation-overwritten-by-compass-investigation.md):
// once a printed code has placed the tour, its rotation must stand - the
// first device fix that carries a compass reading must not replace it. The
// core's cold-start compass override gives the compass full weight until its
// yaw window holds 9 solves, and a voted lock is ONE solve (one batch), so a
// code with fewer than 9 locks lost its rotation to the compass at the first
// reading, in one solve (the previous applied bearing is null, so the
// compass bearing is taken verbatim). Through the real store path: the zero
// from the code (or a fix), the controller's votes, the page's device-fix
// path with the keep-alive's ring. The compass here reads 20 deg off (plus
// the local declination, about 3 deg, which the test's reading ignores).
describe("a code's rotation is not overwritten by the first compass reading (the owner's bug, r863)", () => {
  const STAND: NumTriple = [6, 1.5, -20.5];
  const turnNow = (s: Awaited<ReturnType<typeof visitorSession>>): number =>
    Math.abs(turnDeg(selectAlignmentMatrix(s.arStore.getState())!));

  it("one voted lock, then device fixes whose compass reads 20 deg off: the tour stays within 1 deg of the code's rotation", async () => {
    const s = await visitorSession(8, false);
    s.clock.nowMs = T0 + 500;
    expect(await firstVotedLock(s)).toBe(1);
    // The votes alone: exact by construction.
    expect(turnNow(s)).toBeLessThan(0.1);
    // The first fix carries no reading (the watch starts at it), the next
    // ones do; 10 s of fixes, checked after every one.
    const worst: number[] = [];
    for (let i = 1; i <= 10; i += 1) {
      s.clock.nowMs = T0 + 500 + i * 1000;
      s.fix(STAND, s.clock.nowMs, i === 1 ? undefined : 20);
      worst.push(turnNow(s));
    }
    expect(Math.max(...worst)).toBeLessThan(1);
  }, 60_000);

  it("a 3-lock glance whose first fix (compass 20 deg off) comes 11.5 s later: the tour, shown on the first lock, stays within 1 deg of the code's rotation", async () => {
    const s = await visitorSession(8, false);
    s.clock.nowMs = T0 + 500;
    expect(await firstVotedLock(s)).toBe(1);
    await flush();
    expect(hungUnder(s.label)).toBe(s.scene);
    await s.frame();
    await s.frame();
    expect(s.syntheticVotes()).toBe(3 * VIEWER_VOTE_COUNT);
    // The visitor looks away; the phone's first fix is slow, and arrives
    // with a reading 11.5 s after the scan.
    s.clock.nowMs = T0 + 12_000;
    s.fix(STAND, s.clock.nowMs, 20);
    // No page timer was armed for the placement.
    expect(s.fireAllTimers()).toBe(0);
    const seen = [turnNow(s)];
    for (let i = 1; i <= 10; i += 1) {
      s.clock.nowMs = T0 + 12_000 + i * 1000;
      s.fix(STAND, s.clock.nowMs, 20);
      seen.push(turnNow(s));
    }
    expect(Math.max(...seen)).toBeLessThan(1);
  }, 60_000);

  // The fix-first order keeps one residue, by decision (r863 milestone
  // review #1): the bearing the compass applied BEFORE the scan eases out
  // at the core's snap alpha 0.15, compounded over the lock's 16 votes
  // (D18), so the first lock still shows 0.85^16 (about 7.4 %) of it and
  // the second lock clears it. Snap alpha 1 removed it and was dropped: it
  // published every later GPS-only yaw unsmoothed, 2-4 times the per-fix
  // heading steps for the rest of the entry (`CODE_YAW_PROBE=handback`).
  it("a fix first (compass 20 deg off), then the scan: the first voted lock keeps 7.4 % of the compass's turn, the second lock clears it", async () => {
    const s = await visitorSession(8);
    s.clock.nowMs = T0 + 1000;
    s.fix(STAND, s.clock.nowMs, 20);
    // GPS alone, one fix: the normal cold start, the compass leads.
    const compassTurn = turnNow(s);
    expect(compassTurn).toBeGreaterThan(15);
    s.clock.nowMs = T0 + 1500;
    expect(await firstVotedLock(s)).toBe(1);
    await flush();
    // No wait arms after a device fix: the content shows on this lock.
    expect(hungUnder(s.label)).toBe(s.scene);
    expect(turnNow(s)).toBeCloseTo(0.85 ** VIEWER_VOTE_COUNT * compassTurn, 1);
    await s.frame();
    expect(s.syntheticVotes()).toBe(2 * VIEWER_VOTE_COUNT);
    expect(turnNow(s)).toBeLessThan(0.5);
  }, 60_000);

  // Why: the fix must not touch the GPS-only cold start (the owner's model:
  // with GPS alone, the normal cold start applies - 9 solves AND about 15 m
  // of walking before the compass hands over). Green before and after the
  // fix: an entry that never votes keeps the core's own settings.
  it("without a code, the compass still leads the GPS-only cold start", async () => {
    const s = await visitorSession(8);
    for (let i = 1; i <= 5; i += 1) {
      s.clock.nowMs = T0 + i * 1000;
      s.fix(STAND, s.clock.nowMs, 20);
    }
    expect(turnNow(s)).toBeGreaterThan(15);
    expect(s.arStore.getState().gpsData?.alignmentOverrides ?? null).toBeNull();
  }, 60_000);
});
