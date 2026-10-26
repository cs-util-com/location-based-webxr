/**
 * A creator indoors, placed by a code the tour already stores: the code's
 * votes line the session up as they do for a visitor, the placement opens
 * on them, and the visit's objects settle at their relation to that code.
 * Composed through the real creator setup, the real viewer placement (whose
 * vote pieces the creator reuses), the real store with its GPS solve, and
 * the real fused pose fed with detections. Only the device is stood in: the
 * tracking controller (its config is captured and each frame replayed in
 * its documented order), the reticle and the camera.
 *
 * Why these tests matter: before this, a creator without a GPS fix could
 * not place anything, even standing at a code whose position the tour
 * already stores - and once the code's votes reached the store, they would
 * have counted as GPS fixes, so every code minted afterwards would carry
 * "fixes at 5 m" its creator never had. Each test below fails without the
 * creator's vote path, or with votes counted as fixes.
 */
import fc from "fast-check";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  type Pose,
} from "gps-plus-slam-app-framework/ar/qr";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
  webxrToNUE,
} from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { objectPoseNue } from "./content-placement.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { ObjectListHandlers } from "./object-list.js";
import { SCAN_GATE_ESCAPE_MS } from "./scan-gate.js";
import { writeSideM } from "./printed-side.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";
import { createViewerPlacement } from "./viewer-placement.js";
import type * as VisitLogModule from "./visit-log.js";
import type { VisitLog } from "./visit-log.js";

const captured = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
  /** The page-side visit logs the creator setups made, newest last. */
  visitLogs: [] as VisitLog[],
}));
vi.mock("./visit-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof VisitLogModule>();
  return {
    ...actual,
    createVisitLog: () => {
      const log = actual.createVisitLog();
      captured.visitLogs.push(log);
      return log;
    },
  };
});
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

// The geo maths the fixtures mint codes with is licensed, and building a
// store activates it: before any fixture runs.
beforeAll(() => {
  createTourViewerStore();
});

// Each visit drives the page clock and `Date.now()` together (below).
afterEach(() => {
  vi.useRealTimers();
});

/** A whole visit through the real solve and fused pose: about 1 s idle,
 *  several at 100 % CPU with other suites running. */
const SLOW_MS = 60_000;

const SIZE_M = 0.16;
/** The local tangent-plane origin the stored code was minted around. */
const ZERO = { lat: 47.5, lon: 8.7 };
const K = { fx: 820, fy: 820, cx: 512, cy: 384 };
const TEXT = "https://gps.csutil.com/tour/?qr=indoor";
const OTHER = "https://gps.csutil.com/tour/?qr=indoor-new";
const T0 = 1_790_000_000_000;

