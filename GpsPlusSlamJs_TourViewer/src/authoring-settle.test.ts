/**
 * Authoring anchoring, end to end through the real creator setup
 * (authoring plan 2026-09-28-0953 §3.2 and §3.2a, milestone M2c).
 *
 * The owner saw two things in the field: notes slid while he placed them
 * (symptom A), and after re-opening the tour they were not where he had
 * put them, even after scanning the code again (symptom B). His model
 * (D2): notes rigid in AR while authoring, each stored as geo only, and
 * the geo of a visit's notes settled together with the code's.
 *
 * Why these tests matter: each one reproduces a symptom through the
 * composed module - real store and reducers, real fused-pose source fed
 * with detections, real three.js scene graph - and fails against the code
 * that had the symptom. Only the device (QR controller, reticle, camera)
 * is stood in.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  type Pose,
} from "gps-plus-slam-app-framework/ar/qr";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { ObjectListHandlers, ObjectListModel } from "./object-list.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  endQrPipeline,
} from "./tour-viewer-session.js";
import { mintPin, objectPoseNue } from "./content-placement.js";
import {
  deletedKey,
  META_KEY,
  objectKey,
  readDraft,
  visitKey,
} from "./draft-persistence.js";
import type { SummaryModel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import { parseVisitLogEntry } from "./visit-log.js";
import { readCodeSpots } from "./level-spots.js";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { OUTCOME_HOLD_MS } from "./object-editing.js";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import {
  correctedAlignment,
  odomNueFromWebXr,
  throughAlignment,
} from "./visit-anchoring.js";

// The pipeline builds its controller from this module; capture the config
// it hands over (its `onDetection` is how detections reach the setup) and
// give back a controller that does nothing.
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

/**
 * Per-test timeout. A test here walks one or two whole AR visits through the
 * real fused-pose source (eight detections each, plus the mint): 0.4-1.2 s
 * on an idle machine, 5-10 s measured at 100% CPU with other suites running.
 * The default 5 s would make them fail on load alone, never on behaviour.
 */
const SLOW_MS = 30_000;

const SIZE_M = 0.16;
const ZERO = { lat: 47.5, lon: 8.7 };
const K = { fx: 820, fy: 820, cx: 512, cy: 384 };

