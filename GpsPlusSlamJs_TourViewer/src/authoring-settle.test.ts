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
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { OUTCOME_HOLD_MS } from "./object-editing.js";
import { MOVE_PROMPT_RULE, savedPoseKey } from "./code-move-prompt.js";
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
function detection(i: number, origin?: Matrix4): QrDetectionEvent {
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
    text: TEXT,
    timestamp: i * 125,
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
  "mintButton",
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
  "replaceCodeButton",
  "replaceCodeConfirm",
  "replaceCodeConfirmText",
  "replaceCodeYes",
  "replaceCodeNo",
  "movePrompt",
  "movePromptText",
  "movePromptUse",
  "movePromptCopy",
  "movePromptLater",
  "moveUndo",
  "moveUndoText",
  "moveUndoButton",
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
  function seeTheCode(origin?: Matrix4): void {
    for (let i = 0; i < 8; i += 1) {
      captured.configs.at(-1)?.onDetection?.(detection(i, origin));
    }
  }

  /** Measure the code: stable, then "Save the measured position". */
  async function mint(): Promise<void> {
    seeTheCode();
    expect(dom.mintButton.disabled, "the mint gate should be open").toBe(false);
    dom.mintButton.click();
    await vi.waitFor(() => {
      expect(ctx.mintedLevel).not.toBeNull();
    });
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
        objects: { id: string; geo: TourObject["geo"] }[];
        level: { id: string; json: string } | null;
        referenceLevel: { id: string; json: string } | null;
        zero: { lat: number; lon: number } | null;
        sighting: { odomPose: Pose } | null;
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
      a.ctx.mintedLevel = { id: "lvl", json: "{}" };
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
      a.ctx.mintedLevel = { id: "lvl", json: "{}" };
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
      const offset = worldOf(pin.geo).sub(codeWorldOf(a.ctx.mintedLevel!.json));
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
      const tapLevel = a.ctx.mintedLevel;
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
      expect(payload.objects).toEqual([
        {
          id: a.ctx.placedObjects[0]!.object.id,
          geo: a.ctx.placedObjects[0]!.object.geo,
        },
      ]);
      expect(payload.level).toEqual(a.ctx.mintedLevel);
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
      const tapLevel = a.ctx.mintedLevel!.json;
      a.setAlignment(yawAlignment(9, [2, 400, 2]));

      a.endVisit();
      await flush();

      const pin = a.ctx.placedObjects[0]!.object;
      expect(pin.geo, "the settle should have moved the pin").not.toEqual(
        tapGeo,
      );
      expect(a.ctx.mintedLevel!.json).not.toBe(tapLevel);
      const onDisk = JSON.parse(
        String(files.get(objectKey(pin.id))),
      ) as TourObject;
      expect(onDisk.geo).toEqual(pin.geo);
      const meta = JSON.parse(String(files.get(META_KEY))) as {
        level: { json: string };
      };
      expect(meta.level.json).toBe(a.ctx.mintedLevel!.json);
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
        codeWorldOf(a.ctx.mintedLevel!.json),
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
        codeWorldOf(a.ctx.mintedLevel!.json),
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

    it("re-judges the earlier notes' frame on a new fix while the code is out of view: a refusal moves them to their geo (M5b review #8)", async () => {
      // Why this test matters: since M5b every new fix re-judges the
      // latest sighting through the current alignment (the move prompt
      // needs the refusal current). A GPS alignment that drifts past the
      // bound therefore moves the earlier notes from the code's frame to
      // their stored geo with no new look at the code - a jump nobody
      // tapped for. It is the frame the visit's settle would use at that
      // moment, so the preview stays truthful; this pins that consequence
      // (accepted, creator-setup.ts.md "Earlier visits' objects").
      const a = await firstVisit();
      a.beginVisit();
      a.setAlignment(SECOND);
      a.seeTheCode();
      await flush();
      const atCode = new Vector3(2, 0, -1);
      expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeLessThan(1e-2);

      // The code leaves the view; GPS drifts 60 m. No fix yet: unchanged.
      a.ctx.lastDetectedText = null;
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeLessThan(1e-2);

      // One fix lands: the sighting is refused through the new alignment,
      // and the note is where its geo puts it, tens of metres away.
      a.setWalk({
        fixes: Array.from({ length: MIN_ALIGNMENT_SAMPLES + 1 }, () => ({
          latitude: ZERO.lat,
          longitude: ZERO.lon,
        })),
        odometry: Array.from({ length: MIN_ALIGNMENT_SAMPLES + 1 }, () => [
          0, 0, 0,
        ]),
      });
      a.setup.renderAuthorReadout();
      expect(a.dom.status.textContent).toMatch(/Code seen \d+ m/);
      expect(a.inWorldGroup("Gate").distanceTo(atCode)).toBeGreaterThan(20);
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
      return first.ctx.mintedLevel!;
    }

    it("keeps an earlier visit's measurement as the reference when the code is measured again", async () => {
      // Why this test matters: "newest wins" re-minted the code through
      // the second visit's GPS, moving it away from the notes the first
      // visit had settled against it.
      const a = authoring();
      await a.mint();
      a.endVisit();
      const stored = a.ctx.mintedLevel!;
      const codeLocal = mintedOdom(a.dispatched);
      a.beginVisit();
      a.setAlignment(SECOND);
      await a.mint();

      expect(a.ctx.mintedLevel).toEqual(stored);
      expect(lastKept(a)).toBe("level-in-hand");
      expect(a.dom.status.textContent).toMatch(/saved position stays/);
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

      expect(a.ctx.mintedLevel).toEqual(hosted);
      expect(lastKept(a)).toBe("hosted-level");
      // The panel says the saved position stays - never that it is replaced.
      expect(a.dom.status.textContent).toMatch(/saved position stays/);
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
      expect(a.ctx.mintedLevel!.json).toBe(hosted.json);
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
      expect(a.ctx.mintedLevel!.json).not.toBe('{"old":true}');
      a.endVisit();
      expect(a.settledLogs().at(-1)!.payload.basis).toBe("measured-here");
    });

    it("lets a second measurement in the same visit replace the first", async () => {
      const a = authoring();
      await a.mint();
      const firstJson = a.ctx.mintedLevel!.json;
      a.setAlignment(yawAlignment(3, [1, 400, 1]));
      await a.mint();
      expect(lastKept(a)).toBe("measurement");
      expect(a.ctx.mintedLevel!.json).not.toBe(firstJson);
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
    a.ctx.mintedLevel = { id: "ffffffffffff", json: "{}" };
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
      a.ctx.tourManifest = { version: 1, objects };
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
        codeWorldOf(a.ctx.mintedLevel!.json),
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
  "re-measuring a stored code on purpose (M4; M2c review #5)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: since M2c a new measurement of a stored code
    // only corrects its visit - replacing the stored pose became an
    // explicit action. It must exist, ask first, say what it does, and be
    // recorded; and without it the stored pose must stay.
    async function secondVisitAtStoredCode() {
      const a = authoring();
      await a.mint();
      a.endVisit();
      const stored = a.ctx.mintedLevel!;
      a.beginVisit();
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      a.seeTheCode();
      await flush();
      a.setup.renderAuthorReadout();
      return { a, stored };
    }

    it("offers the replace for the stored code in view, asks first, then replaces it and records what it replaced", async () => {
      const { a, stored } = await secondVisitAtStoredCode();
      expect(a.dom.replaceCodeButton.hidden).toBe(false);
      expect(a.dom.replaceCodeButton.disabled).toBe(false);
      a.dom.replaceCodeButton.click();
      expect(a.dom.replaceCodeConfirm.hidden).toBe(false);
      expect(a.dom.replaceCodeConfirmText.textContent).toMatch(
        /Everyone who opens the tour/,
      );
      // With the size this visit sees (M4 review #3): its GPS alignment is
      // 30 degrees off the visit that stored the code, so the code turns 30
      // degrees, and earlier notes will appear shifted by it.
      expect(a.dom.replaceCodeConfirmText.textContent).toMatch(
        /it moves about \d+(\.\d)? m and turns 30°/,
      );
      expect(a.dom.replaceCodeConfirmText.textContent).toMatch(
        /will appear shifted by about that much/,
      );
      // Nothing changed yet: the confirm step comes first.
      expect(a.ctx.mintedLevel).toEqual(stored);
      a.dom.replaceCodeYes.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      expect(a.ctx.mintedLevel?.id).toBe(stored.id);
      expect(a.ctx.codeMeasurement?.visit).toBe(a.ctx.arSessionGeneration);
      const log = a.dispatched.filter(
        (x) => x.type === "tourAuthoring/codeMeasured",
      ) as { payload: { kept: string; replaced?: unknown } }[];
      expect(log.at(-1)?.payload.kept).toBe("measurement");
      expect(log.at(-1)?.payload.replaced).toEqual(stored);
      // Measured here now: the offer goes away.
      a.setup.renderAuthorReadout();
      expect(a.dom.replaceCodeButton.hidden).toBe(true);
    });

    it("keeps the stored pose when the creator declines", async () => {
      const { a, stored } = await secondVisitAtStoredCode();
      a.dom.replaceCodeButton.click();
      a.dom.replaceCodeNo.click();
      expect(a.dom.replaceCodeConfirm.hidden).toBe(true);
      expect(a.dom.replaceCodeButton.hidden).toBe(false);
      await flush();
      expect(a.ctx.mintedLevel).toEqual(stored);
    });

    it("is not offered for a code measured in this visit - that measurement is already the reference", async () => {
      const a = authoring();
      await a.mint();
      a.setup.renderAuthorReadout();
      expect(a.dom.replaceCodeButton.hidden).toBe(true);
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
      const first = a.ctx.mintedLevel;
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
      const inHand = a.ctx.mintedLevel!;
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
      expect(a.ctx.mintedLevel).toEqual(inHand);
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

    it("drops the summary and the visits when the tour closes", async () => {
      const summary = summaryFake();
      const a = authoring({ summary });
      a.setWalk(walk());
      await a.mint();
      a.endVisit();
      a.setup.resetFinishStep();
      expect(summary.hidden()).toBeGreaterThan(0);
      await openFinishableTour(a);
      a.ctx.mintedLevel = { id: "lvl", json: "{}" };
      a.device.live = false;
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(summary.shown.at(-1)?.tracks).toEqual([]);
    });
  },
);

describe(
  "the moved-code prompt (authoring plan 2026-09-28-0953 §3.6, D20, M5b)",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: "Use the new spot" moves the code for every
    // visitor, so the composed setup must ask only once a refusal of the
    // code in hand has LASTED with the mint gate open (§7j #8, #9), show
    // the replace's progress and its outcome (the async-UI rule, §7j #10),
    // count it as answered only once the replace happened, remember the
    // other two answers in the draft (§7j #14), undo until Finish, mark
    // the move in the visit log (§7j #12) and log all of it (§7j #15).
    const TOUR = "https://example.test/tour.zip";
    const T0 = 1_756_150_000_000;

    /**
     * A second visit that sees the stored code 60 m from its saved
     * position: a refusal (bound 26.2 m at the default 5 m accuracy), and
     * `fix(n)` adds n one-second device fixes, re-rendering after each as
     * a store change would.
     */
    async function secondVisitFarFromTheCode(store?: DraftFileStore) {
      const a = authoring(store === undefined ? {} : { store });
      if (store !== undefined) {
        await openFinishableTour(a);
        a.setup.presentDraftForTour(TOUR);
        await flush();
      }
      await a.mint();
      a.endVisit();
      const stored = a.ctx.mintedLevel!;
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [60, 400, 0]));
      a.seeTheCode();
      await flush();
      const fixes: unknown[] = [];
      const fix = (n: number): void => {
        for (let i = 0; i < n; i += 1) {
          fixes.push({
            latitude: ZERO.lat,
            longitude: ZERO.lon,
            latLongAccuracy: 5,
            timestamp: T0 + fixes.length * 1000,
          });
          a.setWalk({
            fixes: [...fixes],
            odometry: fixes.map(() => [0, 0, 0]),
          });
          a.setup.renderAuthorReadout();
        }
      };
      fix(3);
      return { a, stored, fix };
    }

    function logs(a: ReturnType<typeof authoring>, type: string) {
      return a.dispatched
        .filter((x) => x.type === `tourAuthoring/${type}`)
        .map((x) => x.payload as Record<string, unknown>);
    }

    it("asks only once the refusal has lasted the rule's fixes and seconds, with the distance, and logs the ask once", async () => {
      const { a, fix } = await secondVisitFarFromTheCode();
      expect(a.dom.status.textContent).toMatch(/Code seen 60 m/);
      fix(MOVE_PROMPT_RULE.minFixes - 1);
      expect(a.dom.movePrompt.hidden).toBe(true);
      fix(1);
      expect(a.dom.movePrompt.hidden).toBe(false);
      expect(a.dom.movePromptText.textContent).toBe(
        "This code seems to have moved about 60 m. Use the new spot?",
      );
      expect(a.dom.movePromptUse.disabled).toBe(false);
      fix(5);
      const asked = logs(a, "codeMovePrompted");
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        levelId: a.ctx.mintedLevel!.id,
        arVisitIndex: 1,
        fixes: MOVE_PROMPT_RULE.minFixes,
        seconds: MOVE_PROMPT_RULE.minSeconds,
      });
      expect(asked[0]!["horizontalM"] as number).toBeCloseTo(60, 1);
      expect(asked[0]!["northM"] as number).toBeCloseTo(60, 1);
    });

    it("does not ask while the mint gate is closed (too few of this session's fixes)", async () => {
      const { a, fix } = await secondVisitFarFromTheCode();
      a.ctx.gpsSamplesAtSessionStart = 1_000;
      fix(MOVE_PROMPT_RULE.minFixes + 5);
      expect(a.dom.status.textContent).toMatch(/Code seen 60 m/);
      expect(a.dom.movePrompt.hidden).toBe(true);
    });

    it("'Use the new spot' shows its progress, replaces the saved position, logs it, and offers Undo", async () => {
      const { a, stored, fix } = await secondVisitFarFromTheCode();
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      // In progress until the replace lands.
      expect(a.dom.movePromptUse.textContent).toBe("Using the new spot…");
      expect(a.dom.movePromptUse.disabled).toBe(true);
      expect(a.dom.movePromptCopy.disabled).toBe(true);
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await flush();
      expect(a.ctx.mintedLevel?.id).toBe(stored.id);
      expect(a.dom.movePrompt.hidden).toBe(true);
      expect(a.dom.movePromptUse.textContent).toBe("Use the new spot");
      expect(a.dom.status.textContent).toContain(
        "The code's saved position is now the new spot",
      );
      expect(a.dom.moveUndo.hidden).toBe(false);
      const measured = logs(a, "codeMeasured").at(-1)!;
      expect(measured["replaced"]).toEqual(stored);
      expect(logs(a, "codeMoveAnswered")).toEqual([
        expect.objectContaining({
          answer: "use-new-spot",
          replaced: true,
          error: null,
        }),
      ]);
      // Measured here now: no refusal, so no prompt however long.
      fix(MOVE_PROMPT_RULE.minFixes + 5);
      expect(a.dom.movePrompt.hidden).toBe(true);
    });

    it("'Use the new spot' says it is done only once the draft holds the new spot (M5b review #7)", async () => {
      // Why: the async-UI rule asks for the DURABLE end state. The replace
      // lands in memory at once, but a reload reads the draft: confirming
      // before its write landed claimed a backup that might never exist.
      const slow = slowDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(slow.store);
      await slow.release();
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel?.json).toBeDefined();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await flush();
      // Replaced in memory, the draft's write still held: in progress.
      expect(a.dom.movePromptUse.textContent).toBe("Using the new spot…");
      expect(a.dom.movePromptUse.disabled).toBe(true);
      expect(a.dom.status.textContent).not.toContain(
        "The code's saved position is now the new spot",
      );
      await slow.release();
      expect(a.dom.status.textContent).toContain(
        "The code's saved position is now the new spot",
      );
      expect(a.dom.movePrompt.hidden).toBe(true);
      const meta = JSON.parse(slow.files.get(META_KEY) as string) as {
        level: { json: string };
      };
      expect(meta.level.json).toBe(a.ctx.mintedLevel!.json);
    });

    it("'Use the new spot' whose draft write is refused says the new spot is not backed up", async () => {
      // Why: a refused write is the one failure the creator can still act
      // on (finish and download); "now the new spot" alone would hide it.
      const slow = slowDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(slow.store);
      await slow.release();
      fix(MOVE_PROMPT_RULE.minFixes);
      slow.mode.refuse = true;
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel?.json).toBeDefined();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await slow.release();
      expect(a.dom.movePromptUse.textContent).toBe("Use the new spot");
      expect(a.dom.status.textContent).toContain(
        "this device could not save the change",
      );
      expect(logs(a, "codeMoveAnswered")).toEqual([
        expect.objectContaining({ answer: "use-new-spot", replaced: true }),
      ]);
    });

    it("'Not now' and 'It's a second copy' whose draft write is refused say the walk is not backed up", async () => {
      // Why: both answers are remembered for a reload through the draft's
      // meta only; a refused write must reach the creator, through the one
      // backup notice.
      for (const button of ["movePromptLater", "movePromptCopy"] as const) {
        const slow = slowDraftStore();
        const { a, fix } = await secondVisitFarFromTheCode(slow.store);
        await slow.release();
        fix(MOVE_PROMPT_RULE.minFixes);
        slow.mode.refuse = true;
        a.dom[button].click();
        await slow.release();
        expect(a.dom.movePrompt.hidden, button).toBe(true);
        expect(a.dom.status.textContent, button).toContain(
          "This device is not saving a backup copy",
        );
      }
    });

    it("'Use the new spot' that cannot replace says why, keeps the saved position, and the prompt comes back", async () => {
      const { a, stored, fix } = await secondVisitFarFromTheCode();
      fix(MOVE_PROMPT_RULE.minFixes);
      // The camera lost the code between the render and the tap.
      a.ctx.lastDetectedText = null;
      a.dom.movePromptUse.click();
      await flush();
      expect(a.ctx.mintedLevel).toEqual(stored);
      expect(a.dom.status.textContent).toContain("Could not use the new spot");
      expect(logs(a, "codeMoveAnswered")).toEqual([
        expect.objectContaining({
          answer: "use-new-spot",
          replaced: false,
          error: expect.stringMatching(/./) as unknown,
        }),
      ]);
      // Not counted as asked: with the code back in view it asks again.
      a.seeTheCode();
      fix(1);
      expect(a.dom.movePrompt.hidden).toBe(false);
      expect(a.dom.movePromptUse.textContent).toBe("Use the new spot");
      expect(a.dom.moveUndo.hidden).toBe(true);
    });

    it("'Not now' and 'It's a second copy' keep the saved position, are logged, and are not asked again for the same spot - after a reload too", async () => {
      for (const [button, answer] of [
        ["movePromptLater", "not-now"],
        ["movePromptCopy", "second-copy"],
      ] as const) {
        const { store, files } = memoryDraftStore();
        const { a, stored, fix } = await secondVisitFarFromTheCode(store);
        fix(MOVE_PROMPT_RULE.minFixes);
        expect(a.dom.movePrompt.hidden).toBe(false);
        a.dom[button].click();
        await flush();
        expect(a.dom.movePrompt.hidden).toBe(true);
        expect(a.ctx.mintedLevel).toEqual(stored);
        expect(logs(a, "codeMoveAnswered")).toEqual([
          expect.objectContaining({ answer, replaced: false }),
        ]);
        fix(MOVE_PROMPT_RULE.minFixes + 5);
        expect(a.dom.movePrompt.hidden).toBe(true);
        const meta = JSON.parse(files.get(META_KEY) as string) as {
          moveAnswers: { answer: string; levelId: string }[];
        };
        expect(meta.moveAnswers).toEqual([
          expect.objectContaining({
            answer,
            levelId: stored.id,
            // Against the saved pose it was given for (M5b review #2).
            savedKey: savedPoseKey(stored.json),
          }),
        ]);

        // The reload: a new setup over the same draft, the same spot.
        const b = authoring({ store });
        await openFinishableTour(b);
        b.setup.presentDraftForTour(TOUR);
        await flush();
        b.ctx.mintedLevel = stored;
        b.beginVisit();
        b.setAlignment(yawAlignment(0, [60, 400, 0]));
        b.seeTheCode();
        await vi.waitFor(() => {
          expect(b.ctx.visitCodeSighting).not.toBeNull();
        });
        const more: unknown[] = [];
        for (let i = 0; i < MOVE_PROMPT_RULE.minFixes + 5; i += 1) {
          more.push({
            latitude: ZERO.lat,
            longitude: ZERO.lon,
            timestamp: T0 + i * 1000,
          });
          b.setWalk({ fixes: [...more], odometry: more.map(() => [0, 0, 0]) });
          b.setup.renderAuthorReadout();
        }
        expect(b.dom.status.textContent).toMatch(/Code seen 60 m/);
        expect(b.dom.movePrompt.hidden).toBe(true);
      }
    });

    it("Undo until Finish restores the saved position, drops the visit's move boundary, logs it, and does not ask again for that spot", async () => {
      const slow = slowDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(slow.store);
      await slow.release();
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await slow.release();
      // The visit ends: its log marks the move.
      a.endVisit();
      await slow.release();
      const visitFile = () =>
        [...slow.files.entries()]
          .filter(([k]) => k.startsWith(visitKey("")))
          .map(([, v]) => parseVisitLogEntry(v as string)!)
          .sort((x, y) => x.atMs - y.atMs)
          .at(-1)!;
      expect(
        visitFile().codes.find((c) => c.levelId === stored.id)?.moved,
      ).toBe(true);

      a.dom.moveUndoButton.click();
      // In progress until the draft holds the undo.
      expect(a.dom.moveUndoButton.textContent).toBe("Undoing…");
      expect(a.dom.moveUndoButton.disabled).toBe(true);
      await slow.release();
      expect(a.ctx.mintedLevel).toEqual(stored);
      expect(a.dom.moveUndo.hidden).toBe(true);
      expect(a.dom.status.textContent).toContain(
        "The code's saved position is back where it was",
      );
      expect(
        visitFile().codes.find((c) => c.levelId === stored.id)?.moved,
      ).toBeUndefined();
      const meta = JSON.parse(slow.files.get(META_KEY) as string) as {
        level: { json: string };
        moveAnswers: { answer: string }[];
      };
      expect(meta.level.json).toBe(stored.json);
      expect(meta.moveAnswers).toEqual([
        expect.objectContaining({ answer: "not-now" }),
      ]);
      expect(logs(a, "codeReplaceUndone")).toEqual([
        expect.objectContaining({
          levelId: stored.id,
          restored: stored,
          fromPrompt: true,
        }),
      ]);
    });

    it("an Undo whose draft write is refused says the undo is not backed up", async () => {
      const slow = slowDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(slow.store);
      await slow.release();
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await slow.release();
      slow.mode.refuse = true;
      a.dom.moveUndoButton.click();
      await slow.release();
      expect(a.ctx.mintedLevel).toEqual(stored);
      expect(a.dom.status.textContent).toContain(
        "this device could not save the change",
      );
    });

    it("Undo ends with a Finish", async () => {
      const { store } = memoryDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(store);
      a.ctx.tourManifestStatus = "settled";
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await flush();
      expect(a.dom.moveUndo.hidden).toBe(false);
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      await flush();
      expect(a.dom.moveUndo.hidden).toBe(true);
    });

    /** The newest visit-log entry the draft holds. */
    function lastVisitFile(files: Map<string, unknown>) {
      return [...files.entries()]
        .filter(([k]) => k.startsWith(visitKey("")))
        .map(([, v]) => parseVisitLogEntry(v as string)!)
        .sort((x, y) => x.atMs - y.atMs)
        .at(-1)!;
    }

    /** "Replace the code's saved position" through its confirm. */
    async function replaceWithTheButton(
      a: ReturnType<typeof authoring>,
      stored: { json: string },
    ): Promise<void> {
      a.setup.renderAuthorReadout();
      a.dom.replaceCodeButton.click();
      a.dom.replaceCodeYes.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel).not.toBeNull();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await flush();
    }

    it("does not log a sighting answered 'It's a second copy' as a visit of the stored code; 'Not now' still does (M5b review #11)", async () => {
      // Why: the visit log's code records are what the summary combines
      // into the code's position across visits (`codeVisitPoses`). A print
      // the creator called a second copy is not the stored code, so its
      // sighting 60 m away would drag that estimate towards the copy -
      // the opposite of what the answer said. "Not now" leaves it open,
      // so that sighting stays a visit.
      for (const [button, logged] of [
        ["movePromptCopy", false],
        ["movePromptLater", true],
      ] as const) {
        const { store, files } = memoryDraftStore();
        const { a, stored, fix } = await secondVisitFarFromTheCode(store);
        fix(MOVE_PROMPT_RULE.minFixes);
        expect(a.dom.movePrompt.hidden, button).toBe(false);
        a.dom[button].click();
        await flush();
        a.endVisit();
        await flush();
        const entry = lastVisitFile(files);
        expect(entry.gps.length, button).toBeGreaterThan(0);
        expect(
          entry.codes.some((c) => c.levelId === stored.id),
          button,
        ).toBe(logged);
      }
    });

    it("keeps Undo through a later measurement of the same code, whose level is briefly not in hand (M5b review #4)", async () => {
      // Why: a measurement empties the level in hand while its identity
      // hash is computed; a render in that moment (any fix) read that as
      // "another level took over" and withdrew Undo for good.
      const { a, stored, fix } = await secondVisitFarFromTheCode();
      fix(MOVE_PROMPT_RULE.minFixes);
      a.dom.movePromptUse.click();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel?.json).toBeDefined();
        expect(a.ctx.mintedLevel?.json).not.toBe(stored.json);
      });
      await flush();
      expect(a.dom.moveUndo.hidden).toBe(false);
      a.setup.renderAuthorReadout();
      a.dom.mintButton.click();
      expect(a.ctx.mintedLevel).toBeNull();
      a.setup.renderAuthorReadout();
      await vi.waitFor(() => {
        expect(a.ctx.mintedLevel?.id).toBe(stored.id);
      });
      await flush();
      expect(a.dom.moveUndo.hidden).toBe(false);
    });

    it("marks the visit's move boundary for a Replace-button replace too, not only for the prompt's (M5b review #3)", async () => {
      // Why: the boundary tells the summary which of the code's visits
      // came before the move. A replace moves the code whichever button
      // made it, so a visit replaced through the Replace button that
      // carried no mark was combined with the visits before the move.
      const { store, files } = memoryDraftStore();
      const { a, stored } = await secondVisitFarFromTheCode(store);
      await replaceWithTheButton(a, stored);
      a.endVisit();
      await flush();
      expect(
        lastVisitFile(files).codes.find((c) => c.levelId === stored.id)?.moved,
      ).toBe(true);
    });

    it("undoes a Replace-button replace as not from the prompt, leaves the remembered answers alone, and the prompt can return (M5b review #6)", async () => {
      // Why: Undo serves any replace (M5b review #3), but only a prompt's
      // replace answered a prompt. Logged as `fromPrompt: true`, or
      // remembered as a "Not now" for the spot, a Replace-button undo would
      // misreport the creator's answer and silence a prompt nobody was
      // ever shown for that spot.
      const { store, files } = memoryDraftStore();
      const { a, stored, fix } = await secondVisitFarFromTheCode(store);
      await replaceWithTheButton(a, stored);
      expect(a.dom.moveUndo.hidden).toBe(false);
      a.dom.moveUndoButton.click();
      await vi.waitFor(() => {
        expect(a.dom.status.textContent).toContain(
          "The code's saved position is back where it was",
        );
      });
      expect(a.ctx.mintedLevel).toEqual(stored);
      expect(logs(a, "codeReplaceUndone")).toEqual([
        expect.objectContaining({
          levelId: stored.id,
          restored: stored,
          fromPrompt: false,
        }),
      ]);
      const meta = JSON.parse(files.get(META_KEY) as string) as {
        level: { json: string };
        moveAnswers: unknown[];
      };
      expect(meta.level.json).toBe(stored.json);
      expect(meta.moveAnswers).toEqual([]);
      // The refusal stands again against the restored pose: once it has
      // lasted, the prompt asks.
      fix(MOVE_PROMPT_RULE.minFixes);
      expect(a.dom.movePrompt.hidden).toBe(false);
      expect(logs(a, "codeMovePrompted")).toHaveLength(1);
    });
  },
);