function yawQ(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** A yaw-only rigid alignment (odometry-NUE to world-NUE). */
function yawAlignment(deg: number, t: [number, number, number]): number[] {
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(...yawQ(deg)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

/** The printed code's pose in this visit's raw WebXR odometry, before the
 *  visit's own origin (`origin`) moves it. */
const TRUE_CODE: Pose = { position: [0, 0, 0], rotation: yawQ(6) };

function inOrigin(pose: Pose, origin: Matrix4): Pose {
  const m = new Matrix4()
    .compose(
      new Vector3(...pose.position),
      new Quaternion(...pose.rotation),
      new Vector3(1, 1, 1),
    )
    .premultiply(origin);
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/** The i-th detection of a code at `TRUE_CODE`, from a camera stepping
 *  sideways (stable after about seven), in a visit whose odometry origin
 *  is `origin`. */
function detection(
  i: number,
  origin: Matrix4,
  text: string,
  startMs: number,
): QrDetectionEvent {
  const dx = -0.3 + 0.1 * i;
  const corners = buildObjectPoints(SIZE_M).map((p) => {
    const w = rotateVectorByQuaternion(TRUE_CODE.rotation, p);
    return projectViewPoint([w[0] - dx, w[1], w[2] - 1.2], K)!;
  });
  const raw: Pose = {
    position: [0, 0, 0],
    rotation: yawQ(6 + ((i % 3) - 1) * 6),
  };
  return {
    text,
    timestamp: startMs + i * 125,
    corners,
    cameraPose: inOrigin(
      { position: [dx, 0, 1.2], rotation: [0, 0, 0, 1] },
      origin,
    ),
    intrinsics: K,
    imageWidth: 1024,
    imageHeight: 768,
    qrPoseWorld: inOrigin(raw, origin),
    qrPoseInCamera: raw,
    reprojectionErrorPx: 0.5,
  };
}

const DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpGeneric",
  "replaceHelpDrive",
  "replaceDriveCopy",
  "uploadAsk",
  "uploadAskText",
  "uploadYes",
  "uploadNo",
  "sizeInput",
  "printPanel",
  "status",
  "finishButton",
  "finishStatus",
  "downloadButton",
  "pinButton",
  "pinLabel",
  "pinSave",
  "pinCancel",
  "photoButton",
  "draftOffer",
  "draftOfferText",
  "draftRestore",
  "draftDismiss",
  "draftDiscard",
  "sizeOffer",
  "sizeOfferText",
  "sizeOfferUse",
  "sizeOfferKeep",
  "objectList",
  "keepScanRow",
  "keepScanInput",
  "debugSave",
  "debugSaveText",
  "debugSaveButton",
  "debugSaveStatus",
] as const;

function el() {
  const handlers = new Map<string, (event?: unknown) => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    dataset: {} as Record<string, string>,
    setAttribute: () => undefined,
    focus: () => undefined,
    addEventListener: (type: string, handler: (event?: unknown) => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    bind: (_bound: ObjectListHandlers) => undefined,
    render: () => undefined,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** A code stored with the tour: its geo is where `alignment` puts its pose
 *  in this visit, i.e. `alignment` is the truth the visit should find;
 *  `stamp`: the walk and accuracy it was measured with (none: unstamped). */
function storedCode(
  alignment: number[],
  origin: Matrix4,
  stamp?: { extentM: number; accuracyM: number },
): QrLevel {
  const world = throughAlignment(
    odomNueFromWebXr(inOrigin(TRUE_CODE, origin)),
    alignment,
  )!;
  return {
    version: 1,
    qr: {
      physicalSizeM: SIZE_M,
      geo: mintQrGeoPose({
        worldNuePosition: {
          x: world.position[0],
          y: world.position[1],
          z: world.position[2],
        },
        worldNueRotation: [...world.rotation],
        zero: ZERO,
      }),
      ...(stamp === undefined
        ? {}
        : {
            mintQuality: {
              mintedAtIso: "2026-10-01T10:00:00.000Z",
              alignmentSampleCount: 40,
              gpsAccuracyM: stamp.accuracyM,
              alignmentGpsExtentM: stamp.extentM,
            },
          }),
    },
  };
}

/**
 * A creator in a running AR session with location allowed and no fix yet,
 * the tour storing `level` for {@link TEXT}: the creator setup and the viewer
 * placement wired as `main.ts` wires them, over the real store.
 */
async function indoorCreator(
  level: QrLevel,
  /** Where the tour keeps it: the hosted zip, or only this device's code
   *  book (a draft never uploaded). */
  kept: "hosted" | "draft" = "hosted",
  /** The visit's wait for a first GPS fix ran out (indoors): its clock is
   *  fired right after the visit begins. False: the clock is the test's to
   *  fire (`graceEnds`). */
  graceElapsed = true,
) {
  captured.configs.length = 0;
  const arStore = createTourViewerStore();
  /** The settle records the visit logs (`tourAuthoring/settled`). */
  const settled: {
    basis: string;
    objects: { basis?: string }[];
    codePositions?: {
      levelId: string;
      decision: { kind: string; reason?: string; walkMoreM?: number };
      applied: boolean;
      offsetM?: number;
      candidate?: { extentM: number | null; accuracyM: number | null };
    }[];
  }[] = [];
  /** When each measurement of a code was taken (`tourAuthoring/codeMeasured`). */
  const measuredAt: number[] = [];
  const dispatch = arStore.dispatch;
  arStore.dispatch = ((action: { type: string; payload?: unknown }) => {
    if (action.type === "tourAuthoring/settled") {
      settled.push(action.payload as (typeof settled)[number]);
    }
    if (action.type === "tourAuthoring/codeMeasured") {
      measuredAt.push((action.payload as { atMs: number }).atMs);
    }
    return dispatch(action as never);
  }) as typeof arStore.dispatch;
  const ctx = createTourViewerSession(arStore);
  const hooks = createUnwiredHooks();
  const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
    (typeof DOM_KEYS)[number],
    ReturnType<typeof el>
  >;
  const scene = new Group();
  const world = new Group();
  world.matrixAutoUpdate = false;
  scene.add(world);
  // The AR runtime glues the world group to the alignment.
  const followAlignment = (): void => {
    const alignment = selectAlignmentMatrix(arStore.getState());
    if (alignment === null) return;
    world.matrix.fromArray([...alignment]);
    scene.updateMatrixWorld(true);
  };
  arStore.subscribe(followAlignment);
  const reticleLocal = new Vector3(2, 0, -1);
  ctx.reticle = {
    isVisible: () => true,
    getWorldPosition: (v: Vector3) =>
      v.copy(reticleLocal).applyMatrix4(world.matrixWorld),
    dispose: () => undefined,
  };
  /** The page clock. `Date.now()` follows it (only `Date` is faked): the
   *  settle stamps sightings with `Date.now()` and the device fixes carry
   *  this clock, so the two must be one clock, as on a phone. */
  const clock = { nowMs: T0 };
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  function setClock(ms: number): void {
    clock.nowMs = ms;
    vi.setSystemTime(ms);
  }
  /** The page's timers (`seams.schedule`): fired by the test. */
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const seams = {
    schedule: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    pickObjectInView: () => null,
    canShareZip: () => false,
    downloadZip: () => Promise.resolve(true),
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => scene,
    estimateQrPrintSize: () => null,
    getArWorldGroup: () => world,
    createLabel: (text: string) => {
      const object = new Object3D();
      object.name = text;
      return { object, dispose: () => undefined };
    },
    encodeFrameJpeg: () =>
      Promise.resolve({ blob: new Blob([]), width: 4, height: 3 }),
  } as unknown as TourViewerSeams;
  const arController = {
    getState: () => ({ status: "running" }),
    disable: () => Promise.resolve(),
  } as never;
  const viewer = createViewerPlacement({
    ctx,
    mode: "creator",
    arStore,
    arController,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton: {
      hidden: true,
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement,
    hooks,
    now: () => clock.nowMs,
  });
  hooks.storedCodeVotes = viewer.storedCodeVotes;
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore,
    arController,
    seams,
    wizard: { openStep: () => undefined, revealStep: () => undefined } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => Promise.resolve(undefined),
    codeVotes: (options) => hooks.storedCodeVotes(options),
  });
  hooks.renderAuthorReadout = setup.renderAuthorReadout;
  writeSideM(dom.sizeInput, SIZE_M);
  const levelId = await qrCodeId(TEXT);
  if (kept === "hosted") {
    // As the tour's open sets them (`archive-open.ts`): the parsed levels
    // and their texts.
    ctx.currentLevels = new Map([[levelId, level]]);
    ctx.currentLevelTexts = new Map([[levelId, JSON.stringify(level)]]);
    // And the opened zip itself, which a measurement of a stored code
    // reads the stored level from (`hostedLevelJson`).
    ctx.session = {
      archive: { url: "https://example.test/tour.zip", size: 2048 },
      hostedFileName: () => null,
      entries: [{ filename: "tour.json" }, { filename: `qr/${levelId}.json` }],
      loadEntryText: () => Promise.resolve(JSON.stringify(level)),
    } as never;
  } else {
    // As a restored draft hands them over (`creator-draft.ts`).
    setup.codes.restoreLevels([{ id: levelId, json: JSON.stringify(level) }]);
  }
  expect(setup.startAuthorPipeline()).toBe(true);
  setup.beginAuthorVisit();
  /** The visit's timers run out (the GPS wait among them). */
  function graceEnds(): void {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
  }
  if (graceElapsed) graceEnds();

  /** The levels the controller fetched, per text (it fetches once). */
  const fetched = new Map<string, QrLevel>();
  /** One locked frame, in the controller's order: the level (fetched once
   *  per text), the detection, the stable pose and the frame's votes when
   *  the level carries geo, then the lock. */
  async function frame(
    i: number,
    origin: Matrix4,
    text: string,
    startMs: number,
  ): Promise<void> {
    const c = captured.configs.at(-1)!;
    let level = fetched.get(text);
    if (level === undefined) {
      level = await c.fetchLevel(text);
      fetched.set(text, level);
    }
    const event = detection(i, origin, text, startMs);
    // One clock for the page and the detections: the keep-alive holds a
    // code's votes for a while after its last lock, timed on this clock.
    setClock(event.timestamp);
    c.onDetection?.(event);
    const geo = level.qr.geo;
    if (geo !== undefined) {
      const pose = c.resolveStablePose
        ? c.resolveStablePose(text)
        : event.qrPoseWorld;
      if (pose !== null) {
        c.dispatchVotes(
          buildQrGpsVotes({
            qrPoseWorld: pose,
            sizeM: level.qr.physicalSizeM!,
            qrGeo: geo,
            syntheticAccuracyM: c.syntheticAccuracyM,
            ...(c.voteBaselineM !== undefined
              ? { baselineM: c.voteBaselineM }
              : {}),
            ...(c.voteCount !== undefined ? { count: c.voteCount } : {}),
            timestamp: event.timestamp,
          }),
        );
      }
    }
    c.onLocked?.({} as never, level);
    await flush();
  }

  /** Look at a code for `n` frames (stable from about the seventh),
   *  starting `afterMs` after the page clock. */
  async function look(
    origin: Matrix4,
    n = 12,
    text = TEXT,
    afterMs = 500,
  ): Promise<void> {
    const startMs = clock.nowMs + afterMs;
    for (let i = 0; i < n; i += 1) await frame(i, origin, text, startMs);
    // The level id is an async hash: the sighting waits for it.
    await qrCodeId(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  }

  /** One device fix where `truth` puts the phone at raw WebXR `at`, off by
   *  `offsetNorthM` and `offsetEastM`, recorded against the odometry
   *  position `odomAt` (where a drifting tracking thinks the phone is),
   *  through the page's device-fix path (`main.ts` hands the coordinator's
   *  `recordFix` to the viewer placement). */
  let fixes = 0;
  function deviceFix(
    truth: number[],
    at: [number, number, number],
    accuracyM: number,
    offsetNorthM = 0,
    offsetEastM = 0,
    odomAt: [number, number, number] = at,
  ): void {
    const nue = webxrToNUE([...at]);
    const worldPose = throughAlignment(
      { position: [nue[0], nue[1], nue[2]], rotation: [0, 0, 0, 1] },
      truth,
    )!;
    const geo = mintQrGeoPose({
      worldNuePosition: {
        x: worldPose.position[0] + offsetNorthM,
        y: worldPose.position[1],
        z: worldPose.position[2] + offsetEastM,
      },
      worldNueRotation: [0, 0, 0, 1],
      zero: ZERO,
    });
    // The coordinator sets a zero only when the session has none.
    if (selectZeroReference(arStore.getState()) === null) {
      arStore.dispatch(setZeroPos({ lat: geo.lat, lon: geo.lon }));
    }
    fixes += 1;
    setClock(clock.nowMs + 1000);
    const payload: RecordGpsEventPayload = {
      odomPosition: odomAt,
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `fix-${String(fixes)}`,
        latitude: geo.lat,
        longitude: geo.lon,
        altitude: geo.alt,
        latLongAccuracy: accuracyM,
        timestamp: clock.nowMs,
      },
    };
    viewer.recordDeviceFix(payload);
    setup.renderAuthorReadout();
  }

  /** Place a pin at `local` (odometry-NUE). */
  async function placePin(
    label: string,
    local: [number, number, number],
  ): Promise<void> {
    reticleLocal.set(...local);
    setup.renderAuthorReadout();
    dom.pinLabel.value = label;
    dom.pinSave.click();
    await flush();
  }

  /** Where a settled object stands, world-NUE around {@link ZERO}. */
  function settledAt(label: string): Vector3 {
    const entry = ctx.tourDocument
      .entries()
      .find((e) => e.object.kind === "pin" && e.object.label === label);
    expect(entry, `no object ${label}`).toBeDefined();
    return new Vector3(...objectPoseNue(entry!.object.geo, ZERO).positionNue);
  }

  return {
    arStore,
    ctx,
    dom,
    setup,
    hooks,
    levelId,
    timers,
    graceEnds,
    configs: captured.configs,
    look,
    deviceFix,
    placePin,
    settledAt,
    settled,
    measuredAt,
    /** The page clock now. */
    nowMs: () => clock.nowMs,
    endVisit: () => {
      setup.endAuthorVisit();
    },
    /** Time passes with no fix (a walk indoors). */
    advance: (ms: number) => {
      setClock(clock.nowMs + ms);
    },
    /** This setup's page-side visit log. */
    visitLog: captured.visitLogs.at(-1)!,
    votes: () =>
      selectGpsPositions(arStore.getState()).filter(
        (p) => gpsPointSourceOf(p) === GPS_POINT_SOURCE_SYNTHETIC_QR,
      ).length,
  };
}

/** Where the truth puts an odometry-NUE point, world-NUE around ZERO. */
function truthAt(
  truth: number[],
  local: readonly [number, number, number],
): Vector3 {
  return new Vector3(
    ...throughAlignment(
      { position: [...local], rotation: [0, 0, 0, 1] },
      truth,
    )!.position,
  );
}

describe(
  "a creator with no GPS fix, at a code the tour stores",
  { timeout: SLOW_MS },
  () => {
    const origin = new Matrix4().makeRotationY(0.4).setPosition(3, 0, -2);
    const truth = yawAlignment(25, [12, 400, -7]);

    it("opens the placement on the code's votes, and keeps it closed without them", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      // No fix and no code: nothing lines the session up.
      c.setup.renderAuthorReadout();
      expect(c.dom.pinButton.disabled).toBe(true);
      // Seen too briefly for a stable pose: no vote, still closed.
      await c.look(origin, 4);
      expect(c.votes()).toBe(0);
      expect(c.dom.pinButton.disabled).toBe(true);
      // Held until stable: the code's votes land and the placement opens.
      await c.look(origin, 12, TEXT, 2_000);
      expect(c.votes()).toBeGreaterThan(0);
      expect(c.ctx.viewerVotedLocks).toBeGreaterThan(0);
      expect(c.dom.pinButton.disabled).toBe(false);
    });

    it("votes with a code only this device's code book stores (a draft never uploaded)", async () => {
      const c = await indoorCreator(storedCode(truth, origin), "draft");
      await c.look(origin);
      expect(c.votes()).toBeGreaterThan(0);
      expect(c.dom.pinButton.disabled).toBe(false);
      await c.placePin("Draft", [1, 0, -3]);
      c.endVisit();
      await flush();
      expect(
        c.settledAt("Draft").distanceTo(truthAt(truth, [1, 0, -3])),
      ).toBeLessThan(0.01);
    });

    it("casts no vote once a device fix came first: a visit with GPS places by GPS", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      c.deviceFix(truth, [0, 1.4, 0], 5);
      await c.look(origin);
      expect(c.votes()).toBe(0);
      // One fix is not an alignment: the placement waits for three.
      expect(c.dom.pinButton.disabled).toBe(true);
    });

    it("counts none of the votes as GPS fixes: no fix, no accuracy, and no new code is minted", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      await c.look(origin);
      expect(c.votes()).toBeGreaterThan(0);
      // A code the tour does not store yet, seen stable in the same visit:
      // minting it needs GPS fixes, and the votes are none.
      const measured = () =>
        c.ctx.tourDocument.entries().length +
        c.setup.codes.ids().filter((id) => c.setup.codes.measuredIn(id, 0))
          .length;
      const before = measured();
      await c.look(
        new Matrix4().makeTranslation(4, 0, 0).multiply(origin),
        12,
        OTHER,
        10_000,
      );
      expect(measured()).toBe(before);
      expect(c.dom.status.textContent).toMatch(/0 of 3 fixes|GPS/);
    });

    it("settles a pin placed with votes alone at its relation to the stored code (property)", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -40, max: 40, noNaN: true }),
          fc.double({ min: -40, max: 40, noNaN: true }),
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.tuple(
            fc.double({ min: -15, max: 15, noNaN: true }),
            fc.double({ min: -1, max: 2, noNaN: true }),
            fc.double({ min: -15, max: 15, noNaN: true }),
          ),
          async (yawDeg, north, east, turn, pin) => {
            const visitOrigin = new Matrix4()
              .makeRotationY(turn)
              .setPosition(north / 10, 0, east / 10);
            const visitTruth = yawAlignment(yawDeg, [north, 400, east]);
            const c = await indoorCreator(storedCode(visitTruth, visitOrigin));
            await c.look(visitOrigin);
            await c.placePin("Here", pin);
            c.endVisit();
            await flush();
            expect(
              c.settledAt("Here").distanceTo(truthAt(visitTruth, pin)),
            ).toBeLessThan(0.01);
          },
        ),
        { numRuns: 12 },
      );
    });
  },
);