function yawQ(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** A yaw-only rigid alignment, the only shape the solver produces. */
function yawAlignment(deg: number, t: [number, number, number]): number[] {
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(...yawQ(deg)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

/** The printed code's true pose in raw WebXR odometry. */
const TRUE_CODE: Pose = { position: [0, 0, 0], rotation: yawQ(6) };
const TEXT = "https://gps.csutil.com/tour/?qr=anchoring";

/** A raw WebXR pose moved by a rigid `origin` change (the identity when
 *  none): what the same physical pose reads in another session's odometry. */
function inOrigin(pose: Pose, origin?: Matrix4): Pose {
  if (origin === undefined) return pose;
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

/** The i-th detection of the code, from a camera stepping sideways
 *  (the fused-pose wiring test's walk: stable after about seven), in the
 *  odometry of a session whose origin is `origin` away from the first. */
function detection(
  i: number,
  origin?: Matrix4,
  text = TEXT,
  startMs = 0,
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
  "replaceHelpShare",
  "replaceHelpGeneric",
  "replaceHelpDrive",
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
    focus: () => undefined,
    addEventListener: (type: string, handler: (event?: unknown) => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    /** Fire any other listener with an event (the overlay's
     *  `beforexrselect`). */
    fire: (type: string, event: unknown) => handlers.get(type)?.(event),
    /** Whether a listener of `type` was added to this element. */
    listens: (type: string) => handlers.has(type),
    // The object list's view (authoring plan M4): records what the setup
    // binds and draws - the model is tested in object-list.test.ts, the
    // DOM by the Playwright suite.
    listHandlers: null as ObjectListHandlers | null,
    lastModel: null as ObjectListModel | null,
    bind(bound: ObjectListHandlers) {
      this.listHandlers = bound;
    },
    render(model: ObjectListModel) {
      this.lastModel = model;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/**
 * A creator in a running AR session: the real store with a GPS alignment
 * laid over it that a test can change, a real scene root with the AR world
 * group under it (its matrix IS the alignment, as the lerp settles to), a
 * reticle at a chosen odometry spot, and labels that are real Object3Ds.
 */
/** A plain in-memory draft store. */
function memoryDraftStore(): {
  store: DraftFileStore;
  files: Map<string, unknown>;
} {
  const files = new Map<string, unknown>();
  const store: DraftFileStore = {
    put: (key, data) => {
      files.set(key, data);
      return Promise.resolve(true);
    },
    getText: (key) => {
      const value = files.get(key);
      return Promise.resolve(typeof value === "string" ? value : undefined);
    },
    getBlob: () => Promise.resolve(undefined),
    keys: () => Promise.resolve([...files.keys()]),
    remove: (key) => {
      files.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      files.clear();
      return Promise.resolve();
    },
  };
  return { store, files };
}

/**
 * A draft store whose writes wait until `release`, so a test sees the
 * in-progress state - and which can REFUSE a write (false, as a quota wall
 * does) or REJECT one (a throw), for the failure branches.
 */
function slowDraftStore() {
  const { store, files } = memoryDraftStore();
  const held: (() => void)[] = [];
  const mode = { refuse: false, reject: false };
  const slow: DraftFileStore = {
    ...store,
    put: (key, data) =>
      new Promise<boolean>((resolve, reject) => {
        held.push(() => {
          if (mode.reject) {
            reject(new Error("the store threw"));
            return;
          }
          if (!mode.refuse) files.set(key, data);
          resolve(!mode.refuse);
        });
      }),
  };
  return {
    store: slow,
    files,
    mode,
    /** Land every write held so far, and what they set off. */
    release: async (): Promise<void> => {
      for (let round = 0; round < 5; round += 1) {
        for (const land of held.splice(0)) land();
        await flush();
      }
    },
  };
}

function authoring(
  options: {
    store?: DraftFileStore;
    summary?: Pick<SummaryPanel, "show" | "hide">;
  } = {},
) {
  /** Whether the AR session is up, as the controller reports it. */
  const device = { live: true };
  /** Photo encodes held until the test lets them land (`hold`). */
  const encodes: { hold: boolean; waiting: (() => void)[] } = {
    hold: false,
    waiting: [],
  };
  captured.configs.length = 0;
  const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
    (typeof DOM_KEYS)[number],
    ReturnType<typeof el>
  >;
  dom.sizeInput.value = String(SIZE_M);
  const ctx = createTourViewerSession();
  const real = createTourViewerStore();
  const gps: {
    alignment: number[];
    zero: { lat: number; lon: number } | null;
    /** The visit's device fixes and odometry, when a test walks. */
    walk: { fixes: unknown[]; odometry: number[][] } | null;
    /** The store's median GPS accuracy (m); unset: unknown. */
    accuracyM?: number;
  } = { alignment: yawAlignment(0, [0, 400, 0]), zero: ZERO, walk: null };
  const dispatched: { type: string; payload?: unknown }[] = [];
  const arStore = {
    ...real,
    getState: () =>
      ({
        ...real.getState(),
        gpsData: {
          zero: gps.zero,
          gpsEvents: {
            alignmentMatrix: gps.alignment,
            gpsPositions:
              gps.walk?.fixes ??
              Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
                lat: ZERO.lat,
                lon: ZERO.lon,
              })),
            odometryPositions: gps.walk?.odometry ?? [],
            ...(gps.accuracyM === undefined
              ? {}
              : { gpsAccuracyMedian: gps.accuracyM }),
          },
        },
      }) as never,
    dispatch: (action: { type: string; payload?: unknown }) => {
      dispatched.push(action);
      return real.dispatch(action as never);
    },
  } as unknown as ReturnType<typeof createTourViewerStore>;

  const scene = new Group();
  const world = new Group();
  world.matrixAutoUpdate = false;
  scene.add(world);
  const setAlignment = (m: number[]): void => {
    gps.alignment = m;
    world.matrix.fromArray(m);
    scene.updateMatrixWorld(true);
  };
  setAlignment(gps.alignment);

  const reticleLocal = new Vector3(2, 0, -1);
  ctx.reticle = {
    isVisible: () => true,
    getWorldPosition: (v: Vector3) =>
      v.copy(reticleLocal).applyMatrix4(world.matrixWorld),
    dispose: () => undefined,
  };
  const labels: Object3D[] = [];
  /** What a tap in AR picks (the raycast itself is `object-pick.test.ts`'s):
   *  handed the rendered roots by id, as production hands them. */
  const pick: {
    fn: (
      targets: ReadonlyMap<string, Object3D>,
      tap: { targetRayInViewer: readonly number[] } | null,
    ) => string | null;
  } = { fn: () => null };
  /** One-shot timers the setup armed (the `schedule` seam), fired by hand. */
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const seams = {
    schedule: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    pickObjectInView: (
      targets: ReadonlyMap<string, Object3D>,
      tap: { targetRayInViewer: readonly number[] } | null,
    ) => pick.fn(targets, tap),
    canShareZip: () => false,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => scene,
    // The print-size check measures nothing here.
    estimateQrPrintSize: () => null,
    getArWorldGroup: () => world,
    createLabel: (text: string) => {
      const object = new Object3D();
      object.name = text;
      labels.push(object);
      return { object, dispose: () => undefined };
    },
    encodeFrameJpeg: () => {
      const jpeg = { blob: new Blob([]), width: 4, height: 3 };
      if (!encodes.hold) return Promise.resolve(jpeg);
      return new Promise((resolve) => {
        encodes.waiting.push(() => {
          resolve(jpeg);
        });
      });
    },
  } as unknown as TourViewerSeams;
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore,
    arController: {
      getState: () => ({ status: device.live ? "running" : "idle" }),
      // A Finish ends the session: the entry's session end runs, as
      // `ar-entry.ts` onSessionEnd would.
      disable: () => {
        if (device.live) endVisit();
        return Promise.resolve();
      },
    } as never,
    seams,
    wizard: {
      openStep: () => undefined,
      revealStep: () => undefined,
    } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: () => Promise.resolve(options.store),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
  });
  expect(setup.startAuthorPipeline()).toBe(true);

  /** Walk the code until its fused pose is stable. */
  function seeTheCode(origin?: Matrix4, text = TEXT, startMs = 0): void {
    for (let i = 0; i < 8; i += 1) {
      captured.configs
        .at(-1)
        ?.onDetection?.(detection(i, origin, text, startMs));
    }
  }

  /** Measure the code: stable, and the gate open, it is measured on its
   *  own (UI round 1, U3). */
  async function mint(
    origin?: Matrix4,
    text = TEXT,
    startMs = 0,
  ): Promise<void> {
    const measured = () =>
      dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured").length;
    const before = measured();
    seeTheCode(origin, text, startMs);
    await vi.waitFor(() => {
      expect(measured()).toBeGreaterThan(before);
      expect(setup.codes.inHand()).not.toBeNull();
    });
    // The measurement's own end (its render; Finish waits for it).
    await flush();
  }

  /** The AR session ends: the creator setup settles FIRST (while the
   *  store still holds the visit's alignment), then the entry's teardown
   *  (`ar-entry.ts` onSessionEnd) - here the parts the setup reads. */
  function endVisit(): void {
    setup.endAuthorVisit();
    device.live = false;
    ctx.arSessionGeneration += 1;
    endQrPipeline(ctx);
    ctx.lastDetectedText = null;
    for (const preview of ctx.placedPreviews.values()) preview.dispose();
    ctx.placedPreviews.clear();
  }

  /** A new AR session: a fresh pipeline, then the visit's start. */
  function beginVisit(): void {
    device.live = true;
    expect(setup.startAuthorPipeline()).toBe(true);
    setup.beginAuthorVisit();
  }

  /** The `tourAuthoring/settled` actions logged so far. */
  function settledLogs() {
    return dispatched.filter((a) => a.type === "tourAuthoring/settled") as {
      type: string;
      payload: {
        arVisitIndex: number;
        trigger: string;
        basis: string;
        visitAlignment: unknown;
        usedAlignment: number[];
        /** Since D33 each object carries its own choice. */
        objects: {
          id: string;
          geo: TourObject["geo"];
          basis?: string;
          usedAlignment?: number[];
          refusedCorrection?: unknown;
        }[];
        /** Since D33: the alignment the level was re-minted through. */
        levelAlignment?: number[] | null;
        level: { id: string; json: string } | null;
        /** Since M5a: every level the settle re-minted. */
        levels?: { id: string; json: string; alignment: number[] }[];
        referenceLevel: { id: string; json: string } | null;
        zero: { lat: number; lon: number } | null;
        sighting: { odomPose: Pose; levelId: string } | null;
        refusedCorrection: unknown;
      };
    }[];
  }

  /** Place a pin at `local` (odometry-NUE) with this label. */
  async function placePin(label: string, local: [number, number, number]) {
    reticleLocal.set(...local);
    dom.pinLabel.value = label;
    dom.pinSave.click();
    await flush();
  }

  /** Where a label sits in the AR world group's frame right now. */
  function inWorldGroup(label: string): Vector3 {
    const object = [...labels].reverse().find((o) => o.name === label);
    expect(object, `no preview for ${label}`).toBeDefined();
    scene.updateMatrixWorld(true);
    return world.worldToLocal(object!.getWorldPosition(new Vector3()));
  }

  /** Tap "Capture a photo" with the camera at `cameraPose` (raw WebXR). */
  function tapPhoto(cameraPose: Pose): void {
    ctx.latestFrame = {
      image: { data: new Uint8ClampedArray(48), width: 4, height: 3 },
      cameraPose,
      capturedAtMs: performance.timeOrigin + performance.now(),
    };
    dom.photoButton.click();
  }

  return {
    ctx,
    dom,
    setup,
    codes: setup.codes,
    dispatched,
    device,
    encodes,
    tapPhoto,
    world,
    setAlignment,
    /** The zero arrives (or goes): a store dispatch, as the first fix's. */
    setZero: (zero: { lat: number; lon: number } | null): void => {
      gps.zero = zero;
      real.dispatch({ type: "test/zeroChanged" } as never);
    },
    placePin,
    inWorldGroup,
    seeTheCode,
    mint,
    endVisit,
    beginVisit,
    settledLogs,
    labels,
    scene,
    pick,
    timers,
    /** Fire every armed timer that was not cancelled. */
    fireTimers: (): void => {
      for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
    },
    /** Put the reticle at `local` (odometry-NUE). */
    setReticle: (local: [number, number, number]): void => {
      reticleLocal.set(...local);
    },
    /** The visit's device fixes and their odometry, as the store holds
     *  them (cleared by the next `setWalk(null)`). */
    setWalk: (walk: { fixes: unknown[]; odometry: number[][] } | null) => {
      gps.walk = walk;
    },
    /** The store's median GPS accuracy (m). */
    setAccuracy: (accuracyM: number): void => {
      gps.accuracyM = accuracyM;
    },
  };
}

describe(
  "symptom A: a note placed in AR stays put while GPS re-solves",
  { timeout: SLOW_MS },
  () => {
    it("keeps a pin's preview at its spot in AR when the alignment changes", async () => {
      // Before M2c the preview was added to the SCENE ROOT from its geo, while
      // the camera rides the world group, so every alignment re-solve slid the
      // note against the real world - what the owner saw (plan §2.1, A1).
      const a = authoring();
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      await a.placePin("Gate", [2, 0, -1]);
      const before = a.inWorldGroup("Gate");
      expect(before.distanceTo(new Vector3(2, 0, -1))).toBeLessThan(1e-9);

      // GPS moves the alignment 4 m and turns it 8 degrees.
      a.setAlignment(yawAlignment(8, [4, 400, -1]));

      const after = a.inWorldGroup("Gate");
      expect(after.distanceTo(new Vector3(2, 0, -1))).toBeLessThan(1e-9);
    });

    it("keeps each object's odometry pose and its visit, a photo's through the one conversion", async () => {
      // What the settle recomputes geo from (plan §3.2): the pose in the
      // world group's frame, and the AR visit it is valid in. A photo's
      // capture pose is raw WebXR, so it goes through `odomNueFromWebXr` -
      // never the trailing basis form.
      const a = authoring();
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      await a.placePin("Gate", [2, 0, -1]);
      const cameraPose: Pose = {
        position: [0.5, 1.4, -0.2],
        rotation: yawQ(90),
      };
      a.ctx.latestFrame = {
        image: { data: new Uint8ClampedArray(48), width: 4, height: 3 },
        cameraPose,
        capturedAtMs: performance.timeOrigin + performance.now(),
      };
      a.dom.photoButton.click();
      await flush();

      const [pin, photo] = a.ctx.placedObjects;
      expect(pin?.placement?.visit).toBe(0);
      expect(pin?.placement?.local.position).toEqual([2, 0, -1]);
      expect(photo?.object.kind).toBe("photo");
      expect(photo?.placement?.visit).toBe(0);
      expect(photo?.placement?.local).toEqual(odomNueFromWebXr(cameraPose));
    });
  },
);

/** A pose's GPS-world NUE position from its geo. */
function worldOf(geo: TourObject["geo"]): Vector3 {
  return new Vector3(...objectPoseNue(geo, ZERO).positionNue);
}

/** The code's stored GPS-world NUE position. */
function codeWorldOf(json: string): Vector3 {
  return worldOf(parseQrLevel(JSON.parse(json) as unknown).qr.geo!);
}

/** The fused pose the mint used, from its own log. */
function mintedOdom(
  dispatched: { type: string; payload?: unknown }[],
): Vector3 {
  const measured = dispatched.find(
    (a) => a.type === "tourAuthoring/codeMeasured",
  ) as { payload: { fusedOdomPose: Pose } } | undefined;
  expect(measured, "the mint should have logged its pose").toBeDefined();
  return new Vector3(
    ...odomNueFromWebXr(measured!.payload.fusedOdomPose).position,
  );
}

describe(
  "symptom B within a visit: the code and its notes settle together (B2)",
  { timeout: SLOW_MS },
  () => {
    it("stores a pin relative to the code as placed, though GPS moved between the two taps", async () => {
      // Plan §2.2 B2: the code was composed through the alignment at its Save
      // tap and the pin through the alignment at ITS tap. They differ, so the
      // zip's relative geometry was wrong before anyone relocalized. At the
      // visit's end both are recomputed through the visit's final alignment.
      const a = authoring();
      await a.mint();
      const codeLocal = mintedOdom(a.dispatched);
      a.setAlignment(yawAlignment(7, [3, 400, -2]));
      await a.placePin("Gate", [2, 0, -1]);
      a.setAlignment(yawAlignment(4, [1.5, 400.2, -1]));

      a.endVisit();

      const pin = a.ctx.placedObjects[0]!.object;
      const offset = worldOf(pin.geo).sub(codeWorldOf(a.codes.inHand()!.json));
      const expected = new Vector3(2, 0, -1)
        .sub(codeLocal)
        .applyQuaternion(new Quaternion(...yawQ(4)));
      expect(offset.distanceTo(expected)).toBeLessThan(1e-3);
    });

    it("logs the settle into the recording: the new geo, the level and the alignment used", async () => {
      // Plan §3.2: a replay must reproduce the zip, and the zip now carries
      // the SETTLED geo - which exists nowhere but in this action.
      const a = authoring();
      await a.mint();
      const tapLevel = a.codes.inHand();
      await a.placePin("Gate", [2, 0, -1]);
      const end = yawAlignment(4, [1.5, 400.2, -1]);
      a.setAlignment(end);

      a.endVisit();

      const logs = a.settledLogs();
      expect(logs).toHaveLength(1);
      const payload = logs[0]!.payload;
      expect(payload.arVisitIndex).toBe(0);
      expect(payload.trigger).toBe("visit-end");
      expect(payload.basis).toBe("measured-here");
      expect(payload.visitAlignment).toEqual(end);
      expect(payload.usedAlignment).toEqual(end);
      // Since D33 each object also logs its own choice. This visit never
      // reached 40 m of GPS extent, so the pin fell back to the end alignment.
      expect(payload.objects).toEqual([
        {
          id: a.ctx.placedObjects[0]!.object.id,
          geo: a.ctx.placedObjects[0]!.object.geo,
          basis: "measured-here",
          usedAlignment: end,
          refusedCorrection: null,
        },
      ]);
      expect(payload.level).toEqual(a.codes.inHand());
      expect(payload.levelAlignment).toEqual(end);
      // The level in hand BEFORE the settle and the zero (review #7): what a
      // replay needs to recompute a code-corrected settle.
      expect(payload.referenceLevel).toEqual(tapLevel);
      expect(payload.zero).toEqual(ZERO);
      // JSON-safe: the recording writes it to a file as it is.
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    });

    it("rewrites the draft's record and level, so a reload keeps the settled geo", async () => {
      // A page reload restores from the draft. Without the rewrite it would
      // bring back the tap-time geo the settle just replaced (plan §3.2 says
      // only a KILLED tab keeps the tap-time geo).
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      const tapGeo = a.ctx.placedObjects[0]!.object.geo;
      const tapLevel = a.codes.inHand()!.json;
      a.setAlignment(yawAlignment(9, [2, 400, 2]));

      a.endVisit();
      await flush();

      const pin = a.ctx.placedObjects[0]!.object;
      expect(pin.geo, "the settle should have moved the pin").not.toEqual(
        tapGeo,
      );
      expect(a.codes.inHand()!.json).not.toBe(tapLevel);
      const onDisk = JSON.parse(
        String(files.get(objectKey(pin.id))),
      ) as TourObject;
      expect(onDisk.geo).toEqual(pin.geo);
      const meta = JSON.parse(String(files.get(META_KEY))) as {
        level: { json: string };
      };
      expect(meta.level.json).toBe(a.codes.inHand()!.json);
    });
  },
);

describe(
  "symptom B across visits: a later visit is corrected through the code (D10b)",
  { timeout: SLOW_MS },
  () => {
    /** Visit 0 measures the code and places "Gate"; its visit ends. */
    async function firstVisit() {
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      return a;
    }

    // The second visit's GPS alignment is 20 m and 30 degrees away from the
    // first's - GPS error that differs between visits (plan §7b finding 2).
    const SECOND = yawAlignment(30, [20, 401, -8]);

    it("keeps a second visit's note where it was placed relative to the code, when the code was seen", async () => {
      const a = await firstVisit();
      const codeLocal = mintedOdom(a.dispatched);
      a.beginVisit();
      a.setAlignment(SECOND);
      a.seeTheCode();
      await flush();
      await a.placePin("Later", [3, 0, 1]);
      a.endVisit();

      const later = a.ctx.placedObjects[1]!.object;
      const offset = worldOf(later.geo).sub(
        codeWorldOf(a.codes.inHand()!.json),
      );
      // Relative to the code exactly as placed, turned by the FIRST visit's
      // alignment (the frame the code's geo was stored in) - not the 20 m
      // the second visit's GPS put between them.
      const expected = new Vector3(3, 0, 1).sub(codeLocal);
      expect(offset.distanceTo(expected)).toBeLessThan(1e-2);
      const logs = a.settledLogs();
      expect(logs.at(-1)?.payload.basis).toBe("code-corrected");
      // The stored code is the reference; the second visit does not move it.
      expect(logs.at(-1)?.payload.level).toBeNull();
      // A replay recomputes the corrected alignment from the log alone.
      const last = logs.at(-1)!.payload;
      const stored = parseQrLevel(
        JSON.parse(last.referenceLevel!.json) as unknown,
      ).qr.geo!;
      const storedPose = objectPoseNue(stored, last.zero!);
      const replayed = correctedAlignment(
        last.visitAlignment as number[],
        odomNueFromWebXr(last.sighting!.odomPose),
        { position: storedPose.positionNue, rotation: storedPose.rotationNue },
      )!;
      replayed.forEach((v, i) => {
        expect(v).toBeCloseTo(last.usedAlignment[i]!, 9);
      });
    });

    it("keeps the note's place relative to the code when the second session's odometry origin moved", async () => {
      // Why this test matters (M2c review #3): every other cross-visit test
      // saw the code at the same odometry pose in both visits, so a settle
      // through the MEASURING visit's pose instead of this visit's sighting
      // passed. Each WebXR session has its own origin; here the second one
      // is turned 70 degrees and moved 8 m, and the reticle spot is where
      // the SAME physical point reads in it.
      const a = await firstVisit();
      const codeLocal = mintedOdom(a.dispatched);
      const origin = new Matrix4().compose(
        new Vector3(4, -0.3, -7),
        new Quaternion(...yawQ(70)),
        new Vector3(1, 1, 1),
      );
      a.beginVisit();
      // The second visit's GPS alignment, as the solver would find it for
      // the moved origin: SECOND's GPS error, in the new odometry frame.
      const originNue = new Matrix4()
        .copy(WEBXR_TO_NUE)
        .multiply(origin)
        .multiply(new Matrix4().copy(WEBXR_TO_NUE).invert());
      a.setAlignment(
        new Matrix4()
          .fromArray(SECOND)
          .multiply(originNue.clone().invert())
          .toArray(),
      );
      a.seeTheCode(origin);
      await flush();
      // The physical spot at odometry-NUE [3, 0, 1] of the first session.
      const spotRaw: Pose = {
        position: [1, 0, -3],
        rotation: [0, 0, 0, 1],
      };
      expect(odomNueFromWebXr(spotRaw).position).toEqual([3, 0, 1]);
      const spot2 = odomNueFromWebXr(inOrigin(spotRaw, origin)).position;
      await a.placePin("Later", [...spot2]);
      a.endVisit();

      const later = a.ctx.placedObjects[1]!.object;
      const offset = worldOf(later.geo).sub(
        codeWorldOf(a.codes.inHand()!.json),
      );
      expect(
        offset.distanceTo(new Vector3(3, 0, 1).sub(codeLocal)),
      ).toBeLessThan(1e-2);
    });

    it("refuses a correction 60 m away - a second print, not GPS - says so in the panel, and logs it", async () => {
      // Why this test matters (M2c review #2): a level's id is a hash of the
      // printed text, so a second print hung 60 m away IS "the code" to the
      // setup. Corrected through it, every note of the visit would move
      // 60 m. Refused, the visit keeps its own GPS alignment, the author
      // is told in one line, and the recording says why.
      const a = await firstVisit();
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.textContent).toMatch(
        /Code seen 60 m from its saved position/,
      );
      await a.placePin("Later", [3, 0, 1]);
      a.endVisit();
      const last = a.settledLogs().at(-1)!.payload as {
        basis: string;
        refusedCorrection: { horizontalM: number; maxHorizontalM: number };
      };
      expect(last.basis).toBe("visit-alignment");
      expect(last.refusedCorrection.horizontalM).toBeCloseTo(60, 1);
      expect(last.refusedCorrection.maxHorizontalM).toBeLessThan(60);
    });

    // Why this test matters (the stale refused line filed in the M2 review,
    // fixed in M5b): "Use this size" voids the code's sightings - they were
    // solved at the old size - but the refused-correction line judged from
    // them stayed on the panel until the next GPS fix.
    // Why this test matters (code book plan M5b): with several codes the
    // refused line must say WHICH code it means, by the same numbering the
    // summary uses - the tour's codes first, so the number never follows
    // whichever code is in hand.
    it("names the code in the refused line when the tour has several", async () => {
      const a = await firstVisit();
      // The tour also holds another code, listed before this page's.
      a.ctx.currentLevels = new Map([
        [
          "other0000001",
          {
            version: 1,
            qr: {
              text: "https://example.invalid/?qr=other",
              physicalSizeM: 0.16,
            },
          } as never,
        ],
      ]);
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.textContent).toMatch(/Code 2: Code seen 60 m/);
    });

    it("drops the refused line at once when the code's size is adopted", async () => {
      const a = await firstVisit();
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.textContent).toMatch(/Code seen 60 m/);
      a.ctx.printSizeCheck = {
        ...a.ctx.printSizeCheck!,
        offer: () => ({ text: TEXT, sizeM: 0.3 }),
        answer: () => undefined,
      };
      a.dom.sizeOfferUse.click();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.textContent).not.toMatch(/Code seen 60 m/);
    });

    it("without a sighting of the code, keeps the plain visit alignment (and its GPS difference)", async () => {
      const a = await firstVisit();
      a.beginVisit();
      a.setAlignment(SECOND);
      await a.placePin("Later", [3, 0, 1]);
      a.endVisit();

      expect(a.settledLogs().at(-1)?.payload.basis).toBe("visit-alignment");
    });

    it("shows the earlier visit's note from its geo on re-entry, then at its spot relative to the code once the code is seen", async () => {
      // Plan §3.2 "Earlier visits' objects on re-entry": placed from geo like
      // viewer content until the code is seen in this visit, then through the
      // code correction - which, like this visit's own notes, is rigid in AR.
      const a = await firstVisit();
      const gate = a.ctx.placedObjects[0]!.object;
      a.setAlignment(SECOND);
      a.beginVisit();

      // From geo: at the scene root, where the stored geo is.
      const shown = [...a.labels].reverse().find((o) => o.name === "Gate");
      expect(
        shown,
        "the earlier note should be shown on re-entry",
      ).toBeDefined();
      a.scene.updateMatrixWorld(true);
      expect(
        shown!.getWorldPosition(new Vector3()).distanceTo(worldOf(gate.geo)),
      ).toBeLessThan(1e-3);

      a.seeTheCode();
      await flush();
      // The code sits at the same odometry spot in this visit, so the note is
      // back at the odometry spot it was placed at - whatever GPS says.
      expect(
        a.inWorldGroup("Gate").distanceTo(new Vector3(2, 0, -1)),
      ).toBeLessThan(1e-2);
      a.setAlignment(yawAlignment(-12, [5, 399, 3]));
      expect(
        a.inWorldGroup("Gate").distanceTo(new Vector3(2, 0, -1)),
      ).toBeLessThan(1e-2);
    });

    it("keeps the earlier notes in the code's frame on new fixes while the code is out of view, though GPS drifts past the bound; only a sighting re-places them (M5b review #8, §7m #8)", async () => {
      // Why this test matters: the owner's complaint was notes DRIFTING
      // while authoring (plan 2026-09-28-0953 §1, §2.1). M5b re-judges the
      // latest sighting on every new fix so the move prompt sees the
      // refusal current; it once re-placed the earlier notes as a side
      // effect, so a GPS drift past the bound moved them from the code's
      // frame to their geo with no tap and no new look at the code. The
      // frame changes only on a sighting of the code (or an explicit
      // action), as before M5b; the per-fix re-judge feeds the prompt and
      // the panel only (creator-setup.ts.md "Earlier visits' objects").
      const a = await firstVisit();
      a.beginVisit();
      a.setAlignment(SECOND);
      a.seeTheCode();
      await flush();
      const atCode = new Vector3(2, 0, -1);
      expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeLessThan(1e-2);

      // The code leaves the view; GPS drifts 60 m, and fixes keep landing.
      a.ctx.lastDetectedText = null;
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      const fixes: unknown[] = [];
      for (let i = 0; i < MIN_ALIGNMENT_SAMPLES + 3; i += 1) {
        fixes.push({ latitude: ZERO.lat, longitude: ZERO.lon });
        a.setWalk({ fixes: [...fixes], odometry: fixes.map(() => [0, 0, 0]) });
        a.setup.renderAuthorReadout();
        expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeLessThan(1e-2);
      }
      // The re-judge still ran: the panel says the settle would refuse the
      // code through this alignment (what the move prompt reads).
      expect(a.dom.status.textContent).toMatch(/Code seen \d+ m/);

      // A new look at the code is what re-places them: through the drifted
      // alignment it is refused, so the note goes to its geo.
      a.seeTheCode();
      await flush();
      expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeGreaterThan(20);
      // At its geo in the SCENE (code book plan M1, a sampled mutant): the
      // frame moved back to the scene root, not left under the AR world
      // group with an identity matrix, which would put it 60 m off.
      const gate = a.ctx.placedObjects[0]!.object;
      const shown = [...a.labels].reverse().find((o) => o.name === "Gate")!;
      a.scene.updateMatrixWorld(true);
      expect(
        shown.getWorldPosition(new Vector3()).distanceTo(worldOf(gate.geo)),
      ).toBeLessThan(1e-3);
    });

    // Why this test matters (code book plan M5b): the earlier visits'
    // objects were drawn in ONE frame, the code in hand's - so with two
    // codes whose stored poses disagree (minted 8 degrees and 3 m apart in
    // GPS), the notes next to the other code were drawn off by that
    // disagreement during the whole visit. Each is drawn through the code
    // nearest it that this visit sighted.
    /**
     * Walk 1 measures A, places "Near A", then (the GPS moved 8 degrees and
     * 3 m, the odometry 20 m) measures B 20 m east and places "Near B":
     * two codes whose stored poses disagree. Walk 2 begins with a GPS
     * offset both codes' plausibility bound accepts.
     */
    async function twoCodesThenNextVisit() {
      const a = authoring();
      // A GPS extent of 59 m (every pick mature at its own moment), and an
      // odometry that stands still at A, then walks 20 m before B: each
      // note is tied to the code it was placed beside (D2).
      const fixes = Array.from({ length: 60 }, (_, i) => ({
        id: `fix-${String(i)}`,
        timestamp: 1_000 + i * 1000,
        coordinates: [i, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      const atA = { fixes, odometry: fixes.map(() => [0, 0, 0]) };
      const walked = Array.from({ length: 20 }, (_, i) => ({
        id: `walk-${String(i)}`,
        timestamp: 100_000 + i * 1000,
        coordinates: [59, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      const atB = {
        fixes: [...fixes, ...walked],
        odometry: [...atA.odometry, ...walked.map((_, i) => [i + 1, 0, 0])],
      };
      a.setWalk(atA);
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      a.setZero(ZERO);
      await a.mint();
      await a.placePin("Near A", [2, 0, -1]);
      // The GPS moves before code B is measured, 20 m away.
      a.setWalk(atB);
      a.setAlignment(yawAlignment(8, [3, 400, 0]));
      a.setZero(ZERO);
      const twentyAway = new Matrix4().makeTranslation(20, 0, 0);
      const SECOND_TEXT = "https://gps.csutil.com/tour/?qr=second";
      await a.mint(twentyAway, SECOND_TEXT, 10_000);
      // Odometry north/up/east: B is 20 m EAST (WebXR x), so beside it is
      // 2 m north and 21 m east.
      await a.placePin("Near B", [2, 0, 21]);
      a.endVisit();

      a.beginVisit();
      a.setWalk(atA);
      a.setAlignment(yawAlignment(4, [5, 400, 2]));
      a.setZero(ZERO);
      return { a, twentyAway, SECOND_TEXT };
    }

    // Why this test matters (M5b review #1): only a sighting of the code IN
    // HAND redrew the frames, so a walk that reached the other code saw its
    // notes drawn through the first code's frame. The order of the
    // sightings must not matter.
    it("draws each earlier note through its code whichever code is sighted first", async () => {
      const { a, twentyAway, SECOND_TEXT } = await twoCodesThenNextVisit();
      // B (in hand) first, then A.
      a.seeTheCode(twentyAway, SECOND_TEXT, 20_000);
      a.seeTheCode(undefined, TEXT, 30_000);
      await flush();
      expect(
        a.inWorldGroup("Near A").distanceTo(new Vector3(2, 0, -1)),
      ).toBeLessThan(1e-2);
      expect(
        a.inWorldGroup("Near B").distanceTo(new Vector3(2, 0, 21)),
      ).toBeLessThan(1e-2);
    });

    // Why this test matters (M5b review #3): drawing an object in another
    // frame re-rendered it - every earlier note blinked and every hosted
    // photo was read from the zip and decoded again at the code's first
    // sighting. It is moved, not rendered again.
    it("moves an earlier note into its code's frame without rendering it again", async () => {
      const { a } = await twoCodesThenNextVisit();
      const rendered = () => a.labels.filter((o) => o.name === "Near A").length;
      const before = rendered();
      expect(before).toBeGreaterThan(0);
      a.seeTheCode(undefined, TEXT, 30_000);
      await flush();
      expect(rendered()).toBe(before);
      expect(
        a.inWorldGroup("Near A").distanceTo(new Vector3(2, 0, -1)),
      ).toBeLessThan(1e-2);
    });

    // Why this test matters (M5b review #2; M5 design review #6): a code
    // MEASURED in this visit has no stored pose to correct through, so the
    // notes nearest it are drawn plainly from geo - not through a farther
    // code's correction.
    it("draws a note nearest a code measured in this visit plainly, not through a farther code", async () => {
      const { a, twentyAway, SECOND_TEXT } = await twoCodesThenNextVisit();
      a.seeTheCode(twentyAway, SECOND_TEXT, 20_000);
      await flush();
      // A new code C, measured where A hangs (A itself is not seen).
      await a.mint(undefined, "https://gps.csutil.com/tour/?qr=third", 40_000);
      await flush();
      const near = [...a.labels].reverse().find((o) => o.name === "Near A")!;
      a.scene.updateMatrixWorld(true);
      const gate = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "Near A",
      )!.object;
      expect(
        near.getWorldPosition(new Vector3()).distanceTo(worldOf(gate.geo)),
      ).toBeLessThan(1e-3);
    });

    it("draws each earlier note through the code nearest it that this visit sighted", async () => {
      const a = authoring();
      // A GPS extent of 59 m (every pick mature at its own moment), and an
      // odometry that stands still at A, then walks 20 m before B: each
      // note is tied to the code it was placed beside (D2).
      const fixes = Array.from({ length: 60 }, (_, i) => ({
        id: `fix-${String(i)}`,
        timestamp: 1_000 + i * 1000,
        coordinates: [i, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      const atA = { fixes, odometry: fixes.map(() => [0, 0, 0]) };
      const walked = Array.from({ length: 20 }, (_, i) => ({
        id: `walk-${String(i)}`,
        timestamp: 100_000 + i * 1000,
        coordinates: [59, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      const atB = {
        fixes: [...fixes, ...walked],
        odometry: [...atA.odometry, ...walked.map((_, i) => [i + 1, 0, 0])],
      };
      a.setWalk(atA);
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      a.setZero(ZERO);
      await a.mint();
      await a.placePin("Near A", [2, 0, -1]);
      // The GPS moves before code B is measured, 20 m away.
      a.setWalk(atB);
      a.setAlignment(yawAlignment(8, [3, 400, 0]));
      a.setZero(ZERO);
      const twentyAway = new Matrix4().makeTranslation(20, 0, 0);
      const SECOND_TEXT = "https://gps.csutil.com/tour/?qr=second";
      await a.mint(twentyAway, SECOND_TEXT, 10_000);
      // Odometry north/up/east: B is 20 m EAST (WebXR x), so beside it is
      // 2 m north and 21 m east.
      await a.placePin("Near B", [2, 0, 21]);
      a.endVisit();

      a.beginVisit();
      a.setWalk(atA);
      // This visit's GPS is off again, by an amount both codes' plausibility
      // bound accepts.
      a.setAlignment(yawAlignment(4, [5, 400, 2]));
      a.setZero(ZERO);
      a.seeTheCode(undefined, TEXT, 20_000);
      a.seeTheCode(twentyAway, SECOND_TEXT, 30_000);
      await flush();
      // Both codes sit at the same odometry spots in this visit, so each
      // note is back at the odometry spot it was placed at - through ITS
      // code, whichever code is in hand.
      expect(
        a.inWorldGroup("Near A").distanceTo(new Vector3(2, 0, -1)),
      ).toBeLessThan(1e-2);
      expect(
        a.inWorldGroup("Near B").distanceTo(new Vector3(2, 0, 21)),
      ).toBeLessThan(1e-2);
    });
  },
);

/**
 * Open a tour the Finish can write: a zip with an empty manifest, its load
 * settled. With `holdArchive` the Finish's whole-archive read waits until
 * `releaseArchive`, so a test can act while the rebuild is in flight.
 */
async function openFinishableTour(
  a: ReturnType<typeof authoring>,
  options: {
    holdArchive?: boolean;
    /** Level files the hosted zip already carries (`qr/<id>.json`). */
    levels?: readonly { id: string; json: string }[];
  } = {},
): Promise<{ releaseArchive: () => void }> {
  const levels = (options.levels ?? []).map((l) => ({
    path: `qr/${l.id}.json`,
    data: l.json,
  }));
  const blob = await packFilesAsZip([
    {
      path: "tour.json",
      data: serializeTourManifest(createEmptyTourManifest()),
    },
    ...levels,
  ]);
  const held: (() => void)[] = [];
  a.ctx.session = {
    archive: { url: "https://example.test/tour.zip", size: blob.size },
    hostedFileName: () => null,
    entries: [
      { filename: "tour.json" },
      ...levels.map((l) => ({ filename: l.path })),
    ],
    manifestWrap: "",
    integrity: { kind: "none" },
    readWholeArchive: () =>
      options.holdArchive === true
        ? new Promise<Blob>((resolve) => {
            held.push(() => {
              resolve(blob);
            });
          })
        : Promise.resolve(blob),
    loadEntry: (filename: string) =>
      Promise.resolve(
        new Blob([levels.find((l) => l.path === filename)?.data ?? ""]),
      ),
    loadEntryText: (filename: string) =>
      Promise.resolve(levels.find((l) => l.path === filename)?.data ?? ""),
  } as never;
  a.ctx.tourManifestStatus = "settled";
  a.ctx.tourManifest = createEmptyTourManifest();
  return {
    releaseArchive: () => {
      for (const release of held.splice(0)) release();
    },
  };
}

/** Wait for a Finish's async body to reach an end state (a real zip
 *  rebuild: polled, never a fixed count of turns). */
async function finished(ctx: {
  rebuiltZip: unknown;
  finishError: unknown;
}): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ctx.rebuiltZip !== null || ctx.finishError !== null) return;
  }
}

describe(
  "each visit settles once, and what arrives late joins its visit's settle (M2c review #1, #6)",
  { timeout: SLOW_MS },
  () => {
    const CAMERA: Pose = { position: [0.5, 1.4, -0.2], rotation: yawQ(90) };

    /** Where the settle puts a photo taken at `CAMERA` through `alignment`. */
    function settledPhotoAt(alignment: number[]): Vector3 {
      return new Vector3(
        ...throughAlignment(odomNueFromWebXr(CAMERA), alignment)!.position,
      );
    }

    it("a Finish tapped on the page, outside AR, does not stop the NEXT visit from settling", async () => {
      // Review #1: `arSessionGeneration` is bumped at a session's END, so
      // between visits it already holds the NEXT visit's number. A Finish on
      // the page marked that number "settled by Finish", and the next
      // visit's own session end then skipped its settle - its notes went
      // into the zip with tap-time geo.
      const a = authoring();
      await openFinishableTour(a);
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();

      a.beginVisit();
      a.seeTheCode();
      await flush();
      await a.placePin("Later", [3, 0, 1]);
      a.endVisit();

      expect(a.settledLogs().map((l) => l.payload.arVisitIndex)).toEqual([
        0, 1,
      ]);
    });

    it("settles a photo whose encode finished after its visit ended, through that visit's alignment", async () => {
      // Review #6: the photo's visit is taken at the tap, but the photo was
      // pushed after that visit's settle had run - minted through whatever
      // the store held by then (the teardown resets the alignment), and
      // never settled.
      const a = authoring();
      await a.mint();
      const end = yawAlignment(4, [1.5, 400.2, -1]);
      a.setAlignment(end);
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.endVisit();
      // The teardown's reset, then the next visit's GPS.
      a.setAlignment(yawAlignment(-20, [9, 398, 7]));
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();

      const photo = a.ctx.placedObjects.at(-1)!.object;
      expect(photo.kind).toBe("photo");
      expect(worldOf(photo.geo).distanceTo(settledPhotoAt(end))).toBeLessThan(
        1e-3,
      );
      const late = a.settledLogs().at(-1)!.payload;
      expect(late.trigger).toBe("late-arrival");
      expect(late.arVisitIndex).toBe(0);
      expect(late.usedAlignment).toEqual(end);
      expect(late.objects.map((o) => o.id)).toEqual([photo.id]);
    });

    it("settles a late photo of a visit that settled nothing else, through the code correction", async () => {
      // A visit that placed nothing and measured nothing has nothing to
      // settle at its end - but the alignment it WOULD settle through still
      // has to be kept for a photo still encoding.
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      a.endVisit();
      const first = yawAlignment(0, [0, 400, 0]);
      a.beginVisit();
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      a.seeTheCode();
      await flush();
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.endVisit();
      a.setAlignment(yawAlignment(-20, [9, 398, 7]));
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();

      const photo = a.ctx.placedObjects.at(-1)!.object;
      // The code sits at the same odometry spot in both visits here, so
      // the corrected alignment is the first visit's.
      expect(worldOf(photo.geo).distanceTo(settledPhotoAt(first))).toBeLessThan(
        1e-2,
      );
      expect(a.settledLogs().at(-1)!.payload.basis).toBe("code-corrected");
    });

    // Why this test matters (code book plan M5a, M4 milestone review #4):
    // a photo whose encode lands after the visit closed is minted through
    // the visit's END choice. That was the code in hand's - here B,
    // measured new - though the creator had walked back to stored A and
    // taken the photo there. It is the code seen last.
    it("settles a late photo through the code seen last, not the code in hand", async () => {
      const first = authoring();
      first.setAlignment(yawAlignment(0, [0, 400, 0]));
      await first.mint();
      first.endVisit();
      const stored = first.codes.inHand()!;

      const a = authoring();
      await openFinishableTour(a, { levels: [stored] });
      // As the tour's open sets them (`archive-open.ts`): the parsed levels
      // and their texts.
      a.ctx.currentLevels = new Map([
        [stored.id, parseQrLevel(JSON.parse(stored.json) as unknown)],
      ]);
      a.ctx.currentLevelTexts = new Map([[stored.id, stored.json]]);
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      // B, new: measured first, it takes the hand.
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      expect(a.codes.inHand()?.id).not.toBe(stored.id);
      // Back at A: seen last, then a photo still encoding as the visit ends.
      // A fresh page derives A's level id first (an async hash), so the
      // first look only identifies it; the second is the sighting.
      a.seeTheCode(undefined, TEXT, 20_000);
      await qrCodeId(TEXT);
      await new Promise((resolve) => setTimeout(resolve, 0));
      a.seeTheCode(undefined, TEXT, 30_000);
      await flush();
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.endVisit();
      a.setAlignment(yawAlignment(-20, [9, 398, 7]));
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();

      const late = a.settledLogs().at(-1)!.payload;
      expect(late.trigger).toBe("late-arrival");
      expect(late.basis).toBe("code-corrected");
      // The record names the code it went through, and that code's
      // sighting (M5a milestone review #2: nothing else pinned it).
      expect(late.referenceLevel?.id).toBe(stored.id);
      expect(late.sighting?.levelId).toBe(stored.id);
      const photo = a.ctx.placedObjects.at(-1)!.object;
      // A sits at the same odometry spot in both visits, so A's correction
      // is the first visit's alignment.
      expect(
        worldOf(photo.geo).distanceTo(
          settledPhotoAt(yawAlignment(0, [0, 400, 0])),
        ),
      ).toBeLessThan(1e-2);
    });

    it("after a Finish that failed, settles the running visit again at its end, with what was placed since", async () => {
      // The Finish settles at the tap; one that wrote no zip must not keep
      // the visit marked settled, or a pin placed after the failure would
      // keep its tap-time geo in the next Finish's zip.
      const a = authoring();
      await openFinishableTour(a);
      (
        a.ctx.session as unknown as { readWholeArchive: () => Promise<Blob> }
      ).readWholeArchive = () => Promise.reject(new Error("offline"));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).not.toBeNull();
      a.ctx.finishError = null;
      await a.placePin("Later", [3, 0, 1]);
      const end = yawAlignment(4, [1.5, 400.2, -1]);
      a.setAlignment(end);
      a.endVisit();

      const logs = a.settledLogs();
      expect(logs.map((l) => l.payload.trigger)).toEqual([
        "finish",
        "visit-end",
      ]);
      expect(logs[1]!.payload.usedAlignment).toEqual(end);
      expect(logs[1]!.payload.objects).toHaveLength(2);
    });

    it("keeps a photo that lands while a live Finish rebuilds the zip - settled, and left for the next Finish", async () => {
      // Review #6: the Finish emptied the whole placed list when its rebuild
      // landed, which wiped a photo pushed DURING the rebuild - it was in
      // neither the zip nor the list.
      const a = authoring();
      const tour = await openFinishableTour(a, { holdArchive: true });
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      const end = yawAlignment(4, [1.5, 400.2, -1]);
      a.setAlignment(end);
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.dom.finishButton.click(); // settles the running visit at the tap
      a.setAlignment(yawAlignment(-20, [9, 398, 7]));
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();
      tour.releaseArchive();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();

      const written = a.ctx.tourManifest!.objects.map((o) =>
        o.kind === "pin" ? o.label : o.id,
      );
      expect(written).toEqual(["Gate"]);
      expect(a.ctx.placedObjects.map((p) => p.object.kind)).toEqual(["photo"]);
      const photo = a.ctx.placedObjects[0]!.object;
      expect(worldOf(photo.geo).distanceTo(settledPhotoAt(end))).toBeLessThan(
        1e-3,
      );
      // One settle for the visit, plus the late photo's - the session end
      // the Finish caused did not settle the visit again.
      expect(a.settledLogs().map((l) => l.payload.trigger)).toEqual([
        "finish",
        "late-arrival",
      ]);
    });
  },
);

describe(
  "earlier objects wait for the zero (M2c review #4)",
  { timeout: SLOW_MS },
  () => {
    it("shows a restored object once the zero arrives, when the visit began without one", async () => {
      // Why this test matters: an object is placed from its geo, which needs
      // the zero - and the zero arrives with the first GPS fix, AFTER the
      // visit began on the first visit of a page load (a restored draft).
      // The preview returned early and nothing rendered it later, so the
      // creator saw an empty scene and placed the same notes again.
      const a = authoring();
      const old = mintPin({
        id: "old",
        label: "Old",
        worldNuePosition: { x: 4, y: 401, z: -2 },
        zero: ZERO,
        nowIso: "2026-09-30T10:00:00.000Z",
      })!;
      a.ctx.placedObjects = [{ object: old }];
      a.setZero(null);
      a.beginVisit();
      await flush();
      expect(a.labels.map((o) => o.name)).not.toContain("Old");

      a.setZero(ZERO);
      await flush();
      const shown = a.labels.filter((o) => o.name === "Old");
      expect(shown).toHaveLength(1);
      a.scene.updateMatrixWorld(true);
      expect(
        shown[0]!.getWorldPosition(new Vector3()).distanceTo(worldOf(old.geo)),
      ).toBeLessThan(1e-3);

      // Later dispatches do not render it a second time.
      a.setZero(ZERO);
      await flush();
      expect(a.labels.filter((o) => o.name === "Old")).toHaveLength(1);
    });
  },
);

describe(
  "a new measurement of a stored code corrects the visit, it does not replace the code (D10b, M2c review #5)",
  { timeout: SLOW_MS },
  () => {
    // GPS 20 m and 30 degrees away from the visit that stored the code.
    const SECOND = yawAlignment(30, [20, 401, -8]);

    /** The `kept` of the last `tourAuthoring/codeMeasured`. */
    function lastKept(a: ReturnType<typeof authoring>): unknown {
      const logs = a.dispatched.filter(
        (x) => x.type === "tourAuthoring/codeMeasured",
      ) as { payload: { kept: unknown } }[];
      return logs.at(-1)?.payload.kept;
    }

    /** A code measured and settled in a first visit, in its own page. */
    async function storedByAnEarlierPage(): Promise<{
      id: string;
      json: string;
    }> {
      const first = authoring();
      await first.mint();
      first.endVisit();
      return first.codes.inHand()!;
    }

    it("keeps an earlier visit's measurement as the reference when the code is seen again", async () => {
      // Why this test matters: "newest wins" re-minted the code through
      // the second visit's GPS, moving it away from the notes the first
      // visit had settled against it. Since U3 a stored code in hand is
      // not even re-measured: its sighting corrects the visit.
      const a = authoring();
      await a.mint();
      a.endVisit();
      const stored = a.codes.inHand()!;
      const codeLocal = mintedOdom(a.dispatched);
      a.beginVisit();
      a.setAlignment(SECOND);
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();

      expect(a.codes.inHand()).toEqual(stored);
      expect(
        a.dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured"),
      ).toHaveLength(1);
      await a.placePin("Later", [3, 0, 1]);
      a.endVisit();
      const last = a.settledLogs().at(-1)!.payload;
      expect(last.basis).toBe("code-corrected");
      expect(last.level).toBeNull();
      const offset = worldOf(a.ctx.placedObjects[0]!.object.geo).sub(
        codeWorldOf(stored.json),
      );
      expect(
        offset.distanceTo(new Vector3(3, 0, 1).sub(codeLocal)),
      ).toBeLessThan(1e-2);
    });

    // Why this test matters (code book plan M4 milestone review #1): a code
    // measured on this page that another code then took the hand from was
    // not "stored" to the measuring - only the code in hand and the hosted
    // ones were. A later visit measured it from scratch through ITS GPS,
    // replaced its saved pose, and left the notes the first visit placed
    // beside it behind by the two visits' GPS difference (here 20 m).
    it("keeps a code measured earlier on this page as the reference in a later visit, though another code is in hand", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      const codeLocal = mintedOdom(a.dispatched);
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      a.endVisit();
      await flush();
      const savedA = () =>
        (
          JSON.parse(String(files.get(META_KEY))) as {
            levels: { id: string; json: string }[];
          }
        ).levels[0]!;
      const stored = savedA();
      const measured = () =>
        a.dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured")
          .length;
      const before = measured();

      a.beginVisit();
      a.setAlignment(SECOND);
      a.seeTheCode(undefined, TEXT, 20_000);
      await flush();
      await a.placePin("Beside A", [3, 0, 1]);
      a.endVisit();
      await flush();

      expect(measured()).toBe(before);
      expect(savedA()).toEqual(stored);
      const pin = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "Beside A",
      )!.object;
      // Placed relative to the code as it was stored, not 20 m off.
      const offset = worldOf(pin.geo).sub(codeWorldOf(stored.json));
      expect(
        offset.distanceTo(new Vector3(3, 0, 1).sub(codeLocal)),
      ).toBeLessThan(1e-2);
    });

    it("keeps the hosted zip's code as the reference in a new page, and Finish writes it back unchanged", async () => {
      // Symptom B across sessions: a hosted tour opened in a new page must
      // be measured before Finish, and that measurement used to REPLACE
      // the hosted code's geo through this visit's GPS - while the hosted
      // notes kept the old frame.
      const hosted = await storedByAnEarlierPage();
      const a = authoring();
      await openFinishableTour(a, { levels: [hosted] });
      a.ctx.currentLevels = new Map([
        [hosted.id, parseQrLevel(JSON.parse(hosted.json) as unknown)],
      ]);
      a.setAlignment(SECOND);
      await a.mint();

      expect(a.codes.inHand()).toEqual(hosted);
      expect(lastKept(a)).toBe("hosted-level");
      // The panel says the saved position stays - never that it is replaced.
      expect(a.dom.status.textContent).toMatch(/Saved position kept/);
      expect(a.dom.status.textContent).not.toMatch(/replaces/);
      await a.placePin("Later", [3, 0, 1]);
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      const settle = a.settledLogs().at(-1)!.payload;
      expect(settle.basis).toBe("code-corrected");
      expect(settle.referenceLevel).toEqual(hosted);
      expect(settle.level).toBeNull();
      // What the zip carries for the code is the hosted file, byte for byte.
      expect(a.codes.inHand()!.json).toBe(hosted.json);
    });

    // Why this test matters (M5a milestone review #1): "Use this size" for
    // the stored code in hand empties the hand and starts measuring again
    // at the new size - the sightings before it were solved at a size now
    // known to be wrong. They stayed in the visit, and the settle (since it
    // settles the visit's codes with an empty hand) corrected the visit
    // through them. A one-code visit then settled differently from before;
    // with the stale sightings dropped it settles as before: plainly.
    it("does not correct the visit through sightings from before a size adoption", async () => {
      const hosted = await storedByAnEarlierPage();
      const a = authoring();
      await openFinishableTour(a, { levels: [hosted] });
      a.ctx.currentLevels = new Map([
        [hosted.id, parseQrLevel(JSON.parse(hosted.json) as unknown)],
      ]);
      a.ctx.currentLevelTexts = new Map([[hosted.id, hosted.json]]);
      a.setAlignment(SECOND);
      await a.mint();
      expect(lastKept(a)).toBe("hosted-level");
      // A pin placed while the code (at the old size) corrects the visit.
      await a.placePin("Before", [3, 0, 1]);
      // The print-size check offers a size for this code; it is adopted.
      a.ctx.printSizeCheck = {
        ...a.ctx.printSizeCheck!,
        offer: () => ({ text: TEXT, sizeM: 0.3 }),
        answer: () => undefined,
      };
      a.dom.sizeOfferUse.click();
      expect(a.codes.inHand()).toBeNull();
      a.endVisit();
      const settled = a.settledLogs().at(-1)!.payload;
      expect(settled.objects).toHaveLength(1);
      expect(settled.objects[0]?.basis).toBe("visit-alignment");
      expect(settled.basis).toBe("visit-alignment");
    });

    it("makes the new measurement the reference when the hosted level has no readable pose", async () => {
      const hosted = await storedByAnEarlierPage();
      const a = authoring();
      await openFinishableTour(a, {
        levels: [{ id: hosted.id, json: '{"old":true}' }],
      });
      a.setAlignment(SECOND);
      await a.mint();
      expect(lastKept(a)).toBe("measurement");
      expect(a.codes.inHand()!.json).not.toBe('{"old":true}');
      a.endVisit();
      expect(a.settledLogs().at(-1)!.payload.basis).toBe("measured-here");
    });

    it("measures a code once per visit: seeing it again does not re-measure it (UI round 1, U3)", async () => {
      // Why: measuring is automatic now; re-measuring on every sighting
      // would churn the code's pick and its level all visit long. The
      // settle refines nothing from later sightings of a code measured here
      // - it re-mints from the measurement through its own pick (D33).
      const a = authoring();
      await a.mint();
      const firstJson = a.codes.inHand()!.json;
      a.setAlignment(yawAlignment(3, [1, 400, 1]));
      a.seeTheCode();
      await flush();
      expect(
        a.dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured"),
      ).toHaveLength(1);
      expect(a.codes.inHand()!.json).toBe(firstJson);
    });
  },
);

describe(
  "the status line in AR is clamped to two lines, the whole of it a tap away (360x640)",
  { timeout: SLOW_MS },
  () => {
    // Why: the live readout joins up to five sentences (the code's status,
    // the measuring readout, the setup hint, the tour, the zip size). In AR
    // it sat above the controls and, on a 360x640 phone with the code's
    // re-measure offered and an object selected, pushed the last of them
    // below the first screen (ar-layout.spec.js). Clamped, it costs two
    // lines; a tap on it shows all of it, and nothing is dropped from the
    // text (screen readers and every assertion on it read the whole). The
    // page, where nothing is over a camera, is unclamped.
    it("clamps in AR, opens and closes on a tap, and is whole on the page", async () => {
      const a = authoring();
      await a.mint();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.dataset["clamped"]).toBe("true");
      expect(a.dom.status.textContent).toMatch(/Measured|Saved|saved/);
      a.dom.status.click();
      expect(a.dom.status.dataset["clamped"]).toBe("false");
      a.dom.status.click();
      expect(a.dom.status.dataset["clamped"]).toBe("true");
      a.dom.status.click();
      // A new visit starts clamped again; the page is never clamped.
      a.endVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.dataset["clamped"]).toBe("false");
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.status.dataset["clamped"]).toBe("true");
    });
  },
);

describe("the entry hint (§3.2a, D5)", { timeout: SLOW_MS }, () => {
  /** An open tour, as far as the panel's readout reads one. */
  function openTour(a: ReturnType<typeof authoring>): void {
    a.ctx.session = {
      archive: { url: "https://example.test/tour.zip", size: 2048 },
      entries: [],
      hostedFileName: () => null,
    } as never;
  }

  it("says first to point at the code, until this visit has seen it - and never blocks placing", async () => {
    const a = await (async () => {
      const b = authoring();
      openTour(b);
      await b.mint();
      await b.placePin("Gate", [2, 0, -1]);
      b.endVisit();
      return b;
    })();
    a.beginVisit();
    a.setup.renderAuthorReadout();
    expect(a.dom.status.textContent).toMatch(
      /^First, point the camera at the code you scanned to open this tour\./,
    );
    // Placing is not blocked while the hint shows (D5).
    expect(a.dom.pinButton.disabled).toBe(false);

    a.seeTheCode();
    await flush();
    expect(a.dom.status.textContent).not.toMatch(/First, point the camera/);
  });

  it("stays while only a DIFFERENT code is seen", async () => {
    const a = authoring();
    openTour(a);
    a.codes.setInHand({ id: "ffffffffffff", json: "{}" }, null);
    a.beginVisit();
    a.seeTheCode();
    await flush();
    expect(a.dom.status.textContent).toMatch(/First, point the camera/);
  });
});

describe(
  "editing placed objects, through the composed setup (authoring plan 2026-09-28-0953 §3.4, M4)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter (owner item 6: "create works; move, edit and
    // delete do not"): each action has to reach every place the object
    // lives - the in-memory list the Finish writes, the preview in AR, the
    // draft that survives a crash and the troubleshooting recording - and a
    // move has to go through the same code correction as the settle, or a
    // pin moved in a later visit lands where that visit's GPS says instead
    // of where the code says (symptom B through the editing door).

    /** A pin the hosted zip carries, at GPS-world NUE (north, 400, east). */
    function hostedPin(id: string, label: string, north = 4, east = 2) {
      return mintPin({
        id,
        label,
        worldNuePosition: { x: north, y: 400, z: east },
        zero: ZERO,
        nowIso: "2026-09-29T10:00:00.000Z",
      })!;
    }

    /** A creator in AR with a hosted tour open whose zip carries `objects`. */
    async function withHostedTour(
      objects: TourObject[],
      store?: DraftFileStore,
    ) {
      const a = authoring(store === undefined ? {} : { store });
      await openFinishableTour(a);
      a.ctx.tourManifest = { ...createEmptyTourManifest(), objects };
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      a.beginVisit();
      await flush();
      return a;
    }

    function logged(a: ReturnType<typeof authoring>, type: string) {
      return a.dispatched.filter((x) => x.type === type) as {
        payload: Record<string, unknown>;
      }[];
    }

    it("shows the hosted zip's objects in author mode, keyed by id, and lists them", async () => {
      const a = await withHostedTour([hostedPin("h1", "Hosted gate")]);
      expect(a.ctx.placedPreviews.has("h1")).toBe(true);
      expect(a.labels.some((o) => o.name === "Hosted gate")).toBe(true);
      // Listed on the page (in AR only a tapped object is shown).
      a.endVisit();
      a.setup.renderAuthorReadout();
      const model = a.dom.objectList.lastModel!;
      expect(model.rows.map((r) => [r.id, r.detail])).toEqual([
        ["h1", "Pin · in the zip"],
      ]);
    });

    it("edits a hosted pin's text in place: one record by id, a new label, a log with before and after", async () => {
      const a = await withHostedTour(
        [hostedPin("h1", "Hosted gate")],
        memoryDraftStore().store,
      );
      a.dom.objectList.listHandlers!.editText("h1", "  The old mill ");
      await flush();
      expect(a.ctx.placedObjects.map((p) => p.object)).toEqual([
        { ...hostedPin("h1", "Hosted gate"), label: "The old mill" },
      ]);
      expect(a.labels.some((o) => o.name === "The old mill")).toBe(true);
      expect(a.ctx.placedPreviews.size).toBe(1);
      const log = logged(a, "tourAuthoring/objectEdited").at(-1)!.payload;
      expect((log["before"] as { label: string }).label).toBe("Hosted gate");
      expect((log["after"] as { label: string }).label).toBe("The old mill");
      expect(log["surface"]).toBe("ar");
      expect(a.dom.objectList.lastModel?.note).toMatch(/Saved "The old mill"/);
      // An empty text changes nothing.
      a.dom.objectList.listHandlers!.editText("h1", "   ");
      expect(a.ctx.placedObjects[0]?.object).toMatchObject({
        label: "The old mill",
      });
    });

    it("shows the edit as in progress until the draft write lands, then says whether it did", async () => {
      // The async-UI rule: an in-progress state, then the durable end
      // state - and a refused write said, never swallowed.
      const { store, files } = memoryDraftStore();
      const held: (() => void)[] = [];
      let refuse = false;
      const slow: DraftFileStore = {
        ...store,
        put: (key, data) =>
          new Promise<boolean>((resolve) => {
            held.push(() => {
              files.set(key, data);
              resolve(!refuse);
            });
          }),
      };
      const a = await withHostedTour([hostedPin("h1", "Gate")], slow);
      const release = async () => {
        for (const r of held.splice(0)) r();
        await flush();
      };
      await release();
      // Selected in AR, so its row is the one shown.
      a.pick.fn = () => "h1";
      a.setup.selectInView(null);
      a.dom.objectList.listHandlers!.editText("h1", "First");
      await flush();
      const busy = a.dom.objectList.lastModel!.rows[0]!;
      expect([busy.busy, busy.enabled]).toEqual(["Saving…", false]);
      await release();
      const done = a.dom.objectList.lastModel!;
      expect(done.rows[0]?.busy).toBeNull();
      expect(done.note).toMatch(/Saved "First"/);

      refuse = true;
      a.dom.objectList.listHandlers!.editText("h1", "Second");
      await flush();
      await release();
      expect(a.dom.objectList.lastModel?.note).toMatch(
        /could not save a backup copy/,
      );
    });

    it("deletes a hosted pin as a tombstone: gone from the scene and the list, recorded in the draft and the log", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], store);
      a.dom.objectList.listHandlers!.remove("h1");
      await flush();
      expect(a.ctx.deletedObjectIds).toEqual(["h1"]);
      expect(a.ctx.placedPreviews.has("h1")).toBe(false);
      expect(files.has(deletedKey("h1"))).toBe(true);
      expect(a.dom.objectList.lastModel?.rows).toEqual([]);
      expect(a.dom.objectList.lastModel?.note).toMatch(
        /Deleted "Gate" - it leaves the zip on the next Finish/,
      );
      const log = logged(a, "tourAuthoring/objectDeleted").at(-1)!.payload;
      expect(log["hosted"]).toBe(true);
    });

    it("deletes a pin placed on this device outright - no tombstone, its draft file gone", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([], store);
      await a.mint();
      await a.placePin("Temp", [1, 0, 1]);
      const id = a.ctx.placedObjects.at(-1)!.object.id;
      expect(files.has(objectKey(id))).toBe(true);
      a.dom.objectList.listHandlers!.remove(id);
      await flush();
      expect(a.ctx.placedObjects).toEqual([]);
      expect(a.ctx.deletedObjectIds).toEqual([]);
      expect(files.has(objectKey(id))).toBe(false);
    });

    it("moves an earlier visit's pin to the reticle through the code correction, as the settle would", async () => {
      // D10b for editing: the second visit's GPS is 20 m and 30 degrees
      // off; the moved pin must land where the CODE says.
      //
      // And the second session's odometry origin is somewhere else (M4
      // review #8): each WebXR session has its own, so with the code at
      // the same odometry pose in both visits a move through the MEASURING
      // visit's code pose instead of this visit's sighting would pass.
      // Turned 70 degrees and moved 8 m, as the cross-visit settle test.
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      const codeLocal = mintedOdom(a.dispatched);
      const gate = a.ctx.placedObjects[0]!.object;
      const origin = new Matrix4().compose(
        new Vector3(4, -0.3, -7),
        new Quaternion(...yawQ(70)),
        new Vector3(1, 1, 1),
      );
      const originNue = new Matrix4()
        .copy(WEBXR_TO_NUE)
        .multiply(origin)
        .multiply(new Matrix4().copy(WEBXR_TO_NUE).invert());
      a.beginVisit();
      a.setAlignment(
        new Matrix4()
          .fromArray(yawAlignment(30, [20, 401, -8]))
          .multiply(originNue.clone().invert())
          .toArray(),
      );
      a.seeTheCode(origin);
      await flush();
      // The physical spot at odometry-NUE [4, 0, 2] of the FIRST session,
      // as this session's odometry reads it.
      const spotRaw: Pose = { position: [2, 0, -4], rotation: [0, 0, 0, 1] };
      expect(odomNueFromWebXr(spotRaw).position).toEqual([4, 0, 2]);
      const spot2 = odomNueFromWebXr(inOrigin(spotRaw, origin)).position;
      a.setReticle([...spot2]);
      a.dom.objectList.listHandlers!.move(gate.id);
      await flush();

      const moved = a.ctx.placedObjects[0]!.object;
      expect(moved.id).toBe(gate.id);
      const offset = worldOf(moved.geo).sub(
        codeWorldOf(a.codes.inHand()!.json),
      );
      expect(
        offset.distanceTo(new Vector3(4, 0, 2).sub(codeLocal)),
      ).toBeLessThan(1e-2);
      const log = logged(a, "tourAuthoring/objectMoved").at(-1)!.payload;
      expect(log["basis"]).toBe("code-corrected");
      const reticle = log["reticleOdomNue"] as number[];
      spot2.forEach((v, i) => {
        expect(reticle[i]).toBeCloseTo(v, 9);
      });
      expect(log["sighting"]).not.toBeNull();
      // Rigid in AR now, like a new placement - and the visit's own settle
      // keeps it where the move put it.
      expect(
        a.inWorldGroup("Gate").distanceTo(new Vector3(...spot2)),
      ).toBeLessThan(1e-6);
      a.endVisit();
      expect(
        worldOf(a.ctx.placedObjects[0]!.object.geo).distanceTo(
          worldOf(moved.geo),
        ),
      ).toBeLessThan(1e-2);
    });

    it("selects what a tap in AR hits among the rendered objects, and clears the selection on a miss", async () => {
      const a = await withHostedTour([hostedPin("h1", "Gate")]);
      let seen: ReadonlyMap<string, Object3D> | null = null;
      let seenTap: unknown = "not called";
      a.pick.fn = (targets, tap) => {
        seen = targets;
        seenTap = tap;
        return targets.has("h1") ? "h1" : null;
      };
      // Where the tap pointed (M4 review #4), as the reticle driver hands
      // it: the pick casts through the tapped point, not the screen centre.
      const tap = {
        targetRayInViewer: new Matrix4().makeRotationY(0.1).toArray(),
      };
      a.setup.selectInView(tap);
      // The ray is cast against each object's rendered root.
      expect(seen!.get("h1")).toBe(a.ctx.placedPreviews.get("h1")!.root);
      expect(seenTap).toBe(tap);
      const model = a.dom.objectList.lastModel!;
      expect(model.rows.map((r) => [r.id, r.selected, r.canMove])).toEqual([
        ["h1", true, true],
      ]);
      a.pick.fn = () => null;
      a.setup.selectInView(null);
      expect(a.dom.objectList.lastModel!.rows).toEqual([]);
    });

    it("steps the selection through every object with the chooser, wrapping, and moves the one it reached (M4 review #4)", async () => {
      // Why: a tap cannot reach an object that is too far, too small or
      // behind another, and Move acts on the selection in AR only - the
      // chooser is how such an object is still selected and moved.
      const a = await withHostedTour([
        hostedPin("h1", "Gate"),
        hostedPin("h2", "Mill"),
        hostedPin("h3", "Oak"),
      ]);
      await a.mint();
      const list = a.dom.objectList;
      const selected = () => list.lastModel!.rows.map((r) => r.id);
      list.listHandlers!.step(1);
      expect(selected()).toEqual(["h1"]);
      expect(list.lastModel!.chooser).toEqual({
        position: "1 of 3",
        inRow: true,
      });
      list.listHandlers!.step(1);
      expect(selected()).toEqual(["h2"]);
      list.listHandlers!.step(-1);
      list.listHandlers!.step(-1);
      expect(selected(), "wraps from the first to the last").toEqual(["h3"]);
      list.listHandlers!.step(1);
      expect(selected(), "and from the last to the first").toEqual(["h1"]);
      // Nothing selected (a tap on empty scene): Previous starts at the last.
      a.pick.fn = () => null;
      a.setup.selectInView(null);
      list.listHandlers!.step(-1);
      expect(selected()).toEqual(["h3"]);

      a.setReticle([4, 0, 2]);
      list.listHandlers!.move("h3");
      await flush();
      expect(list.lastModel?.note).toMatch(/^Moved "Oak"/);
      expect(
        a.ctx.placedObjects.find((p) => p.object.id === "h3")?.placement?.local
          .position,
      ).toEqual([4, 0, 2]);
    });

    it("cancels the XR select of a tap on the panel, so Delete does not also select what is behind it", () => {
      // What this pins (M4 review #8): the cancelling listener is the
      // PANEL's - the overlay element every control of the setup sits in -
      // and no other element's, so a listener moved to, say, the controls
      // row (which the object list is not in) fails here. That the
      // object list's buttons really sit inside the panel, so their
      // `beforexrselect` bubbles to it, is DOM layout this fake cannot
      // see: the e2e "a tap in AR selects the object under the ring, a tap
      // on the panel does not, and Move takes the pin to the reticle"
      // (object-editing.spec.js) dispatches the event at the Delete button
      // and asserts no select fired.
      const a = authoring();
      const listening = (
        Object.entries(a.dom) as [string, { listens(type: string): boolean }][]
      )
        .filter(([, element]) => element.listens("beforexrselect"))
        .map(([key]) => key);
      expect(listening).toEqual(["panel"]);
      let prevented = false;
      a.dom.panel.fire("beforexrselect", {
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented).toBe(true);
    });

    // Why these tests matter (M4 review #5 and #6): Delete had no confirm
    // and no undo, so one mis-tap in AR - where the panel shares the screen
    // with the scene - lost a hosted note until the creator re-made it. And
    // the async-UI rule (CLAUDE.md) asks for the in-progress state and the
    // failure branch of every draft write, which only the edit had tests
    // for; in AR the outcome also vanished at the next tap, before it could
    // be read.

    it("offers Undo after deleting a hosted pin, and Undo brings it back to the list, the scene, the draft and the log", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], store);
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.undo).toBe(true);
      expect(files.has(deletedKey("h1"))).toBe(true);

      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.deletedObjectIds).toEqual([]);
      expect(a.ctx.placedPreviews.has("h1")).toBe(true);
      expect(files.has(deletedKey("h1")), "the tombstone is gone").toBe(false);
      expect(list.lastModel?.note).toMatch(/Restored "Gate"/);
      expect(list.lastModel?.undo).toBe(false);
      const log = logged(a, "tourAuthoring/objectDeleteUndone").at(-1)!.payload;
      expect(log["hosted"]).toBe(true);
    });

    it("undoes the delete of an edited hosted pin WITH its edit, and of a pin placed on this device with its record", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], store);
      const list = a.dom.objectList;
      list.listHandlers!.editText("h1", "Mill");
      await flush();
      list.listHandlers!.remove("h1");
      await flush();
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.placedObjects.map((p) => p.object)).toMatchObject([
        { id: "h1", label: "Mill" },
      ]);
      expect(JSON.parse(String(files.get(objectKey("h1"))))).toMatchObject({
        label: "Mill",
      });
      expect(files.has(deletedKey("h1"))).toBe(false);

      await a.mint();
      await a.placePin("Temp", [1, 0, 1]);
      const id = a.ctx.placedObjects.at(-1)!.object.id;
      list.listHandlers!.remove(id);
      await flush();
      expect(files.has(objectKey(id))).toBe(false);
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.placedObjects.map((p) => p.object.id)).toEqual(["h1", id]);
      expect(files.has(objectKey(id)), "its record is written back").toBe(true);
    });

    it(`withdraws Undo after ${String(OUTCOME_HOLD_MS)} ms, and an expired Undo restores nothing`, async () => {
      const a = await withHostedTour([hostedPin("h1", "Gate")]);
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.undo).toBe(true);
      expect(a.timers.at(-1)?.ms).toBe(OUTCOME_HOLD_MS);
      a.fireTimers();
      expect(list.lastModel?.undo).toBe(false);
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.deletedObjectIds).toEqual(["h1"]);
    });

    it("shows Deleting… until the draft write lands, then the outcome - and says so when the write is refused or throws", async () => {
      const slow = slowDraftStore();
      const a = await withHostedTour(
        [
          hostedPin("h1", "Gate"),
          hostedPin("h2", "Mill"),
          hostedPin("h3", "Oak"),
        ],
        slow.store,
      );
      await slow.release();
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.note).toBe('Deleting "Gate"…');
      expect(list.lastModel?.undo, "no Undo before the outcome").toBe(false);
      await slow.release();
      expect(list.lastModel?.note).toMatch(
        /^Deleted "Gate" - it leaves the zip/,
      );

      slow.mode.refuse = true;
      list.listHandlers!.remove("h2");
      await flush();
      await slow.release();
      expect(list.lastModel?.note).toMatch(
        /^Deleted "Mill", but this device could not save a backup copy/,
      );

      slow.mode.refuse = false;
      slow.mode.reject = true;
      list.listHandlers!.remove("h3");
      await flush();
      await slow.release();
      expect(list.lastModel?.note).toMatch(
        /^Deleted "Oak", but this device could not save a backup copy/,
      );
    });

    it("shows Moving… on the row until the draft write lands, then the outcome - and says so when the write is refused", async () => {
      const slow = slowDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], slow.store);
      await slow.release();
      await a.mint();
      await slow.release();
      const list = a.dom.objectList;
      a.pick.fn = () => "h1";
      a.setup.selectInView(null);
      a.setReticle([4, 0, 2]);
      list.listHandlers!.move("h1");
      await flush();
      const busy = list.lastModel!.rows[0]!;
      expect([busy.busy, busy.enabled]).toEqual(["Moving…", false]);
      await slow.release();
      expect(list.lastModel!.rows[0]?.busy).toBeNull();
      expect(list.lastModel?.note).toMatch(/^Moved "Gate" to the ring/);

      slow.mode.refuse = true;
      a.setReticle([5, 0, 2]);
      list.listHandlers!.move("h1");
      await flush();
      await slow.release();
      expect(list.lastModel?.note).toMatch(
        /^Moved "Gate", but this device could not save a backup copy/,
      );
    });

    it(`keeps an outcome through a tap that only selects, for ${String(OUTCOME_HOLD_MS)} ms`, async () => {
      const a = await withHostedTour(
        [hostedPin("h1", "Gate"), hostedPin("h2", "Mill")],
        memoryDraftStore().store,
      );
      const list = a.dom.objectList;
      list.listHandlers!.editText("h1", "The old mill");
      await flush();
      expect(list.lastModel?.note).toMatch(/Saved "The old mill"/);
      // The creator's next tap in AR selects something else at once.
      a.pick.fn = () => "h2";
      a.setup.selectInView(null);
      expect(list.lastModel?.note).toMatch(/Saved "The old mill"/);
      a.fireTimers();
      a.setup.selectInView(null);
      expect(list.lastModel?.note).toBe("");
    });
  },
);

