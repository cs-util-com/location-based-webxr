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
import { beforeAll, describe, expect, it, vi } from "vitest";
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

// The geo maths the fixtures mint codes with is licensed, and building a
// store activates it: before any fixture runs.
beforeAll(() => {
  createTourViewerStore();
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
 *  in this visit, i.e. `alignment` is the truth the visit should find. */
function storedCode(alignment: number[], origin: Matrix4): QrLevel {
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
  }[] = [];
  const dispatch = arStore.dispatch;
  arStore.dispatch = ((action: { type: string; payload?: unknown }) => {
    if (action.type === "tourAuthoring/settled") {
      settled.push(action.payload as (typeof settled)[number]);
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
  const clock = { nowMs: T0 };
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
    text = TEXT,
    startMs = 0,
  ): Promise<void> {
    const c = captured.configs.at(-1)!;
    let level = fetched.get(text);
    if (level === undefined) {
      level = await c.fetchLevel(text);
      fetched.set(text, level);
    }
    const event = detection(i, origin, text, startMs);
    clock.nowMs = T0 + event.timestamp;
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
            timestamp: T0 + event.timestamp,
          }),
        );
      }
    }
    c.onLocked?.({} as never, level);
    await flush();
  }

  /** Look at a code for `n` frames (stable from about the seventh). */
  async function look(
    origin: Matrix4,
    n = 12,
    text = TEXT,
    startMs = 0,
  ): Promise<void> {
    for (let i = 0; i < n; i += 1) await frame(i, origin, text, startMs);
    // The level id is an async hash: the sighting waits for it.
    await qrCodeId(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  }

  /** One device fix where `truth` puts the phone at raw WebXR `at`, off by
   *  `offsetNorthM`, through the page's device-fix path (`main.ts` hands the
   *  coordinator's `recordFix` to the viewer placement). */
  let fixes = 0;
  function deviceFix(
    truth: number[],
    at: [number, number, number],
    accuracyM: number,
    offsetNorthM = 0,
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
        z: worldPose.position[2],
      },
      worldNueRotation: [0, 0, 0, 1],
      zero: ZERO,
    });
    // The coordinator sets a zero only when the session has none.
    if (selectZeroReference(arStore.getState()) === null) {
      arStore.dispatch(setZeroPos({ lat: geo.lat, lon: geo.lon }));
    }
    fixes += 1;
    clock.nowMs += 1000;
    const payload: RecordGpsEventPayload = {
      odomPosition: at,
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
    endVisit: () => {
      setup.endAuthorVisit();
    },
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
        // which has not fired): the visit is a GPS visit.
        expect(fixAfterS * 1000).toBeLessThan(SCAN_GATE_ESCAPE_MS);
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