// Why: a creator whose location is refused starts AR only when the tour
// stores a code that can line the visit up (`ar-entry.ts` asks this): its
// stored geo AND its stored printed size, hosted or only in this device's
// code book. Without one the start must ask for location as before.
describe("whether the tour stores a code a creator can start on", () => {
  const origin = new Matrix4();
  const truth = yawAlignment(0, [0, 400, 0]);

  it.each(["hosted", "draft"] as const)(
    "says yes for a %s code with its geo and size",
    async (kept) => {
      const c = await indoorCreator(storedCode(truth, origin), kept);
      expect(c.setup.creatorCanStartOnCodes()).toBe(true);
    },
  );

  it("says no for a code stored without a geo, or without a printed size", async () => {
    const level = storedCode(truth, origin);
    const noGeo = await indoorCreator({
      version: 1,
      qr: { physicalSizeM: SIZE_M },
    });
    expect(noGeo.setup.creatorCanStartOnCodes()).toBe(false);
    const noSize = await indoorCreator({
      version: 1,
      qr: { geo: level.qr.geo! },
    });
    expect(noSize.setup.creatorCanStartOnCodes()).toBe(false);
  });
});

describe(
  "a creator whose GPS arrives after the code placed the visit",
  { timeout: SLOW_MS },
  () => {
    const origin = new Matrix4().makeRotationY(-0.7).setPosition(-2, 0, 4);
    const truth = yawAlignment(-60, [-30, 400, 18]);

    /** Ten device fixes on a walk of about 22 m from the code, where
     *  `truth` puts each, off by `offsetNorthM`, at accuracy 5 m. */
    function walkWithGps(
      c: Awaited<ReturnType<typeof indoorCreator>>,
      offsetNorthM: number,
    ): void {
      for (let i = 1; i <= 10; i += 1) {
        c.deviceFix(truth, [i * 2, 1.4, -i], 5, offsetNorthM);
      }
    }

    // The settle ties an object to the code it was placed near when the
    // walk since that code is short (40 m), so the GPS that came later -
    // even a few metres off - neither moves it nor needs to agree.
    it.each([0, 4, 8])(
      "settles a pin placed on the votes at its relation to the code, with GPS off by %d m after it",
      async (offsetNorthM) => {
        const c = await indoorCreator(storedCode(truth, origin));
        await c.look(origin);
        expect(c.votes()).toBeGreaterThan(0);
        await c.placePin("Near", [3, 0, -2]);
        walkWithGps(c, offsetNorthM);
        c.endVisit();
        await flush();
        expect(
          c.settledAt("Near").distanceTo(truthAt(truth, [3, 0, -2])),
        ).toBeLessThan(0.01);
        // Through the code, not through the GPS that came after it.
        expect(c.settled.at(-1)?.objects[0]?.basis).toBe("code-corrected");
      },
    );

    // Why: on a phone the code's votes are re-cast with every device fix
    // while the keep-alive holds, so a mixed visit carries far more votes
    // than the locks alone. A harness whose detections ran on another clock
    // than the fixes never reached that path, and every mixed visit here
    // tested a visit with a fraction of a phone's votes.
    it("re-casts the code's votes with each device fix while the keep-alive holds", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      await c.look(origin);
      const afterLook = c.votes();
      expect(afterLook).toBeGreaterThan(0);
      walkWithGps(c, 0);
      expect(c.votes()).toBeGreaterThanOrEqual(afterLook + 10 * 16);
    });

    // Why: a stored code's votes line the visit up, but a NEW code is
    // measured by GPS - its position is what later visits and visitors
    // rely on - so the mint gate's three fixes are device fixes, however
    // many votes the alignment holds.
    it("still needs three device fixes to measure a new code", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      await c.look(origin);
      const otherId = await qrCodeId(OTHER);
      const atOther = new Matrix4().makeTranslation(5, 0, 0).multiply(origin);
      c.deviceFix(truth, [2, 1.4, -1], 5);
      c.deviceFix(truth, [4, 1.4, -2], 5);
      await c.look(atOther, 12, OTHER, 20_000);
      expect(c.votes()).toBeGreaterThan(2 * 16);
      expect(c.setup.codes.measuredIn(otherId, 0)).toBe(false);
      c.deviceFix(truth, [6, 1.4, -3], 5);
      await c.look(atOther, 12, OTHER, 2_000);
      await vi.waitFor(() => {
        expect(c.setup.codes.measuredIn(otherId, 0)).toBe(true);
      });
    });

    it("mints a new code with its device fixes only: their count and accuracy, none of the votes", async () => {
      const c = await indoorCreator(storedCode(truth, origin));
      await c.look(origin);
      walkWithGps(c, 0);
      await c.look(
        new Matrix4().makeTranslation(5, 0, 0).multiply(origin),
        12,
        OTHER,
        20_000,
      );
      await vi.waitFor(() => {
        expect(c.setup.codes.inHand()).not.toBeNull();
      });
      const minted = JSON.parse(c.setup.codes.inHand()!.json) as {
        qr: {
          mintQuality: { alignmentSampleCount: number; gpsAccuracyM?: number };
        };
      };
      expect(minted.qr.mintQuality.alignmentSampleCount).toBe(10);
      expect(minted.qr.mintQuality.gpsAccuracyM).toBe(5);
    });
  },
);