describe(
  "the code's saved position, decided at the settle (UI round 1, U3)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: the measure and replace buttons are gone, so
    // the settle alone decides whether this visit's view of a STORED code
    // replaces its saved position. A wrong replace turns the whole tour for
    // every visitor placed by GPS (the r778 field recording: a standing
    // re-measure turned it 41 degrees); a replace that leaves the nearby
    // pins behind shifts them against the poster; a real move must leave
    // the pins at their landmarks (D19).
    const T0 = 1_756_150_000_000;

    /** `n` one-second device fixes spread `spanM` north (the extent the
     *  rule reads), in the store's own shape. */
    function walkOf(n: number, spanM: number) {
      const fixes = Array.from({ length: n }, (_, i) => ({
        id: `fix-${String(i)}`,
        timestamp: T0 + i * 1000,
        coordinates: [(spanM * i) / Math.max(1, n - 1), 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      return { fixes, odometry: fixes.map(() => [0, 0, 0]) };
    }

    /**
     * A first visit measures the code and places a pin next to it and one
     * 60 m away; the second visit sees the stored code through an
     * alignment `yawDeg` turned and `northM` shifted, at `accuracyM`, and
     * walks `walkM`.
     */
    async function secondVisit(opts: {
      yawDeg: number;
      northM: number;
      walkM: number;
      accuracyM?: number;
    }) {
      const a = authoring();
      await a.mint();
      await a.placePin("near", [2, 0, -1]);
      await a.placePin("far", [60, 0, 0]);
      a.endVisit();
      const stored = a.codes.inHand()!;
      const pins = () =>
        new Map(
          a.ctx.placedObjects.map((p) => [
            p.object.kind === "pin" ? p.object.label : p.object.id,
            p.object.geo,
          ]),
        );
      const before = pins();
      a.beginVisit();
      a.setAccuracy(opts.accuracyM ?? 5);
      a.setAlignment(yawAlignment(opts.yawDeg, [opts.northM, 400, 0]));
      a.setWalk(walkOf(30, opts.walkM));
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();
      return { a, stored, before, pins };
    }

    function codePosition(a: ReturnType<typeof authoring>) {
      const settled = a.dispatched.filter(
        (x) => x.type === "tourAuthoring/settled",
      );
      return (
        settled.at(-1)?.payload as {
          codePosition?: {
            decision: { kind: string; reason?: string };
            applied: boolean;
            movedWithCode: { id: string }[];
          };
        }
      ).codePosition;
    }

    /** Every code-position decision of the last settle (M5c). */
    function codePositions(a: ReturnType<typeof authoring>) {
      const settled = a.dispatched.filter(
        (x) => x.type === "tourAuthoring/settled",
      );
      return (
        (
          settled.at(-1)?.payload as {
            codePositions?: {
              levelId: string;
              decision: { kind: string };
              applied: boolean;
              movedWithCode: { id: string }[];
            }[];
          }
        ).codePositions ?? []
      );
    }

    /**
     * A first visit measures A, places "near A" and "between" (2 m from A,
     * 18 m from B), then B 20 m east with "near B"; the second visit sees
     * both stored codes through an alignment 20 degrees turned and 3 m
     * shifted, after a reliable 30 m walk.
     */
    async function twoStoredCodesSeenAgain(options: { onlyA?: boolean } = {}) {
      const a = authoring();
      await a.mint();
      await a.placePin("near A", [2, 0, -1]);
      // Near the bisector of A and B (about 10 m from A, 11 m from B): A's
      // correction can carry it past the bisector (M5c review #1).
      await a.placePin("between", [-2, 0, 9.5]);
      const twentyAway = new Matrix4().makeTranslation(20, 0, 0);
      const SECOND_TEXT = "https://gps.csutil.com/tour/?qr=second";
      await a.mint(twentyAway, SECOND_TEXT, 10_000);
      await a.placePin("near B", [2, 0, 21]);
      a.endVisit();
      const pins = () =>
        new Map(
          a.ctx.placedObjects.map((p) => [
            p.object.kind === "pin" ? p.object.label : p.object.id,
            p.object.geo,
          ]),
        );
      const before = pins();
      a.beginVisit();
      a.setAccuracy(5);
      a.setAlignment(yawAlignment(20, [3, 400, 0]));
      a.setWalk(walkOf(30, 30));
      a.seeTheCode(undefined, TEXT, 20_000);
      if (options.onlyA !== true) {
        a.seeTheCode(twentyAway, SECOND_TEXT, 30_000);
      }
      await flush();
      return { a, before, pins };
    }

    // Why this test matters (code book plan M5c): the position of a stored
    // code was decided for the code IN HAND only, so a creator who walked
    // past two posters improved one of them. Every stored code the visit
    // saw gets its own decision.
    it("decides the saved position of every stored code the visit saw", async () => {
      const { a } = await twoStoredCodesSeenAgain();
      a.endVisit();
      const decisions = codePositions(a);
      expect(decisions).toHaveLength(2);
      expect(decisions.map((d) => d.decision.kind)).toEqual([
        "replace",
        "replace",
      ]);
      expect(decisions.every((d) => d.applied)).toBe(true);
      // Each re-minted through its OWN sighting and pick in one reliable
      // alignment: still the 20 m apart they hang (M5c review #5 - a wrong
      // sighting or pick would not keep this).
      const levels = a.settledLogs().at(-1)!.payload.levels ?? [];
      expect(levels).toHaveLength(2);
      expect(
        codeWorldOf(levels[0]!.json).distanceTo(codeWorldOf(levels[1]!.json)),
      ).toBeCloseTo(20, 0);
    });

    // Why this test matters (M5 design review #7): with two improved codes
    // a pin within reach of both was taken along twice. Each object goes
    // with the one code it belongs to (the nearest, before the settle).
    it("takes each earlier pin along with one improved code only", async () => {
      const { a } = await twoStoredCodesSeenAgain();
      a.endVisit();
      const moved = codePositions(a).flatMap((d) =>
        d.movedWithCode.map((m) => m.id),
      );
      expect(new Set(moved).size).toBe(moved.length);
      const between = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "between",
      )!.object.id;
      expect(moved.filter((id) => id === between)).toHaveLength(1);
    });

    // Why this test matters (M5c; my wording choice): with several codes
    // the result screen says which code's position changed.
    // Why this test matters (M5c review #2): the line named its code only
    // when two codes decided - in a tour of several codes where one
    // improved, the creator could not tell which.
    it("names the code on the result screen whenever the tour has several, even if one decided", async () => {
      const { a } = await twoStoredCodesSeenAgain({ onlyA: true });
      await openFinishableTour(a);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.dom.finishStatus.textContent).toMatch(/Code \d: /);
    });

    it("names each code on the result screen when the tour has several", async () => {
      const { a } = await twoStoredCodesSeenAgain();
      await openFinishableTour(a);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.dom.finishStatus.textContent).toMatch(/Code 1: /);
      expect(a.dom.finishStatus.textContent).toMatch(/Code 2: /);
    });

    it("replaces a stored position of unknown quality after a reliable walk, and takes the pin next to the code along", async () => {
      const { a, stored, before, pins } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      a.endVisit();
      expect(a.codes.inHand()?.id).toBe(stored.id);
      expect(a.codes.inHand()?.json).not.toBe(stored.json);
      expect(codePosition(a)?.decision).toEqual({ kind: "replace" });
      expect(codePosition(a)?.applied).toBe(true);
      const after = pins();
      // The near pin keeps its place relative to the code...
      const oldCode = codeWorldOf(stored.json);
      const newCode = codeWorldOf(a.codes.inHand()!.json);
      const near0 = worldOf(before.get("near")!).sub(oldCode);
      const near1 = worldOf(after.get("near")!).sub(newCode);
      expect(near1.length()).toBeCloseTo(near0.length(), 2);
      expect(
        worldOf(after.get("near")!).distanceTo(worldOf(before.get("near")!)),
      ).toBeGreaterThan(0.5);
      // ...and the pin 60 m away keeps its GPS position (the owner's 40 m).
      expect(after.get("far")).toEqual(before.get("far"));
      expect(codePosition(a)?.movedWithCode).toHaveLength(1);
    });

    // Why this test matters (code book plan M4b, the owner's choice after
    // the M3 sweep): an improved code took every pin within 40 m along,
    // including pins that belong to ANOTHER code nearby - dragging them off
    // that code. A pin nearer another code of the tour stays put.
    it("leaves a pin nearer another code of the tour where it is", async () => {
      const { a, stored, before, pins } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      // A second code of the tour stands right at the near pin.
      a.ctx.currentLevels = new Map([
        [
          "other0000001",
          {
            version: 1,
            qr: {
              text: "https://example.invalid/?qr=other",
              physicalSizeM: 0.16,
              geo: { ...before.get("near")!, rotation: [0, 0, 0, 1] },
            },
          } as never,
        ],
      ]);
      a.endVisit();
      expect(a.codes.inHand()?.json).not.toBe(stored.json);
      expect(codePosition(a)?.applied).toBe(true);
      expect(pins().get("near")).toEqual(before.get("near"));
      expect(codePosition(a)?.movedWithCode).toHaveLength(0);
    });

    it("moves a pin the hosted zip carries too, as an edit by id the Finish writes", async () => {
      // Why: in the field the pins near the code come from the tour file,
      // not from this page's earlier visits; they must move the same way.
      const { a, before } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      const hosted = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "near",
      )!.object;
      a.ctx.placedObjects = a.ctx.placedObjects.filter(
        (p) => p.object.id !== hosted.id,
      );
      a.ctx.tourManifest = {
        ...createEmptyTourManifest(),
        objects: [hosted],
      };
      a.endVisit();
      const edit = a.ctx.placedObjects.find((p) => p.object.id === hosted.id);
      expect(edit, "an edit by id in placedObjects").toBeDefined();
      expect(edit!.object.geo).not.toEqual(before.get("near"));
      expect(edit!.placement).toBeUndefined();
    });

    it("keeps the stored position for a standing re-measure (R1: too little walking for the GPS accuracy)", async () => {
      const { a, stored, before, pins } = await secondVisit({
        yawDeg: 41,
        northM: 0.9,
        walkM: 6,
        accuracyM: 7,
      });
      a.endVisit();
      expect(a.codes.inHand()).toEqual(stored);
      expect(codePosition(a)?.decision).toMatchObject({
        kind: "keep",
        reason: "not-walked",
      });
      expect(pins()).toEqual(before);
    });

    it("keeps a stored position whose own walk was good, however well this visit walked", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 10,
        northM: 2,
        walkM: 30,
      });
      a.endVisit();
      const improved = a.codes.inHand()!;
      expect(improved.json).not.toBe(stored.json);
      // A third visit: the improved position recorded its walk (D31) and
      // stays.
      a.beginVisit();
      a.setAlignment(yawAlignment(-10, [1, 400, 0]));
      a.setWalk(walkOf(30, 30));
      a.seeTheCode();
      await flush();
      a.endVisit();
      expect(a.codes.inHand()).toEqual(improved);
      expect(codePosition(a)?.decision).toEqual({
        kind: "keep",
        reason: "stored-good",
      });
    });

    // Why this test matters (code book plan M4 milestone review #2): since
    // M4c-3 a stored code is solved at the size the tour stores for it, but
    // a replaced position was re-minted at the size FIELD's value. A tour
    // printed at 0.30 m, opened in a page whose field says 0.16, got a pose
    // solved at 0.30 written into a level labelled 0.16 - and visitors
    // solving at 0.16 put the code at about half its true distance.
    it("re-mints a replaced stored code at the size it was solved at, not the size field's", async () => {
      const first = authoring();
      await first.mint();
      first.endVisit();
      const earlier = first.codes.inHand()!;
      const parsed = JSON.parse(earlier.json) as {
        qr: { physicalSizeM: number };
      };
      parsed.qr.physicalSizeM = 0.3;
      const hosted = { id: earlier.id, json: JSON.stringify(parsed) };

      const a = authoring();
      await openFinishableTour(a, { levels: [hosted] });
      a.ctx.currentLevels = new Map([[hosted.id, parseQrLevel(parsed)]]);
      expect(a.ctx.activeSizeM).not.toBeCloseTo(0.3, 3);
      a.setAccuracy(5);
      a.setAlignment(yawAlignment(20, [3, 400, 0]));
      a.setWalk(walkOf(30, 30));
      await a.mint();
      a.endVisit();

      expect(codePosition(a)?.decision).toEqual({ kind: "replace" });
      const replaced = parseQrLevel(
        JSON.parse(a.codes.inHand()!.json) as unknown,
      );
      expect(replaced.qr.physicalSizeM).toBeCloseTo(0.3, 9);
    });

    it("says on the result screen why the position was kept", async () => {
      const a = authoring();
      await openFinishableTour(a);
      await a.mint();
      a.endVisit();
      a.beginVisit();
      a.setAccuracy(5);
      a.setWalk(walkOf(30, 4));
      a.seeTheCode();
      await flush();
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      expect(a.dom.finishStatus.textContent).toMatch(
        // 4 m walked against the 24 m that 5 m accuracy needs.
        /The code's saved position was kept: this visit's walk was about 20 m too short for the GPS accuracy to improve it\./,
      );
    });
  },
);

describe(
  "the summary after Finish: every visit kept page-side and in the draft (authoring plan 2026-09-28-0953 M3b)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: the store wipes a visit's walk and alignment
    // at its end, so unless the settle copies them out the summary after
    // Finish has nothing to judge - and the owner's question ("should I go
    // back and scan more?") is answered from ONE visit at best. The code
    // must reach the log through each visit's OWN alignment: the settle's
    // code-corrected one would just repeat the stored pose and fake an
    // agreement between visits.
    const TOUR = "https://example.test/tour.zip";

    /** A walk 30 m North and back, one device fix per metre, 3-7 m GPS. */
    function walk(): { fixes: unknown[]; odometry: number[][] } {
      const fixes: unknown[] = [];
      const odometry: number[][] = [];
      for (let i = 0; i <= 60; i += 1) {
        const n = i <= 30 ? i : 60 - i;
        fixes.push({
          latitude: ZERO.lat + (n / 6_371_000) * (180 / Math.PI),
          longitude: ZERO.lon,
          latLongAccuracy: 3 + (i % 5),
        });
        odometry.push([n, 0, 0]);
      }
      return { fixes, odometry };
    }

    function summaryFake() {
      const shown: SummaryModel[] = [];
      let hidden = 0;
      return {
        shown,
        hidden: () => hidden,
        show: (model: SummaryModel) => {
          shown.push(model);
        },
        hide: () => {
          hidden += 1;
        },
      };
    }

    /** The code's geo through `alignment`, as a visit's log must hold it. */
    function codeThrough(alignment: number[], origin?: Matrix4) {
      const world = throughAlignment(
        odomNueFromWebXr(inOrigin(TRUE_CODE, origin)),
        alignment,
      )!;
      return mintQrGeoPose({
        worldNuePosition: {
          x: world.position[0],
          y: world.position[1],
          z: world.position[2],
        },
        worldNueRotation: [...world.rotation],
        zero: ZERO,
      });
    }

    it("logs each visit at its settle, through its own alignment, into the draft, and the Finish summarises both", async () => {
      const { store, files } = memoryDraftStore();
      const summary = summaryFake();
      const a = authoring({ store, summary });
      await openFinishableTour(a);
      a.setup.presentDraftForTour(TOUR);
      await flush();
      a.setWalk(walk());

      // Visit 1 measures the code and places a pin.
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      const first = a.codes.inHand();
      a.endVisit();
      await flush();

      // Visit 2: its own odometry origin and another GPS alignment; it
      // only SEES the code, so its settle is code-corrected - but its log
      // must hold the code through its PLAIN alignment.
      const origin = new Matrix4().makeRotationY(0.4).setPosition(5, 0, 2);
      const second = yawAlignment(12, [6, 400, -3]);
      a.setAlignment(second);
      a.beginVisit();
      expect(summary.hidden()).toBeGreaterThan(0);
      for (let i = 0; i < 8; i += 1) {
        captured.configs.at(-1)?.onDetection?.(detection(i, origin));
      }
      await flush();
      a.endVisit();
      await flush();

      const keys = [...files.keys()].filter((k) => k.startsWith(visitKey("")));
      expect(keys).toHaveLength(2);
      const entries = keys
        .map((k) => parseVisitLogEntry(files.get(k) as string)!)
        .sort((x, y) => x.atMs - y.atMs || x.visitId.localeCompare(y.visitId));
      expect(entries.map((e) => e.codes[0]?.levelId)).toEqual([
        first?.id,
        first?.id,
      ]);
      expect(entries[0]?.gpsAccuracyM).toBe(5);
      expect(entries[0]?.baselineM).toBeGreaterThan(27);
      const expected = codeThrough(second, origin);
      expect(entries[1]?.codes[0]?.geo.lat).toBeCloseTo(expected.lat, 7);
      expect(entries[1]?.codes[0]?.geo.lon).toBeCloseTo(expected.lon, 7);

      // A reload: a new read of the same files brings both back.
      expect((await readDraft(store))?.visits).toHaveLength(2);

      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      const model = summary.shown.at(-1);
      expect(model?.tracks).toHaveLength(2);
      expect(model?.codes).toHaveLength(1);
      expect(model?.codes[0]?.levelId).toBe(first?.id);
      // What visitors get is graded by the visit that saved the stored
      // pose (M3a/M3b review #2); what the visits suggest combines both.
      expect(model?.codes[0]?.verdict.numbers?.visitCount).toBe(1);
      expect(model?.codes[0]?.reference?.ringM).toBe(5);
      expect(model?.codes[0]?.estimateVerdict?.numbers?.visitCount).toBe(2);
      expect(model?.objects.map((o) => o.label)).toEqual(["Gate"]);
    });

    it("brings a restored draft's visits back into the summary after a reload", async () => {
      const { store } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour(TOUR);
      await flush();
      a.setWalk(walk());
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      await flush();

      // The page reloads: a new setup over the same draft files.
      const summary = summaryFake();
      const b = authoring({ store, summary });
      await openFinishableTour(b);
      b.setup.presentDraftForTour(TOUR);
      await vi.waitFor(() => {
        // The fake elements start visible: wait for the offer's words.
        expect(b.dom.draftOfferText.textContent).not.toBe("");
      });
      b.dom.draftRestore.click();
      b.device.live = false;
      b.dom.finishButton.click();
      await finished(b.ctx);
      expect(b.ctx.finishError).toBeNull();
      expect(summary.shown.at(-1)?.tracks).toHaveLength(1);
      expect(summary.shown.at(-1)?.codes[0]?.verdict.numbers?.visitCount).toBe(
        1,
      );
      // The restored visit still says which pose it saved.
      expect(summary.shown.at(-1)?.codes[0]?.reference?.ringM).not.toBeNull();
    });

    // Why this test matters (M3a/M3b review #5): a visit that only re-scans
    // a hosted code leaves a draft with no object, no deletion and no new
    // measurement - exactly what the spent rule deletes. The visit files
    // went with it on the next reload, and with them the summary's only
    // evidence for that code. Visits keep a draft alive until the author
    // discards it (the zip never carries them).
    it("keeps a draft that holds only AR visits across a reload, offers them, and drops them only on a discard", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour(TOUR);
      await flush();
      a.setWalk(walk());
      // A visit that only SEES the code: nothing measured, nothing placed.
      a.seeTheCode();
      await flush();
      a.endVisit();
      await flush();
      const visitFiles = () =>
        [...files.keys()].filter((k) => k.startsWith(visitKey("")));
      expect(visitFiles()).toHaveLength(1);

      // The page reloads: a new setup over the same draft files.
      const b = authoring({ store });
      await openFinishableTour(b);
      b.setup.presentDraftForTour(TOUR);
      await vi.waitFor(() => {
        expect(b.dom.draftOfferText.textContent).toMatch(/1 AR visit/);
      });
      await flush();
      expect(visitFiles()).toHaveLength(1);

      b.dom.draftDiscard.click();
      await vi.waitFor(() => {
        expect(visitFiles()).toHaveLength(0);
      });
    });

    // Why this test matters (M3a/M3b review #6): only the code in hand got
    // a visit record, so every other stored code of the tour said "scan
    // it again" forever, however often it was seen. A stable sighting of
    // any stored code is that code's visit, through the visit's PLAIN
    // alignment like every visit record - and it must not take the code in
    // hand, which would change what the settle corrects through.
    it("logs a stable sighting of the tour's other stored code as that code's visit, without taking it in hand", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour(TOUR);
      await flush();
      a.setWalk(walk());
      const alignment = yawAlignment(12, [6, 400, -3]);
      a.setAlignment(alignment);
      await a.mint();
      const inHand = a.codes.inHand()!;
      const otherText = `${TEXT}&n=2`;
      const otherId = await qrCodeId(otherText);
      a.ctx.currentLevels = new Map([
        [otherId, parseQrLevel(JSON.parse(inHand.json) as unknown)],
      ]);
      for (let i = 0; i < 8; i += 1) {
        captured.configs.at(-1)?.onDetection?.({
          ...detection(i),
          text: otherText,
        });
      }
      await vi.waitFor(() => {
        expect(a.ctx.lastDetectedText).toBe(otherText);
      });
      // The setup derives the new text's level id with an async hash
      // (`identify`) before it can log the sighting; one more hash of the
      // same text, started after it, and a turn, outlast it.
      await qrCodeId(otherText);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flush();
      expect(a.codes.inHand()).toEqual(inHand);
      a.endVisit();
      await flush();

      const key = [...files.keys()].find((k) => k.startsWith(visitKey("")))!;
      const entry = parseVisitLogEntry(files.get(key) as string)!;
      expect(entry.codes.map((c) => c.levelId).sort()).toEqual(
        [inHand.id, otherId].sort(),
      );
      const other = entry.codes.find((c) => c.levelId === otherId)!;
      const expected = codeThrough(alignment);
      expect(other.geo.lat).toBeCloseTo(expected.lat, 7);
      expect(other.geo.lon).toBeCloseTo(expected.lon, 7);
      // The other code's record is a sighting, never the pose saved here.
      expect(other.savedGeo).toBeUndefined();
      expect(
        entry.codes.find((c) => c.levelId === inHand.id)?.savedGeo,
      ).toBeDefined();
    });

    // Why this test matters (code book plan M5b): the summary numbered its
    // codes in an order that put the code in hand first, so after a second
    // code took the hand the first one became "Code 2". It numbers them as
    // every label does: the tour's codes, then this page's, in the order
    // they were taken.
    it("numbers the codes in the order they were taken, not by the hand", async () => {
      const summary = summaryFake();
      const a = authoring({ summary });
      await openFinishableTour(a);
      await a.mint();
      const first = a.codes.inHand()!;
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      const second = a.codes.inHand()!;
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      expect(summary.shown.at(-1)?.codes.map((c) => c.levelId)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it("drops the summary and the visits when the tour closes", async () => {
      const summary = summaryFake();
      const a = authoring({ summary });
      a.setWalk(walk());
      await a.mint();
      a.endVisit();
      a.setup.resetFinishStep();
      expect(summary.hidden()).toBeGreaterThan(0);
      await openFinishableTour(a);
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      a.device.live = false;
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(summary.shown.at(-1)?.tracks).toEqual([]);
    });
  },
);

describe(
  "the settle at each object's own moment (D33)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: the pure planner is tested on its own; these
    // pin the WIRING - the creator setup feeds the picks the session's GPS
    // extent and the alignment at each moment, so a pin placed after the
    // session matured settles through the alignment at its placement, and
    // the drift folded into the alignment by the visit's end never reaches
    // it. A visit that never matures still falls back to the end alignment.

    /** Twelve device fixes spanning `spanM` m North, with the coordinates
     *  the GPS extent reads. */
    function walkSpanning(spanM: number): {
      fixes: unknown[];
      odometry: number[][];
    } {
      const fixes = Array.from({ length: 12 }, (_, i) => {
        const n = (spanM * i) / 11;
        return {
          id: `gps-${String(i)}`,
          timestamp: 1_000 * i,
          coordinates: [n, 400, 0],
          latitude: ZERO.lat + (n / 6_371_000) * (180 / Math.PI),
          longitude: ZERO.lon,
          latLongAccuracy: 4,
        };
      });
      return { fixes, odometry: fixes.map((_, i) => [(spanM * i) / 11, 0, 0]) };
    }

    const atPlacement = yawAlignment(0, [0, 400, 0]);
    const drifted = yawAlignment(9, [6, 400, -3]);

    it("settles a pin placed after the session matured through the alignment at its placement", async () => {
      const a = authoring();
      a.setWalk(walkSpanning(100));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      // By the visit's end the alignment has the walk's drift folded in.
      a.setAlignment(drifted);
      a.endVisit();
      const log = a.settledLogs().at(-1)!.payload;
      expect(log.objects[0]!.usedAlignment).toEqual(atPlacement);
      expect(log.levelAlignment).toEqual(atPlacement);
      const pin = a.ctx.placedObjects[0]!.object;
      const expected = throughAlignment(
        { position: [2, 0, -1], rotation: [0, 0, 0, 1] },
        atPlacement,
      )!.position;
      expect(
        new Vector3(...objectPoseNue(pin.geo, ZERO).positionNue).distanceTo(
          new Vector3(...expected),
        ),
      ).toBeLessThan(1e-3);
    });

    it("falls back to the end alignment when the session never matures", async () => {
      const a = authoring();
      a.setWalk(walkSpanning(30));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.setAlignment(drifted);
      a.endVisit();
      const log = a.settledLogs().at(-1)!.payload;
      expect(log.objects[0]!.usedAlignment).toEqual(drifted);
      expect(log.levelAlignment).toEqual(drifted);
    });
  },
);