// Why: an outdoor creator often points at the code within seconds of
// entering AR, before the phone's first GPS fix. Lined up by the code's
// votes, that visit could never improve the code's stored position, so a
// visit waits for a first fix before it votes - the same clock the
// visitor's GPS escape waits on. A codes-only entry (no location at all)
// votes at once; a fix inside the wait makes it a GPS visit.
describe(
  "which creator visits a stored code lines up",
  { timeout: SLOW_MS },
  () => {
    const origin = new Matrix4().makeRotationY(0.2).setPosition(1, 0, -1);
    const truth = yawAlignment(15, [8, 400, -4]);

    it("waits for a first fix before voting, for as long as the visitor's GPS escape waits", async () => {
      const c = await indoorCreator(storedCode(truth, origin), "hosted", false);
      expect(c.timers.map((t) => t.ms)).toContain(SCAN_GATE_ESCAPE_MS);
      await c.look(origin);
      expect(c.votes()).toBe(0);
      // Placement waits too: nothing lines the visit up yet.
      expect(c.dom.pinButton.disabled).toBe(true);
      expect(c.dom.status.textContent).toMatch(/waiting for GPS alignment/);
      // No fix came: the code lines the visit up.
      c.graceEnds();
      await c.look(origin, 12, TEXT, 10_000);
      expect(c.votes()).toBeGreaterThan(0);
      expect(c.dom.pinButton.disabled).toBe(false);
    });

    it.each([1, 3, 9])(
      "makes a visit whose first fix came %d s in a GPS visit, code seen first or not",
      async (fixAfterS) => {
        const c = await indoorCreator(
          storedCode(truth, origin),
          "hosted",
          false,
        );
        await c.look(origin);
        c.ctx.lastDetectedText = TEXT;
        // The fix lands inside the wait (its clock is the page's timer,
        // which has not fired): the visit is a GPS visit. It comes
        // `fixAfterS` after the look (`deviceFix` adds the last second).
        expect(fixAfterS * 1000).toBeLessThan(SCAN_GATE_ESCAPE_MS);
        c.advance(fixAfterS * 1000 - 1000);
        c.deviceFix(truth, [0, 1.4, 0], 5);
        await c.look(origin, 12, TEXT, 4_000);
        c.graceEnds();
        await c.look(origin, 12, TEXT, 12_000);
        expect(c.votes()).toBe(0);
      },
    );

    it("votes at once in a visit started without location", async () => {
      const c = await indoorCreator(storedCode(truth, origin), "hosted", false);
      c.ctx.codesOnly = true;
      await c.look(origin);
      expect(c.votes()).toBeGreaterThan(0);
    });
  },
);

// Why: a print-size adopted in a visit is the size its code is solved at
// from then on. A stored code's votes use the stored size (its stored pose
// was measured at it) - but only in a visit the code lines up; in a GPS
// visit the code is measured like any other, at the adopted size.
describe("an adopted print size at a stored code", { timeout: SLOW_MS }, () => {
  const origin = new Matrix4();
  const truth = yawAlignment(0, [0, 400, 0]);

  it("is the size a GPS visit solves the code at", async () => {
    const c = await indoorCreator(storedCode(truth, origin), "hosted", false);
    c.deviceFix(truth, [0, 1.4, 0], 5);
    await c.look(origin);
    const adopted = 0.2;
    c.ctx.printSizeCheck = {
      offer: () => ({ text: TEXT, sizeM: adopted }),
      answer: () => undefined,
      onDetection: () => undefined,
      pending: () => false,
    } as never;
    const before = c.configs.length;
    c.dom.sizeOfferUse.click();
    await flush();
    expect(c.configs.length).toBe(before + 1);
    const level = await c.configs.at(-1)!.fetchLevel(TEXT);
    expect(level.qr.physicalSizeM).toBe(adopted);
  });
});

// Why: a stored code the moved-code check ignores no longer lines the visit
// up - its votes are withdrawn and placing waits for GPS again. A visitor
// is told so; a creator whose pin button just went grey must be told too,
// or the visit simply looks stuck.
describe("a stored code ignored as moved", { timeout: SLOW_MS }, () => {
  const origin = new Matrix4();
  const truth = yawAlignment(0, [0, 400, 0]);

  it("tells the creator why placing waits for GPS again", async () => {
    const c = await indoorCreator(storedCode(truth, origin));
    await c.look(origin);
    expect(c.votes()).toBeGreaterThan(0);
    expect(c.dom.status.textContent).not.toMatch(/moved/);
    c.ctx.ignoredCodes.set(c.levelId, { text: TEXT, vetoSpreadM: 30 });
    // Its next lock is an ignored lock (the pipeline routes it so).
    await c.look(origin, 2, TEXT, 30_000);
    expect(c.ctx.viewerIgnoredText).toBe(TEXT);
    expect(c.dom.status.textContent).toMatch(
      /^This code seems to have been moved, so its position is not used\. Placing goes by GPS\./,
    );
  });
});

// ---------------------------------------------------------------------------
// A visit lined up by the stored code that later walks with GPS
// ---------------------------------------------------------------------------

/** A deterministic random stream (mulberry32) for the walks below. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw. */
function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Horizontal [north, east] of a geo around ZERO. */
function northEast(geo: Parameters<typeof objectPoseNue>[0]): [number, number] {
  const p = objectPoseNue(geo, ZERO).positionNue;
  return [p[0], p[2]];
}

const distM = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** One mixed visit's walk and GPS, as the sweep varies them. */
interface MixedVisitCase {
  /** The outdoor loop's diagonal (m); 0: no fix at all, indoors only. */
  readonly walkM: number;
  /** The fixes' reported accuracy (m). */
  readonly accuracyM: number;
  /** How far the stored code is from the truth (m), in a random
   *  direction. */
  readonly storedErrorM: number;
  /** The tracking's drift, in % of the distance walked. */
  readonly driftPct?: number;
  /** GPS noise: AR(1) per axis with a 60 s time constant and a 68 %
   *  radius of about the accuracy; false: exact fixes. */
  readonly noise?: boolean;
  readonly seed?: number;
  readonly kept?: "hosted" | "draft";
  /** A pin placed right after the first look, and one at the loop's far
   *  corner (beyond the reach of either look in walked distance). */
  readonly pins?: boolean;
  /** A new code is measured after the end look, 5 m to the side. */
  readonly newCode?: boolean;
  /** Fixes keep coming on the way back in and after the end look, as a
   *  phone coming inside reports them. */
  readonly fixesIndoors?: boolean;
  /** Each fix jumps this far east and west in turn (m): the fixes a phone
   *  reports near a door. */
  readonly jumpM?: number;
  /** The stored code's stamp: the walk and accuracy it was measured with. */
  readonly stamp?: { extentM: number; accuracyM: number };
}

const MIX_ORIGIN = new Matrix4().makeRotationY(0.4).setPosition(3, 0, -2);
const MIX_TRUTH = yawAlignment(25, [12, 400, -7]);
/** The indoor legs out to the street and back (m, and s at 1 m/s). */
const DOOR_M = 10;

/** A point of the room (code at x = z = 0, the phone in front of it on +z)
 *  in raw WebXR through `origin`, at eye height. */
function roomToRaw(
  origin: Matrix4,
  x: number,
  z: number,
): [number, number, number] {
  const v = new Vector3(x, 1.4, z).applyMatrix4(origin);
  return [v.x, v.y, v.z];
}

/**
 * The creator starts indoors at the stored code (its votes line the visit
 * up), walks 10 m out, a square loop outdoors whose diagonal is `walkM`
 * with a fix per metre and second, 10 m back in, and looks at the code
 * again - in the frame the tracking has drifted to by then. The visit
 * ends; what the settle did to the code is read back.
 */