describe(
  "characterization before the split (code book plan M1: a sampled mutation pass found these unpinned)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: M2 moves creator-setup.ts into modules and is
    // verified by the composed tests passing unchanged. A sampled mutation
    // pass (twelve hand-made mutants, 2026-10-06) found four behaviours no
    // test could notice; each is pinned here so the split cannot drop one
    // (Finish held during a measurement: fused-pose-wiring.test.ts, which
    // can hold the identity hash).

    it("does not retry a measurement the mint refused on every render (once per visit and code)", async () => {
      // No zero yet: the gate is open, the mint refuses. Retrying it on
      // every frame would rewrite the note at frame rate and never stop.
      const a = authoring();
      a.setZero(null);
      a.seeTheCode();
      await flush();
      expect(a.ctx.placementNote).toMatch(/GPS alignment/);
      a.ctx.placementNote = null;
      a.seeTheCode();
      a.setup.renderAuthorReadout();
      await flush();
      expect(a.ctx.placementNote).toBeNull();
      // Positive control (M1 review #7): in the NEXT visit the code is tried
      // again - so the silence above is the once-per-visit rule, not a
      // retry that merely had not landed yet.
      a.endVisit();
      a.beginVisit();
      a.seeTheCode();
      await flush();
      expect(a.ctx.placementNote).toMatch(/GPS alignment/);
    });

    it("says that nothing is backed up ONCE, however many writes cannot be made", async () => {
      // A creator mid-walk cannot act on it more often, and repeating it
      // would push the live readout off the line.
      const a = authoring();
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      expect(a.ctx.placementNote).toContain("not saving a backup copy");
      a.ctx.placementNote = null;
      // Another write that cannot be made: the visit's log at its end (a
      // visit with a fix IS logged, so the write is really attempted).
      a.setWalk({
        fixes: [{ latitude: ZERO.lat, longitude: ZERO.lon, timestamp: 1 }],
        odometry: [[0, 0, 0]],
      });
      a.endVisit();
      await flush();
      expect(a.ctx.placementNote).toBeNull();
    });

    it("measures a new code once the code in hand was written by a Finish", async () => {
      // Each Finish writes one code, so a new code waits for one ("Finish
      // first"); once it ran, the code in hand is saved and the new code is
      // measured (the hosted zip still lacks it until the creator uploads).
      const a = authoring();
      await openFinishableTour(a);
      await a.mint();
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      a.beginVisit();
      for (let i = 0; i < 8; i += 1) {
        captured.configs.at(-1)?.onDetection?.({
          ...detection(i),
          text: `${TEXT}&n=2`,
        });
      }
      await vi.waitFor(() => {
        expect(
          a.dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured"),
        ).toHaveLength(2);
      });
    });

    it("keeps a visit with no fix and no code out of the visit log", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      a.setWalk({ fixes: [], odometry: [] });
      a.endVisit();
      await flush();
      const visitFiles = () =>
        [...files.keys()].filter((k) => k.startsWith(visitKey("")));
      expect(visitFiles()).toEqual([]);
      // Positive control (M1 review #7): the next visit, with one fix, IS
      // logged - so the empty list above is the rule, not a write that had
      // not landed yet.
      a.beginVisit();
      a.setWalk({
        fixes: [{ latitude: ZERO.lat, longitude: ZERO.lon, timestamp: 1 }],
        odometry: [[0, 0, 0]],
      });
      a.endVisit();
      await flush();
      expect(visitFiles()).toHaveLength(1);
    });
  },
);