async function mixedVisit(v: MixedVisitCase) {
  const r = rng(v.seed ?? 1);
  const theta = 2 * Math.PI * r();
  const storedAlignment = [...MIX_TRUTH];
  storedAlignment[12] = storedAlignment[12]! + v.storedErrorM * Math.cos(theta);
  storedAlignment[14] = storedAlignment[14]! + v.storedErrorM * Math.sin(theta);
  const level = storedCode(storedAlignment, MIX_ORIGIN, v.stamp);
  const c = await indoorCreator(level, v.kept ?? "hosted");
  await c.look(MIX_ORIGIN);
  const votesAtStart = c.votes();
  /** Where each pin stands, and where the truth puts it. */
  const pins: { label: string; truth: Vector3 }[] = [];
  const nue = (p: [number, number, number]): [number, number, number] => {
    const n = webxrToNUE([...p]);
    return [n[0], n[1], n[2]];
  };
  if (v.pins === true) {
    const near = nue(roomToRaw(MIX_ORIGIN, 0.6, 1.0));
    await c.placePin("Near", near);
    pins.push({ label: "Near", truth: truthAt(MIX_TRUTH, near) });
  }
  // Drift: one direction in the room, growing with the distance walked.
  const driftTheta = 2 * Math.PI * r();
  const drift = (walkedM: number): [number, number] => [
    ((v.driftPct ?? 0) / 100) * walkedM * Math.cos(driftTheta),
    ((v.driftPct ?? 0) / 100) * walkedM * Math.sin(driftTheta),
  ];
  const sigma = v.noise === true ? v.accuracyM / 1.51 : 0;
  const phi = Math.exp(-1 / 60);
  let eN = sigma * gauss(r);
  let eE = sigma * gauss(r);
  let walked = DOOR_M;
  c.advance(DOOR_M * 1000);
  const walkStartMs = c.nowMs();
  let jump = 1;
  /** One fix where the phone truly is (room x, z), recorded against the
   *  drifted tracking, with the AR(1) error and the door's jumps. */
  const fixAt = (x: number, z: number): void => {
    eN = phi * eN + Math.sqrt(1 - phi * phi) * sigma * gauss(r);
    eE = phi * eE + Math.sqrt(1 - phi * phi) * sigma * gauss(r);
    jump = -jump;
    const [dx, dz] = drift(walked);
    c.deviceFix(
      MIX_TRUTH,
      roomToRaw(MIX_ORIGIN, x, z),
      v.accuracyM,
      eN,
      eE + jump * (v.jumpM ?? 0),
      roomToRaw(MIX_ORIGIN, x + dx, z + dz),
    );
  };
  if (v.walkM > 0) {
    const a = v.walkM / Math.SQRT2;
    const z0 = 1.2 + DOOR_M;
    const corners: [number, number][] = [
      [0, z0],
      [a, z0],
      [a, z0 + a],
      [0, z0 + a],
      [0, z0],
    ];
    const steps = Math.round(a);
    for (let k = 0; k < 4; k += 1) {
      const [x1, z1] = corners[k]!;
      const [x2, z2] = corners[k + 1]!;
      for (let j = 1; j <= steps; j += 1) {
        const x = x1 + ((x2 - x1) * j) / steps;
        const z = z1 + ((z2 - z1) * j) / steps;
        walked += a / steps;
        fixAt(x, z);
        if (v.pins === true && k === 1 && j === steps) {
          // The loop's far corner: about 64 m walked from either look.
          const [dx, dz] = drift(walked);
          await c.placePin("Far", nue(roomToRaw(MIX_ORIGIN, x + dx, z + dz)));
          pins.push({
            label: "Far",
            truth: truthAt(MIX_TRUTH, nue(roomToRaw(MIX_ORIGIN, x, z))),
          });
        }
      }
    }
  }
  // The page's async work of the walk lands before the way back, as it
  // does on a phone within milliseconds; this walk is fed synchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const walkEndMs = c.nowMs();
  if (v.fixesIndoors === true && v.walkM > 0) {
    // Back in along the room's axis, a fix a second and metre.
    for (let i = 1; i <= DOOR_M; i += 1) {
      walked += 1;
      fixAt(0, 1.2 + DOOR_M - i);
    }
  } else {
    c.advance(DOOR_M * 1000);
    walked += DOOR_M;
  }
  const [dxEnd, dzEnd] = drift(walked);
  const endOrigin = MIX_ORIGIN.clone().multiply(
    new Matrix4().makeTranslation(dxEnd, 0, dzEnd),
  );
  await c.look(endOrigin);
  if (v.fixesIndoors === true && v.walkM > 0) {
    // Still reporting fixes while the creator stands at the code.
    for (let i = 0; i < 3; i += 1) fixAt(0, 1.2);
  }
  const newCodeOrigin = new Matrix4()
    .makeTranslation(5, 0, 0)
    .multiply(endOrigin);
  if (v.newCode === true) {
    await c.look(newCodeOrigin, 12, OTHER, 2_000);
  }
  const votesAtEnd = c.votes();
  c.endVisit();
  await flush();
  const truthCode = throughAlignment(
    odomNueFromWebXr(inOrigin(TRUE_CODE, MIX_ORIGIN)),
    MIX_TRUTH,
  )!.position;
  const truthNE: [number, number] = [truthCode[0], truthCode[2]];
  const after = c.setup.codes
    .references()
    .find((ref) => ref.levelId === c.levelId)?.geo;
  const saved = c.setup.codes.savedText(c.levelId);
  const entry = c.visitLog.entries().at(-1);
  const logged = entry?.codes.find((code) => code.levelId === c.levelId);
  const otherId = await qrCodeId(OTHER);
  const otherText = c.setup.codes.savedText(otherId);
  const otherTruth = throughAlignment(
    odomNueFromWebXr(
      inOrigin(
        TRUE_CODE,
        new Matrix4().makeTranslation(5, 0, 0).multiply(MIX_ORIGIN),
      ),
    ),
    MIX_TRUTH,
  )!.position;
  /** The logged path at each logged device fix: the distance to the
   *  nearest point of the path (m), median. */
  const fused = entry?.fused ?? [];
  const pathGaps = (entry?.gps ?? []).map((g) =>
    Math.min(
      ...fused.map((p) =>
        distM(
          northEast({ lat: p.lat, lon: p.lng, alt: 0 } as never),
          northEast({ lat: g.lat, lon: g.lng, alt: 0 } as never),
        ),
      ),
    ),
  );
  pathGaps.sort((x, y) => x - y);
  const decision = c.settled
    .at(-1)
    ?.codePositions?.find((d) => d.levelId === c.levelId);
  return {
    c,
    level,
    truthNE,
    storedNE: northEast(level.qr.geo!),
    afterNE: after === null || after === undefined ? null : northEast(after),
    /** The stamp a write gave the code; undefined when none did. */
    mintQuality:
      saved === null
        ? undefined
        : (JSON.parse(saved) as QrLevel).qr.mintQuality,
    decision,
    loggedNE: logged === undefined ? null : northEast(logged.geo),
    votesAtStart,
    votesAtEnd,
    loopGapM: Math.hypot(dxEnd, dzEnd),
    /** Each pin's distance from where the truth puts it (m). */
    pinErrM: Object.fromEntries(
      pins.map((p) => [p.label, c.settledAt(p.label).distanceTo(p.truth)]),
    ),
    /** The new code's saved level, and how far it is from the truth. */
    newCode:
      otherText === null
        ? null
        : {
            mintQuality: (JSON.parse(otherText) as QrLevel).qr.mintQuality,
            errM: distM(northEast((JSON.parse(otherText) as QrLevel).qr.geo!), [
              otherTruth[0],
              otherTruth[2],
            ]),
          },
    /** The logged path's median distance from the logged fixes (m). */
    pathGapM: pathGaps[Math.floor(pathGaps.length / 2)] ?? null,
    /** Measurements taken while the code was out of view (the walk). */
    measuredDuringWalk: c.measuredAt.filter(
      (t) => t > walkStartMs && t <= walkEndMs,
    ).length,
  };
}

// Why: a visit the stored code lined up keeps the code's votes in its
// alignment, so read through that alignment the code sits exactly where
// it is stored. The settle used to "replace" it with that same spot,
// stamp it with this walk's GPS quality (so later visits keep it as good)
// and log a perfect agreement - a stored error of 10-15 m became
// permanent. The visit's own device fixes, fitted without the votes, are
// its only honest view of the code.
describe(
  "a visit the stored code lined up, walked with GPS and the code seen again",
  { timeout: SLOW_MS },
  () => {
    it.each([10, 14])(
      "corrects a stored code %d m off to where the visit's own GPS puts it, and stamps it",
      async (storedErrorM) => {
        const v = await mixedVisit({
          walkM: 38,
          accuracyM: 5,
          storedErrorM,
        });
        // The votes were still holding the alignment at the settle.
        expect(v.votesAtEnd).toBeGreaterThan(v.votesAtStart);
        expect(v.decision?.decision).toEqual({ kind: "replace" });
        expect(v.decision?.applied).toBe(true);
        // Exact fixes: the device fit is exact, so the code lands on the
        // truth.
        expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(0.3);
        expect(v.mintQuality?.gpsAccuracyM).toBe(5);
        // The log carries the fit's view, never the votes' (the stored
        // spot).
        expect(distM(v.loggedNE!, v.truthNE)).toBeLessThan(0.3);
      },
    );

    it("writes no stamp and logs no code when the walk cannot judge the code", async () => {
      // 24 m at 15 m accuracy: the heading needs about 72 m.
      const v = await mixedVisit({
        walkM: 24,
        accuracyM: 15,
        storedErrorM: 10,
      });
      expect(v.votesAtEnd).toBeGreaterThan(0);
      // The result line says how much farther to walk.
      expect(v.decision?.decision).toMatchObject({
        kind: "keep",
        reason: "code-placed",
        walkMoreM: expect.any(Number),
      });
      expect(v.decision?.decision.walkMoreM).toBeGreaterThan(20);
      expect(v.afterNE).toEqual(v.storedNE);
      expect(v.mintQuality).toBeUndefined();
      expect(v.loggedNE).toBeNull();
      // The walk itself is still logged: the creator's own GPS.
      expect(v.c.visitLog.entries().at(-1)?.gps.length).toBeGreaterThan(0);
    });

    it("invents no position, stamp or log entry in a visit that never had a fix", async () => {
      const v = await mixedVisit({ walkM: 0, accuracyM: 5, storedErrorM: 10 });
      expect(v.afterNE).toEqual(v.storedNE);
      expect(v.mintQuality).toBeUndefined();
      expect(v.decision?.applied ?? false).toBe(false);
      expect(v.c.visitLog.entries()).toEqual([]);
    });

    it("closes the loop: the walk's drift does not land on the code", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 10,
        driftPct: 3,
      });
      // About 3.8 m of drift between the two looks at the code. Read at
      // the end look alone the code lands about 2.5 m off (measured with
      // the closure switched off); read at the two looks' midpoint, well
      // under a quarter of the gap (0.6 m: the rigid fit absorbs part of
      // the drift as a turn).
      expect(v.loopGapM).toBeGreaterThan(3);
      expect(v.decision?.decision).toEqual({ kind: "replace" });
      expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(v.loopGapM / 4);
    });

    it("moves a code 25 m off as before: the moved-code check withdraws its votes first", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 25,
      });
      expect(v.votesAtStart).toBeGreaterThan(0);
      expect(v.votesAtEnd).toBe(0);
      expect(v.decision?.decision).toEqual({ kind: "move" });
      expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(1);
    });

    // Why: the visit's own pins were placed through the same vote-held
    // alignment as the code. When the settle corrects the code through the
    // visit's own GPS, a pin far from both looks at it (where it does not
    // tie to the code) must be corrected with it - through the same fit -
    // or a visitor lined up on the corrected code finds it as far off as
    // the code was.
    it("settles the visit's pins with the corrected code, near a look and far from both", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 12,
        pins: true,
      });
      expect(v.decision?.decision).toEqual({ kind: "replace" });
      expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(0.3);
      expect(v.pinErrM["Near"]).toBeLessThan(0.3);
      expect(v.pinErrM["Far"]).toBeLessThan(0.3);
    });

    // Why: the visit log's path is what the summary map draws the visit's
    // codes against. Through the votes it sits where the stored code put
    // the visit, apart from its own fixes by the stored error.
    it("logs the visit's path through the same fit as its codes", async () => {
      const v = await mixedVisit({ walkM: 38, accuracyM: 5, storedErrorM: 12 });
      expect(v.pathGapM).not.toBeNull();
      expect(v.pathGapM!).toBeLessThan(1.5);
    });

    // Why: a NEW code measured in such a visit was minted through the
    // vote-held alignment - carrying the stored code's error - but stamped
    // with the device fixes' quality, so later visits kept it as good and
    // it disagreed with the corrected stored code for good.
    it("measures a new code through the visit's own fit, not through the votes", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 12,
        newCode: true,
      });
      expect(v.newCode).not.toBeNull();
      expect(v.newCode!.errM).toBeLessThan(0.5);
      expect(v.newCode!.mintQuality?.gpsAccuracyM).toBe(5);
    });

    it("stamps a new code with no claim of quality when the walk cannot judge it", async () => {
      const v = await mixedVisit({
        walkM: 24,
        accuracyM: 15,
        storedErrorM: 12,
        newCode: true,
      });
      expect(v.newCode).not.toBeNull();
      expect(v.newCode!.mintQuality?.gpsAccuracyM).toBeUndefined();
      expect(v.newCode!.mintQuality?.alignmentGpsExtentM).toBeUndefined();
    });

    // Why: a phone keeps reporting fixes on its way back in and at the
    // second look; the closure must not switch off at the first of them,
    // or the code carries the walk's whole drift again.
    it("keeps closing the loop while fixes keep coming on the way back and at the end look", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 10,
        driftPct: 3,
        fixesIndoors: true,
      });
      expect(v.loopGapM).toBeGreaterThan(3);
      expect(v.decision?.decision).toEqual({ kind: "replace" });
      expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(v.loopGapM / 4);
    });

    // Why: near a door a phone's fixes jump 10-20 m while it hardly moves,
    // so their spread alone passes the walk rule. The fit's heading would
    // be noise, and the code would be replaced and stamped as good from it.
    it("keeps a code a short walk with jumping fixes cannot judge, and says how much farther to walk", async () => {
      const v = await mixedVisit({
        walkM: 8,
        accuracyM: 5,
        storedErrorM: 10,
        jumpM: 15,
      });
      expect(v.decision?.decision).toMatchObject({
        kind: "keep",
        reason: "code-placed",
      });
      expect(v.decision?.decision.walkMoreM).toBeGreaterThan(10);
      expect(v.afterNE).toEqual(v.storedNE);
      expect(v.mintQuality).toBeUndefined();
      expect(v.loggedNE).toBeNull();
    });

    // Why: a code stamped by a good walk is not churned by every later
    // visit, voted or not.
    it("keeps a code a good walk stamped, whatever a later fit sees", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 10,
        stamp: { extentM: 60, accuracyM: 4 },
      });
      expect(v.decision?.decision).toEqual({
        kind: "keep",
        reason: "stored-good",
      });
      expect(v.afterNE).toEqual(v.storedNE);
    });

    // Why: the automatic measurement runs on the render the mint gate
    // opens on - here the walk's third fix, with the code long out of
    // view. Taken then from the last stable pose, it is a code event at
    // the wrong moment, which the visit's notes nearby tie to.
    it("takes no automatic measurement while the code is out of view", async () => {
      const v = await mixedVisit({ walkM: 38, accuracyM: 5, storedErrorM: 10 });
      expect(v.measuredDuringWalk).toBe(0);
      // The look at the end still measures it.
      expect(v.c.measuredAt.length).toBeGreaterThan(0);
    });

    it("does the same for a code only this device's code book stores", async () => {
      const v = await mixedVisit({
        walkM: 38,
        accuracyM: 5,
        storedErrorM: 10,
        kept: "draft",
      });
      expect(v.decision?.decision).toEqual({ kind: "replace" });
      expect(distM(v.afterNE!, v.truthNE)).toBeLessThan(0.3);
    });
  },
);