describe(
  "placement waits for its gate (code book plan M2)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: placement is allowed only in a RUNNING
    // session with this session's fixes solved in (the mint gate's floor -
    // the matrix alone is the identity from the first fix, M4 review #2).
    // A pin placed outside that gate is minted through an alignment that
    // describes nothing, and lands metres from where the creator stood.
    // No unit test held either half until the M2 split's sampled mutants
    // showed both surviving.
    it("refuses a pin while the session is not running, and places it once it runs", async () => {
      const a = authoring();
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      a.device.live = false;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.placedObjects).toEqual([]);
      a.device.live = true;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.placedObjects).toHaveLength(1);
    });

    it("refuses a pin before this session's fixes reach the alignment floor", async () => {
      const a = authoring();
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      // One fix of the store's was there before this session started.
      a.ctx.gpsSamplesAtSessionStart = 1;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.placedObjects).toEqual([]);
      a.ctx.gpsSamplesAtSessionStart = 0;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.placedObjects).toHaveLength(1);
    });
  },
);

describe(
  "two new codes in one visit (code book plan M4c-2, the owner's case)",
  { timeout: SLOW_MS },
  () => {
    // Why this test matters: the owner's case - two codes printed 20 m
    // apart, both measured in ONE visit. With one slot the second showed
    // "Finish first" and was never measured; now both are measured, both
    // re-minted by the settle, and the draft keeps both levels for the
    // Finish.
    // Why this test matters (code book plan M5a; M4 milestone review #6):
    // the settled log named one re-minted level, so a replay of a visit
    // that measured two codes could not see the second one's new pose.
    it("logs every level the settle re-minted", async () => {
      const a = authoring();
      await a.mint();
      const first = a.codes.inHand()!;
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      const second = a.codes.inHand()!;
      a.endVisit();
      const settled = a.settledLogs().at(-1)!.payload;
      expect(settled.levels?.map((l) => l.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      for (const level of settled.levels ?? []) {
        expect(level.alignment, level.id).toHaveLength(16);
      }
    });

    it("measures both codes, and the draft keeps both levels", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      const first = a.codes.inHand()!;
      // Code B: its own print, 20 m away.
      const twentyAway = new Matrix4().makeTranslation(20, 0, 0);
      await a.mint(
        twentyAway,
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      const second = a.codes.inHand()!;
      expect(second.id).not.toBe(first.id);
      a.endVisit();
      await flush();
      const meta = JSON.parse(String(files.get(META_KEY))) as {
        levels: { id: string }[];
      };
      expect(meta.levels.map((l) => l.id)).toEqual([first.id, second.id]);
    });

    // Why this test matters (code book plan M4e, found by the two-code
    // e2e): the visit log recorded the code in hand's measurement only, so
    // the first of two codes measured in one visit had no visit record and
    // no saved pose in it - the summary after Finish could not say where it
    // is, or grade its saved pose by the visit it came from.
    it("logs both codes measured in the visit, each with the pose its settle saved", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      const first = a.codes.inHand()!;
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      const second = a.codes.inHand()!;
      a.endVisit();
      await flush();
      const key = [...files.keys()].find((k) => k.startsWith(visitKey("")))!;
      const entry = parseVisitLogEntry(files.get(key) as string)!;
      expect(entry.codes.map((c) => c.levelId).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      for (const code of entry.codes) {
        expect(code.savedGeo, code.levelId).toBeDefined();
      }
    });

    // Why this test matters (webxr PR #556 review; M4 milestone review
    // #7): "Use this size" for the code in hand empties the hand, and the
    // settle then took the old one-code path - every OTHER code the visit
    // measured was dropped from it: not re-minted through its own pick,
    // no saved pose in the visit log, while its notes still settled. The
    // visit's other codes are settled with an empty hand too, and none of
    // them takes the hand.
    it("settles the visit's other measured codes when the hand is empty", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      const first = a.codes.inHand()!;
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      // The hand emptied by writing the session fields - an emulation: a
      // size adoption also drops the cleared code's measurement (so here
      // the second code is still measured and re-minted, which production
      // would not do). The assertion is about the FIRST code, either way.
      a.codes.setInHand(null, null);
      a.endVisit();
      await flush();
      const key = [...files.keys()].find((k) => k.startsWith(visitKey("")))!;
      const entry = parseVisitLogEntry(files.get(key) as string)!;
      const firstCode = entry.codes.find((c) => c.levelId === first.id);
      expect(firstCode?.savedGeo, "the first code was settled").toBeDefined();
      expect(a.codes.inHand()).toBeNull();
    });

    // Why this test matters: each code keeps its OWN measurement pick
    // (M4c-2). With one pick, the second code's replaced the first's, and
    // the first code was re-minted through the wrong moment's alignment -
    // here 3 m and 8 degrees off where it was measured.
    it("re-mints each code through the alignment of its own measurement", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      // A walk wide enough for the alignment to be mature from the start,
      // so each pick freezes at its own moment.
      const fixes = Array.from({ length: 60 }, (_, i) => ({
        id: `fix-${String(i)}`,
        timestamp: 1_000 + i * 1000,
        coordinates: [i, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      a.setWalk({ fixes, odometry: fixes.map(() => [0, 0, 0]) });
      const atA = yawAlignment(0, [0, 400, 0]);
      a.setAlignment(atA);
      a.setZero(ZERO);
      await a.mint();
      const first = a.codes.inHand()!;
      // The alignment moves before code B is measured.
      a.setAlignment(yawAlignment(8, [3, 400, 0]));
      a.setZero(ZERO);
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      a.endVisit();
      await flush();
      const meta = JSON.parse(String(files.get(META_KEY))) as {
        levels: { id: string; json: string }[];
      };
      const settledA = meta.levels.find((l) => l.id === first.id)!;
      // Re-minted through A's own pick: where it was measured.
      expect(
        codeWorldOf(settledA.json).distanceTo(codeWorldOf(first.json)),
      ).toBeLessThan(0.01);
    });

    // Why this test matters (code book plan M4e; the sampled mutant "other
    // codes' sightings not noted", filed at M4c-2): a stored code seen while
    // ANOTHER code is in hand is a code event the settle ties notes to (D2).
    // Without it the pin placed beside the stored code is tied to the code in
    // hand instead, and settled through this visit's GPS - here 20 m and 30
    // degrees off - rather than corrected through the stored code it was
    // placed next to.
    it("ties a pin to the stored code it was placed beside, though another code is in hand", async () => {
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      const stored = a.codes.inHand()!;
      a.endVisit();
      // Code A is the tour's now, as a hosted level.
      a.ctx.currentLevels = new Map([
        [stored.id, parseQrLevel(JSON.parse(stored.json) as unknown)],
      ]);

      a.beginVisit();
      // Walked distances must be known for the nearest-code rule; a GPS
      // extent of 59 m makes every pick mature at its own moment.
      const fixes = Array.from({ length: 60 }, (_, i) => ({
        id: `fix-${String(i)}`,
        timestamp: 1_000 + i * 1000,
        coordinates: [i, 0, 0],
        latitude: ZERO.lat,
        longitude: ZERO.lon,
      }));
      a.setWalk({ fixes, odometry: fixes.map(() => [0, 0, 0]) });
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      a.setZero(ZERO);
      // Code B, new, measured first: it takes the hand.
      await a.mint(
        new Matrix4().makeTranslation(20, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      expect(a.codes.inHand()?.id).not.toBe(stored.id);
      // Then code A is seen again, and a pin placed beside it.
      a.seeTheCode(undefined, TEXT, 20_000);
      await flush();
      await a.placePin("Beside A", [3, 0, 1]);
      a.endVisit();

      const pin = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "Beside A",
      )!.object;
      const settled = a.settledLogs().at(-1)!.payload;
      expect(settled.objects.find((o) => o.id === pin.id)?.basis).toBe(
        "code-corrected",
      );
    });
  },
);

describe(
  "the automatic code spots at the settle (code book plan M6 v5.1)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter (owner decisions before the AFK days: the
    // system decides by itself whether a poster moved, one reliable walk is
    // enough, a code seen again at its OLD spot was a second copy and the
    // move is undone): the pure rule and the fit are tested on their own;
    // this pins the WIRING - the visit's own fixes reach the fit, a move
    // keeps the spot it left, an undo restores that spot exactly before the
    // visit's objects settle, and a second print changes nothing - across
    // visits, through the level file, as a creator would live it.

    const R = 6_371_000;
    const latOf = (northM: number) => ZERO.lat + (northM / R) * (180 / Math.PI);

    /**
     * Walk 40 m north past the code over two minutes centred on now (the
     * fit's window is centred on the sighting): each fix where the
     * alignment `yawAlignment(0, [northM, 400, 0])` puts its odometry, so
     * the visit's GPS reads the code `northM` north of the odometry's
     * origin. Reliable at 5 m accuracy (40 m of spread).
     */
    function walkThrough(a: ReturnType<typeof authoring>, northM: number) {
      a.setAccuracy(5);
      const now = Date.now();
      const fixes: unknown[] = [];
      const odometry: number[][] = [];
      for (let i = 0; i <= 40; i += 1) {
        const n = i - 20;
        fixes.push({
          id: `spot-walk-${String(i)}`,
          latitude: latOf(n + northM),
          longitude: ZERO.lon,
          latLongAccuracy: 5,
          timestamp: now - 60_000 + i * 3_000,
          coordinates: [n + northM, 0, 0],
        });
        odometry.push([n, 0, 0]);
      }
      a.setWalk({ fixes, odometry });
      a.setup.renderAuthorReadout();
    }

    /** A visit that sees the code where the GPS puts it `northM` north. */
    async function visitSeeing(
      a: ReturnType<typeof authoring>,
      northM: number,
    ): Promise<void> {
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [northM, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, northM);
      a.endVisit();
      await flush();
    }

    const spotsOf = (a: ReturnType<typeof authoring>) =>
      readCodeSpots(a.codes.inHand()!.json)!;
    const northOf = (geo: { lat: number }) =>
      ((geo.lat - ZERO.lat) * Math.PI * R) / 180;

    async function storedCode() {
      const a = authoring();
      await a.mint();
      a.endVisit();
      const original = spotsOf(a).current;
      return { a, original };
    }

    it("moves a code seen 30 m from its saved spot after one reliable walk, keeping the spot it left", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 30);
      const spots = spotsOf(a);
      expect(northOf(spots.current.geo) - northOf(original.geo)).toBeCloseTo(
        30,
        0,
      );
      expect(spots.previous).toEqual(original);
      expect(spots.copies).toEqual([]);
      expect(a.settledLogs().at(-1)!.payload).toMatchObject({
        codePositions: [
          expect.objectContaining({
            decision: { kind: "move" },
            applied: true,
          }),
        ],
      });
    });

    // Why (M6 follow-ups #6): a code NOT in hand is moved and undone
    // through the book (`saveLevel`), not through the hand - a path no
    // composed test walked. Code A is put down when code B takes the hand.
    it("moves and undoes a code that is not in hand", async () => {
      const { a, original } = await storedCode();
      const first = a.codes.inHand()!.id;
      a.beginVisit();
      await a.mint(
        new Matrix4().makeTranslation(6, 0, 0),
        "https://gps.csutil.com/tour/?qr=second",
        10_000,
      );
      a.endVisit();
      await flush();
      expect(a.codes.inHand()!.id).not.toBe(first);
      const spotsOfFirst = () => readCodeSpots(a.codes.savedText(first)!)!;
      await visitSeeing(a, 30);
      const moved = spotsOfFirst();
      expect(northOf(moved.current.geo) - northOf(original.geo)).toBeCloseTo(
        30,
        0,
      );
      expect(moved.previous).toEqual(original);
      await visitSeeing(a, 0);
      const undone = spotsOfFirst();
      expect(undone.current).toEqual(original);
      expect(undone.previous).toBeNull();
      expect(undone.copies).toEqual([moved.current]);
    });

    // Under the floor it is the same spot: U3 may still IMPROVE a weakly
    // saved pose (its 15 m cap), but nothing is remembered as moved.
    it("does not move a code seen 12 m off (under the floor)", async () => {
      const { a } = await storedCode();
      await visitSeeing(a, 12);
      expect(spotsOf(a).previous).toBeNull();
      expect(
        a.settledLogs().at(-1)!.payload as { codePositions?: unknown[] },
      ).not.toMatchObject({
        codePositions: [
          expect.objectContaining({ decision: { kind: "move" } }),
        ],
      });
    });

    it("undoes the move when the code is seen back at its old spot, and keeps the new spot as a second print", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 30);
      const moved = spotsOf(a).current;
      await visitSeeing(a, 0);
      const spots = spotsOf(a);
      // Exactly the old pose and quality, not a re-mint of this visit.
      expect(spots.current).toEqual(original);
      expect(spots.previous).toBeNull();
      expect(spots.copies).toEqual([moved]);
    });

    it("changes nothing when the code is seen at its second print", async () => {
      const { a } = await storedCode();
      await visitSeeing(a, 30);
      await visitSeeing(a, 0);
      const before = a.codes.inHand()!.json;
      await visitSeeing(a, 30);
      expect(a.codes.inHand()!.json).toBe(before);
    });

    it("decides nothing in a visit whose odometry frame changed", async () => {
      const { a, original } = await storedCode();
      a.beginVisit();
      a.ctx.frameEpochAtSessionStart = -1;
      a.setAlignment(yawAlignment(0, [30, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, 30);
      a.endVisit();
      await flush();
      expect(spotsOf(a).current.geo).toEqual(original.geo);
      expect(spotsOf(a).previous).toBeNull();
    });

    // Why (M6 v5.1): the store's fix list spans every visit of the page, and
    // an earlier visit's odometry has another origin. A re-entry inside the
    // fit's window would mix the two frames and read a move that is not
    // there.
    it("fits only this visit's fixes, not an earlier visit's still in the store", async () => {
      const { a, original } = await storedCode();
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      a.seeTheCode();
      await flush();
      a.setAccuracy(5);
      const now = Date.now();
      // An earlier visit, minutes ago: its GPS 60 m off this visit's
      // odometry (another origin), many fixes.
      const fixes: unknown[] = [];
      const odometry: number[][] = [];
      for (let i = 0; i < 120; i += 1) {
        fixes.push({
          id: `earlier-${String(i)}`,
          latitude: latOf(60 + (i % 40) - 20),
          longitude: ZERO.lon,
          latLongAccuracy: 5,
          timestamp: now - 200_000 + i * 1_000,
          coordinates: [60 + (i % 40) - 20, 0, 0],
        });
        odometry.push([(i % 40) - 20, 0, 0]);
      }
      a.ctx.gpsSamplesAtSessionStart = fixes.length;
      for (let i = 0; i <= 40; i += 1) {
        fixes.push({
          id: `this-${String(i)}`,
          latitude: latOf(i - 20),
          longitude: ZERO.lon,
          latLongAccuracy: 5,
          timestamp: now - 60_000 + i * 3_000,
          coordinates: [i - 20, 0, 0],
        });
        odometry.push([i - 20, 0, 0]);
      }
      a.setWalk({ fixes, odometry });
      a.endVisit();
      await flush();
      expect(spotsOf(a).previous).toBeNull();
      // Seen at home (U3 may still re-mint the same spot, to the float).
      expect(
        (a.settledLogs().at(-1)!.payload as { codeSpots?: unknown }).codeSpots,
      ).toEqual([
        {
          levelId: a.codes.inHand()!.id,
          decision: { kind: "none", reason: "at-current" },
        },
      ]);
      expect(
        Math.abs(northOf(spotsOf(a).current.geo) - northOf(original.geo)),
      ).toBeLessThan(1);
    });

    // Why (M6 v5 review #3): a second print 22 m from the saved spot is
    // inside the correction's bound (about 26 m at 5 m accuracy), so a visit
    // there used to correct its objects through the SAVED pose - 22 m off.
    it("corrects nothing through a code seen at its second print", async () => {
      const { a } = await storedCode();
      await visitSeeing(a, 22);
      await visitSeeing(a, 0);
      expect(spotsOf(a).copies).toHaveLength(1);
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [22, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, 22);
      await a.placePin("at the copy", [3, 0, 1]);
      a.endVisit();
      await flush();
      const pin = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "at the copy",
      )!.object;
      const settled = a.settledLogs().at(-1)!.payload;
      expect(settled.objects.find((o) => o.id === pin.id)?.basis).not.toBe(
        "code-corrected",
      );
    });

    // Why (M6 v5 review #3): the live view drew a visit's earlier objects
    // through every sighted code; a sighting at a second print 22 m away is
    // inside the correction's bound, so the creator saw every earlier note
    // shifted 22 m while standing at the copy.
    it("draws earlier objects plainly, not through the saved pose, while the code is seen at its second print", async () => {
      const a = authoring();
      await a.mint();
      await a.placePin("home pin", [3, 0, 1]);
      a.endVisit();
      await visitSeeing(a, 22);
      await visitSeeing(a, 0);
      expect(spotsOf(a).copies).toHaveLength(1);
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [22, 400, 0]));
      walkThrough(a, 22);
      a.seeTheCode();
      await flush();
      const pin = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "home pin",
      )!.object;
      // Plainly: through this visit's alignment (a 22 m north shift).
      const plain = worldOf(pin.geo).sub(new Vector3(22, 400, 0));
      expect(a.inWorldGroup("home pin").distanceTo(plain)).toBeLessThan(0.5);
    });

    // Why (M5c review #4, v3 review #12): an improved code takes the objects
    // near it along - unless an object is nearer another code. A pin next to
    // this code's own SECOND print belongs to that print, not to the spot
    // being improved 22 m away, and used to ride along with it.
    it("leaves a pin by the code's second print where it is when the code's position is improved", async () => {
      const a = authoring();
      await a.mint();
      // A copy 30 m away: an improvement of 5 m stays more than the floor
      // from it (M6 milestone review #2 keeps one that would not).
      await a.placePin("by the copy", [30, 0, 0]);
      a.endVisit();
      await visitSeeing(a, 30);
      await visitSeeing(a, 0);
      expect(spotsOf(a).copies).toHaveLength(1);
      const pinBefore = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "by the copy",
      )!.object.geo;
      // Seen 5 m off its (weakly saved) spot after a reliable walk: improved.
      await visitSeeing(a, 5);
      expect(
        (a.settledLogs().at(-1)!.payload as { codePositions?: unknown })
          .codePositions,
      ).toEqual([
        expect.objectContaining({
          decision: { kind: "replace" },
          applied: true,
        }),
      ]);
      const pinAfter = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "by the copy",
      )!.object.geo;
      expect(worldOf(pinAfter).distanceTo(worldOf(pinBefore))).toBeLessThan(
        1e-6,
      );
    });

    // Why (M6 milestone review #1): an undo visit that also saw ANOTHER
    // second print kept that sighting, and a pin placed by it could settle
    // through the restored spot - 30 m off. This held before the fix too
    // (one code corrects through its latest sighting, and the visit log
    // keeps only that one); it pins the defensive exclusion.
    it("an undo corrects nothing through another second print the same visit saw", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 30); // moved to B
      await visitSeeing(a, 0); // undone: B is a second print
      await visitSeeing(a, -30); // moved to C, previous A, copies [B]
      expect(spotsOf(a).previous?.geo).toEqual(original.geo);
      expect(spotsOf(a).copies).toHaveLength(1);
      // Two sightings of one code merge into one run within a second
      // (`SIGHTING_SPACING_MS`): the clock moves on between the prints.
      const visitStartMs = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(visitStartMs);
        a.beginVisit();
        a.setAlignment(yawAlignment(0, [0, 400, 0]));
        walkThrough(a, 0);
        // The print at B, 30 m north, with a pin beside it; then the code
        // at A.
        a.seeTheCode(new Matrix4().makeTranslation(0, 0, -30));
        await flush();
        await a.placePin("by B", [31, 0, 1]);
        vi.setSystemTime(visitStartMs + 5_000);
        a.seeTheCode();
        await flush();
        a.endVisit();
        await flush();
      } finally {
        vi.useRealTimers();
      }
      // Undone back to A.
      expect(spotsOf(a).current.geo).toEqual(original.geo);
      const pin = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin" && p.object.label === "by B",
      )!.object;
      expect(Math.abs(worldOf(pin.geo).x - 31)).toBeLessThan(2);
    });

    // Why (M6 milestone review #2): a silent improvement may shift the saved
    // spot by up to 15 m; toward a known second print it would leave two
    // spots closer than the floor, and every later sighting would flip
    // between them.
    it("never improves the saved spot to within the floor of a known second print", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 22);
      await visitSeeing(a, 0);
      expect(spotsOf(a).copies).toHaveLength(1);
      // Seen 8 m off its weakly saved spot after a reliable walk: an
      // improvement, 14 m from the second print.
      await visitSeeing(a, 8);
      expect(
        (a.settledLogs().at(-1)!.payload as { codePositions?: unknown })
          .codePositions,
      ).toEqual([
        expect.objectContaining({ decision: { kind: "keep", reason: "far" } }),
      ]);
      expect(spotsOf(a).current.geo).toEqual(original.geo);
    });

    // Why (M6 milestone review #3): the move prompt used to tell a creator
    // whose walk was too short to walk farther; without it, a poster that
    // really moved got no word at all.
    it("says so when a code is seen far off in a visit that cannot judge it", async () => {
      const { a } = await storedCode();
      a.beginVisit();
      a.ctx.frameEpochAtSessionStart = -1;
      a.setAlignment(yawAlignment(0, [30, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, 30);
      a.endVisit();
      await flush();
      const positions = (
        a.settledLogs().at(-1)!.payload as {
          codePositions?: { decision: { kind: string; reason?: string } }[];
        }
      ).codePositions;
      expect(positions?.[0]?.decision).toMatchObject({
        kind: "keep",
        reason: "far-unjudged",
      });
    });

    // Why (M6 milestone review #4, v5.1 #4): a failed Finish unsettles its
    // visit, which settles again at its end. Judged again against the level
    // the first settle already restored, the undo would be lost or doubled.
    it("re-applies an undo after a failed Finish, exactly once", async () => {
      const { store } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      a.endVisit();
      const original = spotsOf(a).current;
      await visitSeeing(a, 30);
      const moved = spotsOf(a).current;
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, 0);
      (
        a.ctx.session as unknown as { readWholeArchive: () => Promise<Blob> }
      ).readWholeArchive = () => Promise.reject(new Error("offline"));
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).not.toBeNull();
      expect(spotsOf(a).current).toEqual(original);
      expect(spotsOf(a).copies).toEqual([moved]);
      a.endVisit();
      await flush();
      expect(spotsOf(a).current).toEqual(original);
      expect(spotsOf(a).copies).toEqual([moved]);
      expect(spotsOf(a).previous).toBeNull();
    });

    // Why (the sampled mutant "applied decision not kept for a re-settle",
    // whose killing test went with the move question in M6c): a failed
    // Finish unsettles its visit, which settles again at its end. Planned
    // again from the level the first settle already re-minted, the move
    // would read as a keep - the result and the log would contradict what
    // was written.
    it("re-applies a move after a failed Finish, as the same decision", async () => {
      const { store } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      a.endVisit();
      const original = spotsOf(a).current;
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [30, 400, 0]));
      a.seeTheCode();
      await flush();
      walkThrough(a, 30);
      (
        a.ctx.session as unknown as { readWholeArchive: () => Promise<Blob> }
      ).readWholeArchive = () => Promise.reject(new Error("offline"));
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).not.toBeNull();
      const moved = spotsOf(a);
      expect(moved.previous).toEqual(original);
      a.endVisit();
      await flush();
      // The same pose, re-minted at the second settle's time.
      expect(spotsOf(a).current.geo).toEqual(moved.current.geo);
      expect(spotsOf(a).previous).toEqual(original);
      expect(spotsOf(a).copies).toEqual(moved.copies);
      expect(
        (a.settledLogs().at(-1)!.payload as { codePositions?: unknown })
          .codePositions,
      ).toEqual([expect.objectContaining({ decision: { kind: "move" } })]);
    });

    // Why (M6 milestone review #4): the confirmation's clock and write are
    // wiring, not rule - a sign flipped on the day, or a write dropped,
    // would pass the rule's own tests.
    it("confirms a move a day later: the spot it left becomes a second print", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 30);
      // The same day: nothing changes.
      await visitSeeing(a, 30);
      expect(spotsOf(a).previous).toEqual(original);
      const sameDayMs = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(sameDayMs + 25 * 3_600_000);
        await visitSeeing(a, 30);
      } finally {
        vi.useRealTimers();
      }
      expect(spotsOf(a).previous).toBeNull();
      expect(spotsOf(a).copies).toEqual([original]);
    });

    // Why (M6 milestone review #4; D19, §7j #12): a real move leaves the
    // pins where they are, and is the visit log's boundary for the code.
    it("a move takes no pin along and marks the move in the visit log", async () => {
      const { store, files } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      await a.placePin("near the code", [2, 0, -1]);
      a.endVisit();
      await flush();
      const pinBefore = a.ctx.placedObjects.find(
        (p) => p.object.kind === "pin",
      )!.object.geo;
      await visitSeeing(a, 30);
      const pinAfter = a.ctx.placedObjects.find((p) => p.object.kind === "pin")!
        .object.geo;
      expect(pinAfter).toEqual(pinBefore);
      const entries = [...files.keys()]
        .filter((k) => k.startsWith(visitKey("")))
        .map((k) => parseVisitLogEntry(files.get(k) as string)!)
        .sort((x, y) => x.atMs - y.atMs);
      expect(
        entries.at(-1)!.codes.find((c) => c.levelId === a.codes.inHand()!.id)
          ?.moved,
      ).toBe(true);
    });
  },
);