// ---------------------------------------------------------------------------
// The sweep: walk, accuracy, stored error and drift, with GPS noise
// ---------------------------------------------------------------------------

const SWEEP_WALKS_M = [24, 38, 60] as const;
const SWEEP_ACCURACIES_M = [5, 8, 15] as const;
const SWEEP_STORED_ERRORS_M = [0, 5, 10, 15, 25] as const;
const SWEEP_DRIFTS_PCT = [0, 1, 3] as const;
/** The full table (`CREATOR_INDOOR_SWEEP_OUT=<file>`: one JSON line per
 *  visit, `CREATOR_INDOOR_SWEEP_SEEDS` seeds per cell, default 4). */
const SWEEP_OUT = process.env["CREATOR_INDOOR_SWEEP_OUT"];

// Why: the visit's own view of a code - what the settle judges, re-mints
// and logs in a visit the code's votes still line up - must not depend on
// where the code is stored. If the votes leaked into it, two visits that
// differ ONLY in the stored position (same walk, same GPS noise, same
// drift) would log, and correct to, positions apart by that difference.
// Drawn over the sweep's walks, accuracies, drifts and stored errors under
// the moved-code check's floor, with AR(1) GPS noise.
describe(
  "the visit's own view of a code (sweep, property)",
  { timeout: 10 * SLOW_MS },
  () => {
    it("is the same whatever the stored position, and a stamp only ever comes with a change", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...SWEEP_WALKS_M),
          fc.constantFrom(...SWEEP_ACCURACIES_M),
          fc.constantFrom(...SWEEP_DRIFTS_PCT),
          fc.constantFrom(0, 5, 10, 15),
          fc.constantFrom(0, 5, 10, 15),
          fc.integer({ min: 1, max: 1000 }),
          async (walkM, accuracyM, driftPct, errA, errB, seed) => {
            const at = (storedErrorM: number) =>
              mixedVisit({
                walkM,
                accuracyM,
                storedErrorM,
                driftPct,
                noise: true,
                seed,
              });
            const a = await at(errA);
            const b = await at(errB);
            for (const v of [a, b]) {
              const changed =
                v.decision?.applied === true &&
                (v.decision.decision.kind === "replace" ||
                  v.decision.decision.kind === "move");
              expect(v.mintQuality !== undefined).toBe(changed);
              // Unchanged means exactly as stored.
              expect(v.afterNE).toEqual(changed ? v.afterNE : v.storedNE);
              // A code the walk could not judge is not logged.
              const codePlaced = v.decision?.decision.reason === "code-placed";
              expect(codePlaced ? v.loggedNE : null).toBeNull();
            }
            // Both still lined up by the votes at the settle (the moved-code
            // check withdrew none): their own views must agree.
            const bothHeld = a.votesAtEnd > 0 && b.votesAtEnd > 0;
            expect(
              bothHeld && (a.loggedNE === null) !== (b.loggedNE === null),
            ).toBe(false);
            const gapM =
              bothHeld && a.loggedNE !== null && b.loggedNE !== null
                ? distM(a.loggedNE, b.loggedNE)
                : 0;
            expect(gapM).toBeLessThan(0.01);
          },
        ),
        { numRuns: 5, seed: 20261025 },
      );
    });

    it.runIf(SWEEP_OUT !== undefined)(
      "writes the full table",
      async () => {
        const { appendFileSync, readFileSync, writeFileSync } =
          await import("node:fs");
        const seeds = Number(process.env["CREATOR_INDOOR_SWEEP_SEEDS"] ?? 4);
        writeFileSync(SWEEP_OUT!, "");
        for (const walkM of SWEEP_WALKS_M) {
          for (const accuracyM of SWEEP_ACCURACIES_M) {
            for (const storedErrorM of SWEEP_STORED_ERRORS_M) {
              for (const driftPct of SWEEP_DRIFTS_PCT) {
                for (let seed = 1; seed <= seeds; seed += 1) {
                  const v = await mixedVisit({
                    walkM,
                    accuracyM,
                    storedErrorM,
                    driftPct,
                    noise: true,
                    seed,
                  });
                  appendFileSync(
                    SWEEP_OUT!,
                    `${JSON.stringify({
                      walkM,
                      accuracyM,
                      storedErrorM,
                      driftPct,
                      seed,
                      decision: v.decision?.decision ?? null,
                      applied: v.decision?.applied ?? false,
                      votesAtEnd: v.votesAtEnd,
                      // What a guard on the offset would read: how far the
                      // visit saw the code, and the accuracy it judged by.
                      offsetM: v.decision?.offsetM ?? null,
                      candidate: v.decision?.candidate ?? null,
                      stamped: v.mintQuality !== undefined,
                      finalErrM:
                        v.afterNE === null ? null : distM(v.afterNE, v.truthNE),
                      loggedErrM:
                        v.loggedNE === null
                          ? null
                          : distM(v.loggedNE, v.truthNE),
                      loopGapM: v.loopGapM,
                    })}\n`,
                  );
                }
              }
            }
          }
        }
        // Every visit of the grid ran to its settle and was written.
        const rows = readFileSync(SWEEP_OUT!, "utf8").trim().split("\n");
        expect(rows).toHaveLength(
          SWEEP_WALKS_M.length *
            SWEEP_ACCURACIES_M.length *
            SWEEP_STORED_ERRORS_M.length *
            SWEEP_DRIFTS_PCT.length *
            seeds,
        );
      },
      24 * 60 * 60 * 1000,
    );
  },
);
