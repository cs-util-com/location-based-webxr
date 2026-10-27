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
import { isAnyOf } from "@reduxjs/toolkit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { objectContentKey } from "./authoring-draft.js";
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
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { writeSideM } from "./printed-side.js";
import { SELECTION_MARK_NAME } from "./selection-mark.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { ObjectListHandlers, ObjectListModel } from "./object-list.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  endQrPipeline,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import {
  isCodeChange,
  isDocumentEdit,
  tourDocumentActions,
} from "./tour-document.js";
import { mintPin, objectPoseNue } from "./content-placement.js";
import {
  deletedKey,
  CODES_KEY,
  objectKey,
  readDraft,
  visitKey,
  parseDraftBase,
} from "./draft-persistence.js";
import type { SummaryModel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import { parseVisitLogEntry } from "./visit-log.js";
import { readCodeSpots } from "./level-spots.js";
import { readPrintedText } from "./level-printed.js";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { NOT_BACKED_UP, OUTCOME_HOLD_MS } from "./object-editing.js";
import { undoSettle } from "./creator-undo.js";
import { UPLOAD_ASK_LABELS } from "./creator-handoff.js";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import {
  correctedAlignment,
  odomNueFromWebXr,
  throughAlignment,
} from "./visit-anchoring.js";
import { asHosted, tourOf, withCaption } from "./test-support/tour-of.js";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";

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

// The code's id is a hash (async): the window in which a measurement is in
// flight. A test that needs that window holds it with `idHold`; otherwise
// this is the real function, unchanged.
const idHold = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  /** Calls let through before the gate holds. */
  pass: 0,
  held: 0,
}));
vi.mock(
  "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id",
  async (importOriginal) => {
    const actual = await importOriginal<{ qrCodeId: typeof qrCodeId }>();
    return {
      ...actual,
      qrCodeId: (text: string) => {
        if (idHold.gate === null) return actual.qrCodeId(text);
        if (idHold.pass > 0) {
          idHold.pass -= 1;
          return actual.qrCodeId(text);
        }
        idHold.held += 1;
        return idHold.gate.then(() => actual.qrCodeId(text));
      },
    };
  },
);

/**
 * Per-test timeout. A test here walks one or two whole AR visits through the
 * real fused-pose source (eight detections each, plus the mint): 0.4-1.2 s
 * on an idle machine, 5-10 s measured at 100% CPU with other suites running.
 * The default 5 s would make them fail on load alone, never on behaviour.
 */
const SLOW_MS = 30_000;

// The library's geo maths (minting a pin's pose, `worldNueToGps`) is
// licensed, and building a store activates it. Fixtures mint pins BEFORE
// their test builds a harness (`withHostedTour([hostedPin(...)])`), so
// without this a test passed only after an earlier one had built a store
// and failed alone (follow-up F8).
beforeAll(() => {
  createTourViewerStore();
});

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
  "newStationButton",
  "undoButton",
  "undoLabel",
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
    /** Attributes set (`aria-pressed` on "New station here"). */
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
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
    /** Holds the draft's opening until it settles (the window between
     *  the object list showing and the namespace being open). */
    storeOpens?: Promise<void>;
    summary?: Pick<SummaryPanel, "show" | "hide">;
  } = {},
) {
  /** Whether the AR session is up, as the controller reports it. */
  const device = { live: true };
  /** Photo encodes held until the test lets them land (`hold`). */
  const encodes: { hold: boolean; fail: boolean; waiting: (() => void)[] } = {
    hold: false,
    /** The encode rejects (a camera frame that cannot be encoded). */
    fail: false,
    waiting: [],
  };
  captured.configs.length = 0;
  const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
    (typeof DOM_KEYS)[number],
    ReturnType<typeof el>
  >;
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
  const withAccuracy = (fixes: unknown[]): unknown[] =>
    gps.accuracyM === undefined
      ? fixes
      : fixes.map((fix) => ({
          latLongAccuracy: gps.accuracyM,
          ...(fix as object),
        }));
  const arStore = {
    ...real,
    getState: () =>
      ({
        ...real.getState(),
        gpsData: {
          zero: gps.zero,
          gpsEvents: {
            alignmentMatrix: gps.alignment,
            // The store's median accuracy is its fixes', and the creator
            // reads it from them (device fixes only): a fix stating none
            // states the median set here.
            gpsPositions: withAccuracy(
              gps.walk?.fixes ??
                Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
                  latitude: ZERO.lat,
                  longitude: ZERO.lon,
                })),
            ),
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
  } as unknown as TourViewerStore;

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
    // The Finish saves the rebuilt zip by itself (field test 2, F4).
    downloadZip: () => Promise.resolve(true),
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
      const failure = new Error("the frame could not be encoded");
      if (!encodes.hold) {
        return encodes.fail ? Promise.reject(failure) : Promise.resolve(jpeg);
      }
      return new Promise((resolve, reject) => {
        encodes.waiting.push(() => {
          if (encodes.fail) reject(failure);
          else resolve(jpeg);
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
    openDraftStore: () =>
      (options.storeOpens ?? Promise.resolve()).then(() => options.store),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
  });
  // AFTER the wiring, which writes the page's default into the field (as
  // fused-pose-wiring.test.ts does): the creator typed this size.
  writeSideM(dom.sizeInput, SIZE_M);
  expect(setup.startAuthorPipeline()).toBe(true);
  // The synthetic detections are corners of a SIZE_M code: the pipeline
  // must solve them at that size, or every pose below carries a scale
  // error while the suite stays green (PR #595 review: the field was
  // written in metres, before the wiring overwrote it with 18 cm).
  expect(ctx.activeSizeM).toBe(SIZE_M);

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
    /** The page's seams, for a test that changes one (a save that does
     *  not go through). */
    seams: seams as {
      downloadZip: (blob: Blob, name: string) => Promise<boolean>;
    },
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

      const [pin, photo] = a.ctx.tourDocument.entries();
      expect(pin?.placement?.visit).toBe(0);
      expect(pin?.placement?.local.position).toEqual([2, 0, -1]);
      expect(photo?.object.kind).toBe("picture");
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

      const pin = a.ctx.tourDocument.entries()[0]!.object;
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
          id: a.ctx.tourDocument.entries()[0]!.object.id,
          geo: a.ctx.tourDocument.entries()[0]!.object.geo,
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
      const tapGeo = a.ctx.tourDocument.entries()[0]!.object.geo;
      const tapLevel = a.codes.inHand()!.json;
      a.setAlignment(yawAlignment(9, [2, 400, 2]));

      a.endVisit();
      await flush();

      const pin = a.ctx.tourDocument.entries()[0]!.object;
      expect(pin.geo, "the settle should have moved the pin").not.toEqual(
        tapGeo,
      );
      expect(a.codes.inHand()!.json).not.toBe(tapLevel);
      const onDisk = JSON.parse(
        String(files.get(objectKey(pin.id))),
      ) as TourObject;
      expect(onDisk.geo).toEqual(pin.geo);
      const codes = JSON.parse(String(files.get(CODES_KEY))) as {
        level: { json: string };
      };
      expect(codes.level.json).toBe(a.codes.inHand()!.json);
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

      const later = a.ctx.tourDocument.entries()[1]!.object;
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

      const later = a.ctx.tourDocument.entries()[1]!.object;
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
      const gate = a.ctx.tourDocument.entries()[0]!.object;
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
      const gate = a.ctx.tourDocument.entries()[0]!.object;
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
      const gate = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "Near A",
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
  // The tour's file is the empty one, unless the test already gave the
  // page a tour; work placed before it opened comes along (scan-to-open
  // plan §9 #5).
  if (a.ctx.tourDocument.manifest() === null) {
    a.ctx.tourDocument.open(createEmptyTourManifest());
  }
  return {
    releaseArchive: () => {
      for (const release of held.splice(0)) release();
    },
  };
}

/** The page's tour becomes `manifest` (the hosted file carries its
 *  objects now), this page's other entries kept with their pictures and
 *  AR placements - as a tour opened over work made before it. */
function hostInstead(
  a: { ctx: ReturnType<typeof createTourViewerSession> },
  manifest: TourManifest,
): void {
  const hosted = new Set(tourObjects(manifest).map((o) => o.id));
  const keep = a.ctx.tourDocument
    .entries()
    .filter((e) => !hosted.has(e.object.id));
  a.ctx.tourDocument.close();
  for (const e of keep) a.ctx.tourDocument.place(e.object, e, "kept");
  a.ctx.tourDocument.open(manifest);
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
  "a station started in a visit settles with it",
  { timeout: SLOW_MS },
  () => {
    // Why these tests matter: a station is anchored where its first item
    // stood at the tap, through the alignment at the tap; the visit's
    // settle then moves the item by the visit's correction. Left behind,
    // the anchor sits off the item it was started for (by the size of the
    // correction), and a correction near the found radius pushes the item
    // out of its own station. Through the real setup: the station is
    // re-posed with the visit's objects, and no item moves twice.
    /** The pin labelled `label` and the station frame it stands in. */
    function pinAndStation(a: ReturnType<typeof authoring>, label: string) {
      const pin = a.ctx.tourDocument
        .objects()
        .find(
          (o) => o.object.kind === "shortText" && o.object.caption === label,
        )!.object;
      const station = a.ctx.tourDocument
        .state()
        .stations.find((f) => f.id === pin.station)!;
      return { pin, station };
    }

    // A shift and a turn of the size a settle corrects in the field; the
    // anchor must follow at any size, so no value of either would change
    // the verdict (the planner's own tests sweep both past the radius).
    for (const [name, end] of [
      // 10 m north and 1 m up: the anchor takes its item's height too.
      ["a 10 m correction", yawAlignment(0, [10, 401, 0])],
      ["a 10 degree correction", yawAlignment(10, [0, 400, 0])],
    ] as const) {
      it(`keeps the visit's station anchored at its first item after ${name}`, async () => {
        const a = authoring();
        await a.placePin("first", [12, 0, -5]);
        await a.placePin("second", [20, 0, 3]);
        const tap = pinAndStation(a, "first");
        expect(pinAndStation(a, "second").station.id).toBe(tap.station.id);
        a.setAlignment([...end]);

        a.endVisit();

        const { pin, station } = pinAndStation(a, "first");
        expect(
          worldOf(pin.geo).distanceTo(worldOf(tap.pin.geo)),
          "the settle moved the item",
        ).toBeGreaterThan(1);
        expect(station.id).toBe(tap.station.id);
        expect(station.geo).toMatchObject({
          lat: pin.geo.lat,
          lon: pin.geo.lon,
          alt: pin.geo.alt,
        });
        // The second item stands where the settle puts it - once, not
        // also shifted by its station's move - and still in the station.
        const second = pinAndStation(a, "second");
        expect(second.station.id).toBe(station.id);
        expect(
          worldOf(second.pin.geo).distanceTo(
            new Vector3(
              ...throughAlignment(
                { position: [20, 0, 3], rotation: [0, 0, 0, 1] },
                [...end],
              )!.position,
            ),
          ),
        ).toBeLessThan(1e-3);
        expect(a.ctx.tourDocument.state().stations).toHaveLength(1);
      });
    }

    it("leaves a station an earlier visit started where that visit settled it", async () => {
      const a = authoring();
      await a.placePin("first", [12, 0, -5]);
      a.endVisit();
      const before = pinAndStation(a, "first").station.geo;
      a.beginVisit();
      a.setAlignment(yawAlignment(0, [10, 400, 0]));
      await a.placePin("later", [40, 0, 40]);
      a.endVisit();
      expect(pinAndStation(a, "first").station.geo).toEqual(before);
    });

    it("leaves an item of the visit's station that this visit did not place where it stood", async () => {
      // Why: the settle moves the visit's station rigidly with its items
      // and then puts back only this visit's items at their settled
      // spots. An item that joined the station from earlier work (moved
      // into its radius here, a restored draft) is no item of this visit:
      // the visit's correction says nothing about where it stands, so it
      // must not be shifted with the station.
      const a = authoring();
      await a.placePin("old", [12, 0, -5]);
      a.endVisit();
      a.beginVisit();
      await a.placePin("first", [40, 0, 40]);
      const started = pinAndStation(a, "first").station.id;
      const old = pinAndStation(a, "old").pin;
      const near = pinAndStation(a, "first").pin.geo;
      a.ctx.tourDocument.move(
        { ...old, geo: { ...old.geo, lat: near.lat + 0.00003, lon: near.lon } },
        "a note",
      );
      const joined = pinAndStation(a, "old");
      expect(joined.station.id, "it joined the visit's station").toBe(started);
      a.setAlignment(yawAlignment(0, [10, 401, 0]));

      a.endVisit();

      const after = pinAndStation(a, "old");
      expect(after.station.id).toBe(started);
      expect(
        worldOf(after.pin.geo).distanceTo(worldOf(joined.pin.geo)),
        "not shifted by the station's settle",
      ).toBeLessThan(1e-3);
      expect(
        worldOf(pinAndStation(a, "first").pin.geo).distanceTo(worldOf(near)),
        "the visit's own item did settle",
      ).toBeGreaterThan(1);
    });
  },
);

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

      const photo = a.ctx.tourDocument.entries().at(-1)!.object;
      expect(photo.kind).toBe("picture");
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

      const photo = a.ctx.tourDocument.entries().at(-1)!.object;
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
      const photo = a.ctx.tourDocument.entries().at(-1)!.object;
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

    it("in AR the Done is the one way out: the panel's Finish steps aside, and Done finishes only when a finish can start (polish round M3, Q-Done)", async () => {
      // Why: Exit AR and Finish did the same thing in two buttons (B6). In
      // a session the AR button's Done runs the finish (`finishNow`); the
      // panel's Finish is hidden then, and comes back as the retry after
      // a failed finish or on the page.
      const a = authoring();
      const tour = await openFinishableTour(a, { holdArchive: true });
      a.setup.renderAuthorReadout();
      expect(a.dom.finishButton.hidden).toBe(true);
      // Nothing measured, nothing placed: no finish can start yet.
      expect(a.setup.finishNow()).toBe(false);
      expect(a.ctx.finishing).toBe(false);
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.setup.finishNow()).toBe(true);
      expect(a.ctx.finishing).toBe(true);
      tour.releaseArchive();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
    });

    it("a Done while a code is being measured keeps the session, says so first, and saves once it is measured (PR #598 review, F17, r837 review)", async () => {
      // Why: a finish waits for an in-flight measurement, so Done's
      // finishNow was false and the session ended with changes unsaved and
      // nothing said in AR. Then the explanation was appended last and
      // wiped by the re-render after Done (#599 review), and at the end of
      // a status clamped to two lines in AR (r837 review #1). Now it LEADS
      // the line, survives re-renders, and the save the creator asked for
      // starts by itself when the measurement lands - a window of
      // milliseconds is no time to read "tap again" (r837 review #2).
      const a = authoring();
      await openFinishableTour(a);
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      // A second code: its first id call (seeing it) passes, the
      // measurement's is held - the measurement is in flight.
      const SECOND_TEXT = "https://gps.csutil.com/tour/?qr=second";
      let release: () => void = () => undefined;
      idHold.pass = 1;
      idHold.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const measured = () =>
          a.dispatched.filter((x) => x.type === "tourAuthoring/codeMeasured")
            .length;
        const before = measured();
        a.seeTheCode(new Matrix4().makeTranslation(1, 0, 0), SECOND_TEXT);
        await vi.waitFor(() => {
          expect(idHold.held).toBeGreaterThan(0);
        });
        expect(a.setup.finishNow()).toBe(true);
        expect(a.ctx.finishing).toBe(false);
        const waits = /^A code is being measured - the tour saves as soon/;
        expect(a.dom.status.textContent).toMatch(waits);
        // `ar-entry.ts` re-renders right after Done (`renderArState`), and
        // every store dispatch re-renders too.
        a.setup.renderAuthorReadout();
        expect(a.dom.status.textContent).toMatch(waits);
        idHold.gate = null;
        release();
        await vi.waitFor(() => {
          expect(measured()).toBeGreaterThan(before);
        });
        // No second Done: the measurement's landing starts the save. Read
        // from its result - an unheld archive finishes within a tick, so
        // `finishing` may already be false again.
        await vi.waitFor(() => {
          expect(a.ctx.rebuiltZip).not.toBeNull();
        });
        await finished(a.ctx);
        expect(a.ctx.finishError).toBeNull();
        expect(a.dom.status.textContent).not.toMatch(waits);
      } finally {
        idHold.gate = null;
        idHold.held = 0;
        idHold.pass = 0;
        release();
      }
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

      const written = tourObjects(a.ctx.tourDocument.manifest()!).map((o) =>
        o.kind === "shortText" ? o.caption : o.id,
      );
      expect(written).toEqual(["Gate"]);
      expect(a.ctx.tourDocument.entries().map((p) => p.object.kind)).toEqual([
        "picture",
      ]);
      const photo = a.ctx.tourDocument.entries()[0]!.object;
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
      a.ctx.tourDocument.place(old, {}, "an earlier visit's pin");
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
      const offset = worldOf(a.ctx.tourDocument.entries()[0]!.object.geo).sub(
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
          JSON.parse(String(files.get(CODES_KEY))) as {
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
      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "Beside A",
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

    // Why this test matters: "Use this size" for the stored code in hand
    // empties the hand and starts measuring again at the new size - the
    // sightings before it were solved at a size now known to be wrong.
    // M5a milestone review #1 dropped them, so the visit settled plainly;
    // the owner's field recording of 2026-10-08 (F2) showed what that
    // costs: four pins the creator had corrected through the code settled
    // through the plain GPS alignment, 104 degrees off, 3 to 6 m from
    // where they were put. Owner decision D-F2: those sightings still
    // place the visit's objects (the old size errs by centimetres); they
    // no longer decide anything about the code itself.
    it("places a pin from before a size adoption through the code, still", async () => {
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
      const codeLocal = mintedOdom(a.dispatched);
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
      expect(settled.objects[0]?.basis).toBe("code-corrected");
      expect(settled.basis).toBe("code-corrected");
      // Placed relative to the code as it is stored, not 20 m off.
      const pin = a.ctx.tourDocument
        .entries()
        .find((p) => p.object.kind === "shortText")!.object;
      const offset = worldOf(pin.geo).sub(codeWorldOf(hosted.json));
      expect(
        offset.distanceTo(new Vector3(3, 0, 1).sub(codeLocal)),
      ).toBeLessThan(1e-2);
      // And the code itself is not decided from them: nothing re-mints it.
      expect(settled.level).toBeNull();
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

    it("writes the code's printed text on its level, and the visit's re-mint keeps it (F2)", async () => {
      // Why: the level is filed under a hash of the text, so a re-print
      // could only guess the spelling it was printed from; the text on the
      // level is what it reads instead. The settle re-mints the level at
      // the visit's end - the text must survive that.
      const a = authoring();
      await a.mint();
      const measured = a.codes.inHand()!.json;
      expect(readPrintedText(measured)).toBe(TEXT);
      a.setAlignment(yawAlignment(3, [1, 400, 1]));
      a.endVisit();
      // The settle re-minted it (r834 review #3: else the carry is untested).
      expect(a.codes.inHand()!.json).not.toBe(measured);
      expect(readPrintedText(a.codes.inHand()!.json)).toBe(TEXT);
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
      /^First, point the camera at this tour's printed code:/,
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

    /** A photo the hosted zip carries, by the zero. */
    function hostedPhoto(id: string): TourObject {
      return {
        id,
        kind: "picture",
        view: "plane",
        image: id,
        widthM: 1,
        imageAsset: {
          id: id,
          path: `content/${id}.jpg`,
          kind: "image",
          width: 4,
          height: 3,
        },
        createdAtIso: "2026-09-29T10:00:00.000Z",
        geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 400, rotation: [0, 0, 0, 1] },
      };
    }

    /** A creator in AR with a hosted tour open whose zip carries `objects`. */
    async function withHostedTour(
      objects: TourObject[],
      store?: DraftFileStore,
    ) {
      const a = authoring(store === undefined ? {} : { store });
      await openFinishableTour(a);
      a.ctx.tourDocument.open(tourOf(objects));
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
      // The hosted pin as its station reads it back, its text changed.
      expect(a.ctx.tourDocument.entries().map((p) => p.object)).toEqual([
        {
          ...asHosted(hostedPin("h1", "Hosted gate")),
          caption: "The old mill",
        },
      ]);
      expect(a.labels.some((o) => o.name === "The old mill")).toBe(true);
      expect(a.ctx.placedPreviews.size).toBe(1);
      const log = logged(a, "tourAuthoring/objectEdited").at(-1)!.payload;
      expect((log["before"] as { caption: string }).caption).toBe(
        "Hosted gate",
      );
      expect((log["after"] as { caption: string }).caption).toBe(
        "The old mill",
      );
      expect(log["surface"]).toBe("ar");
      expect(a.dom.objectList.lastModel?.note).toMatch(/Saved "The old mill"/);
      // An empty text changes nothing.
      a.dom.objectList.listHandlers!.editText("h1", "   ");
      expect(a.ctx.tourDocument.entries()[0]?.object).toMatchObject({
        caption: "The old mill",
      });
    });

    it("records the hosted version an edit started from, once (M6 E2p)", async () => {
      // Why: the base is what lets a newer edit elsewhere (the desktop
      // editor) win over this draft; a second edit must not move it.
      const { store, files } = memoryDraftStore();
      const hosted = hostedPin("h1", "Gate");
      const a = await withHostedTour([hosted], store);
      a.pick.fn = () => "h1";
      a.setup.selectInView(null);
      a.dom.objectList.listHandlers!.editText("h1", "First");
      await flush();
      a.dom.objectList.listHandlers!.editText("h1", "Second");
      await flush();
      expect(parseDraftBase(files.get("base:h1") as string)).toEqual({
        seen: [objectContentKey(asHosted(hosted))],
        written: [],
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
      expect(a.ctx.tourDocument.deleted()).toEqual(["h1"]);
      expect(a.ctx.placedPreviews.has("h1")).toBe(false);
      expect(files.has(deletedKey("h1"))).toBe(true);
      expect(a.dom.objectList.lastModel?.rows).toEqual([]);
      expect(a.dom.objectList.lastModel?.note).toMatch(
        /Deleted "Gate" - it leaves the zip when you save the tour/,
      );
      const log = logged(a, "tourAuthoring/objectDeleted").at(-1)!.payload;
      expect(log["hosted"]).toBe(true);
    });

    it("deletes a pin placed on this device outright - no tombstone, its draft file gone", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([], store);
      await a.mint();
      await a.placePin("Temp", [1, 0, 1]);
      const id = a.ctx.tourDocument.entries().at(-1)!.object.id;
      expect(files.has(objectKey(id))).toBe(true);
      a.dom.objectList.listHandlers!.remove(id);
      await flush();
      expect(a.ctx.tourDocument.entries()).toEqual([]);
      expect(a.ctx.tourDocument.deleted()).toEqual([]);
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
      const gate = a.ctx.tourDocument.entries()[0]!.object;
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

      const moved = a.ctx.tourDocument.entries()[0]!.object;
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
        worldOf(a.ctx.tourDocument.entries()[0]!.object.geo).distanceTo(
          worldOf(moved.geo),
        ),
      ).toBeLessThan(1e-2);
    });

    // Why (the owner's field recording of 2026-10-08): the four pins the
    // creator corrected beside the stored code settled through the visit's
    // plain GPS alignment - turned 104 degrees from the code-corrected one
    // they were moved through - once the visit walked on and saw the code
    // again. A move made through the code must settle through the code.
    it("keeps a pin moved through the code there after the visit walks on and sees the code again", async () => {
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      const gate = a.ctx.tourDocument.entries()[0]!.object;
      // The next visit: its GPS is 20 m and 30 degrees off.
      a.beginVisit();
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      // The walk: still at the code for the move, then 30 m out and back.
      const fixes: unknown[] = [];
      const odometry: number[][] = [];
      for (let i = 0; i <= 65; i += 1) {
        const n = i < 5 ? 0 : i <= 35 ? i - 5 : 65 - i;
        fixes.push({
          latitude: ZERO.lat + (n / 6_371_000) * (180 / Math.PI),
          longitude: ZERO.lon,
          latLongAccuracy: 6,
        });
        odometry.push([n, 0, 0]);
      }
      a.setWalk({ fixes: fixes.slice(0, 5), odometry: odometry.slice(0, 5) });
      a.seeTheCode();
      await flush();
      a.setReticle([4, 0, 2]);
      a.dom.objectList.listHandlers!.move(gate.id);
      await flush();
      const moved = a.ctx.tourDocument.entries()[0]!.object;
      expect(
        logged(a, "tourAuthoring/objectMoved").at(-1)!.payload["basis"],
      ).toBe("code-corrected");
      // Walk on, and see the code again at the end.
      a.setWalk({ fixes, odometry });
      a.setup.renderAuthorReadout();
      a.seeTheCode(undefined, TEXT, 120_000);
      await flush();
      a.endVisit();
      await flush();
      const settled = a.settledLogs().at(-1)!.payload as {
        objects?: { id: string; basis: string }[];
      };
      expect(settled.objects?.find((o) => o.id === gate.id)?.basis).toBe(
        "code-corrected",
      );
      expect(
        worldOf(a.ctx.tourDocument.entries()[0]!.object.geo).distanceTo(
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

    it("lets the selection go with Close, back to placing (polish round M3, Q-HUD)", async () => {
      // Why: object mode is left by Close (H1's object bar, renamed from Done) as well as by a
      // tap on empty scene; the place buttons come back with it.
      const a = await withHostedTour([
        hostedPin("h1", "Gate"),
        hostedPin("h2", "Mill"),
      ]);
      await a.mint();
      const list = a.dom.objectList;
      a.pick.fn = () => "h2";
      a.setup.selectInView(null);
      expect(list.lastModel!.rows.map((r) => r.id)).toEqual(["h2"]);
      expect(a.dom.pinButton.hidden).toBe(true);
      list.listHandlers!.deselect();
      expect(list.lastModel!.rows).toEqual([]);
      expect(a.dom.pinButton.hidden).toBe(false);
    });

    it("marks the selected object in the scene, and takes the mark away with the selection (polish round M3, B2)", async () => {
      // Why: the owner wants to SEE what a tap selected (B2); the list row
      // alone is off to the side of the camera view.
      const a = await withHostedTour([
        hostedPin("h1", "Gate"),
        hostedPin("h2", "Mill"),
      ]);
      await flush();
      const ringOn = (id: string) =>
        (a.ctx.placedPreviews.get(id)?.root.children ?? []).some(
          (c) => c.name === SELECTION_MARK_NAME,
        );
      expect(a.ctx.placedPreviews.has("h2")).toBe(true);
      a.pick.fn = () => "h2";
      a.setup.selectInView(null);
      expect(ringOn("h2")).toBe(true);
      expect(ringOn("h1")).toBe(false);
      a.dom.objectList.listHandlers!.deselect();
      expect(ringOn("h2")).toBe(false);
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
      // On the page: in AR the strip's persistent Undo takes the note's
      // place, so the note's Undo is the page's.
      a.endVisit();
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.undo).toBe(true);
      expect(files.has(deletedKey("h1"))).toBe(true);

      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.tourDocument.deleted()).toEqual([]);
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
      expect(a.ctx.tourDocument.entries().map((p) => p.object)).toMatchObject([
        { id: "h1", caption: "Mill" },
      ]);
      expect(JSON.parse(String(files.get(objectKey("h1"))))).toMatchObject({
        block: {
          caption: "Mill",
        },
      });
      expect(files.has(deletedKey("h1"))).toBe(false);

      await a.mint();
      await a.placePin("Temp", [1, 0, 1]);
      const id = a.ctx.tourDocument.entries().at(-1)!.object.id;
      list.listHandlers!.remove(id);
      await flush();
      expect(files.has(objectKey(id))).toBe(false);
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.tourDocument.entries().map((p) => p.object.id)).toEqual([
        "h1",
        id,
      ]);
      expect(files.has(objectKey(id)), "its record is written back").toBe(true);
    });

    it("an Undo tapped after a later change takes back nothing (the review's LOW-1)", async () => {
      // Why: the button is withdrawn at the next render, but a change that
      // renders nothing (a settle's re-pose, a listener's edit) could land
      // before the tap - and the document's undo would take back THAT.
      const a = await withHostedTour([
        hostedPin("h1", "Gate"),
        hostedPin("h2", "Mill"),
      ]);
      // On the page: in AR the strip's persistent Undo takes the note's
      // place, so the note's Undo is the page's.
      a.endVisit();
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.undo).toBe(true);
      const h2 = a.ctx.tourDocument
        .objects()
        .find((o) => o.object.id === "h2")!.object;
      a.ctx.tourDocument.edit(withCaption(h2, "Later"), "a later change");
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.tourDocument.deleted()).toEqual(["h1"]);
      expect(
        a.ctx.tourDocument.objects().find((o) => o.object.id === "h2")?.object,
      ).toMatchObject({ caption: "Later" });
      expect(list.lastModel?.undo).toBe(false);
    });

    // Why these tests matter: in AR the strip's
    // Undo is the one Undo - persistent, where the note's went after its
    // hold - and it takes back exactly the delete it names, through the
    // same path as the note's (`undoDelete`: the list, the scene, the
    // draft, the log).
    it("offers a delete in AR in the strip's Undo, past the note's hold, and a tap brings the pin back to the list, the scene, the draft and the log", async () => {
      const { store, files } = memoryDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], store);
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(a.dom.undoLabel.textContent).toBe('Undo: delete "Gate"');
      expect(a.dom.undoButton.disabled).toBe(false);
      // One Undo in AR: the note says what happened, the strip undoes it.
      expect(list.lastModel?.note).toMatch(/^Deleted "Gate"/);
      expect(list.lastModel?.undo).toBe(false);
      a.fireTimers();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled, "past the note's hold").toBe(false);

      a.dom.undoButton.click();
      await flush();
      expect(a.ctx.tourDocument.deleted()).toEqual([]);
      expect(a.ctx.placedPreviews.has("h1")).toBe(true);
      expect(files.has(deletedKey("h1")), "the tombstone is gone").toBe(false);
      expect(list.lastModel?.note).toMatch(/Restored "Gate"/);
      expect(logged(a, "tourAuthoring/objectDeleteUndone")).toHaveLength(1);
      // Single level: nothing further is offered.
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");
    });

    it("withdraws the strip's Undo of a delete once a later change is the last step, and a tap after an unrendered change takes back nothing", async () => {
      const a = await withHostedTour([
        hostedPin("h1", "Gate"),
        hostedPin("h2", "Mill"),
        hostedPin("h3", "Oak"),
      ]);
      const list = a.dom.objectList;
      list.listHandlers!.editText("h3", "Barn");
      await flush();
      expect(a.dom.undoButton.disabled, "an edit is not offered").toBe(true);
      list.listHandlers!.remove("h1");
      await flush();
      expect(a.dom.undoButton.disabled).toBe(false);
      list.listHandlers!.editText("h2", "Later");
      await flush();
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");

      list.listHandlers!.remove("h2");
      await flush();
      expect(a.dom.undoLabel.textContent).toBe('Undo: delete "Later"');
      const h3 = a.ctx.tourDocument
        .objects()
        .find((o) => o.object.id === "h3")!.object;
      // A change that renders nothing, then the tap.
      a.ctx.tourDocument.edit(withCaption(h3, "Shed"), "a later change");
      a.dom.undoButton.click();
      await flush();
      expect(a.ctx.tourDocument.deleted()).toEqual(["h1", "h2"]);
      expect(
        a.ctx.tourDocument.objects().find((o) => o.object.id === "h3")?.object,
      ).toMatchObject({ caption: "Shed" });
    });

    // Why: the async-UI rule (root CLAUDE.md) for the strip's tap - the
    // chip says it runs until the draft writes settle, then the note names
    // what was undone, and a write that did not land is said.
    it("shows Undoing… on the strip until the undo's draft writes land, then the outcome - and says so when they are refused", async () => {
      const slow = slowDraftStore();
      const a = await withHostedTour(
        [hostedPin("h1", "Gate"), hostedPin("h2", "Mill")],
        slow.store,
      );
      await slow.release();
      const list = a.dom.objectList;
      // Edited first, so the undo writes the pin's record back (a held
      // write); a hosted pin as the file has it only drops its tombstone.
      list.listHandlers!.editText("h1", "Gate 2");
      await slow.release();
      list.listHandlers!.remove("h1");
      await slow.release();
      a.dom.undoButton.click();
      await flush();
      expect(a.dom.undoLabel.textContent).toBe("Undoing…");
      expect(a.dom.undoButton.disabled).toBe(true);
      await slow.release();
      expect(a.dom.undoLabel.textContent).toBe("Undo");
      expect(list.lastModel?.note).toBe('Restored "Gate 2".');

      list.listHandlers!.editText("h2", "Mill 2");
      await slow.release();
      list.listHandlers!.remove("h2");
      await slow.release();
      slow.mode.refuse = true;
      a.dom.undoButton.click();
      await flush();
      expect(a.dom.undoLabel.textContent).toBe("Undoing…");
      await slow.release();
      expect(a.dom.undoLabel.textContent).toBe("Undo");
      expect(list.lastModel?.note).toMatch(
        /^Restored "Mill 2", but this device could not save a backup copy/,
      );
    });

    // Why: the document refuses an undo that brings back a photo whose
    // picture is not on this device (a Finish wrote the delete, and the
    // picture was never read). Through the strip the note must say why,
    // and the chip stays as it was - still offering the delete.
    it("says why the strip's Undo cannot bring back a deleted photo whose picture is gone, and keeps offering it", async () => {
      const a = await withHostedTour([hostedPhoto("f1")]);
      // The picture is never read: the zip's entry does not load.
      (
        a.ctx.session as unknown as { loadContentEntry: () => Promise<Blob> }
      ).loadContentEntry = () => Promise.reject(new Error("not cached"));
      a.dom.objectList.listHandlers!.remove("f1");
      await flush();
      expect(a.dom.undoLabel.textContent).toBe("Undo: delete the photo");
      // A Finish wrote the delete: the file no longer carries the photo.
      const doc = a.ctx.tourDocument;
      const generation = doc.saveStarted();
      doc.saved({
        generation,
        written: tourOf([]),
        appliedDeletions: ["f1"],
        stationsAtStart: doc.state().stations,
      });
      doc.saveEnded(generation);
      a.setup.renderAuthorReadout();
      a.dom.undoButton.click();
      await flush();
      expect(a.dom.objectList.lastModel?.note).toBe(
        "the photo cannot come back: its picture is no longer on this device.",
      );
      expect(a.ctx.placedPreviews.has("f1"), "still deleted").toBe(false);
      expect(a.dom.undoButton.disabled).toBe(false);
      expect(a.dom.undoLabel.textContent).toBe("Undo: delete the photo");
    });

    // Why: the strip offers a delete at once, before its draft write
    // landed. A tap then says "Restoring ..."; the delete's own outcome,
    // arriving later, must not overwrite that with "Deleted ..." - the
    // creator would read that the pin is gone when it is back.
    it("does not let a delete's late outcome overwrite the strip's undo of it", async () => {
      const slow = slowDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], slow.store);
      await slow.release();
      const list = a.dom.objectList;
      // Every note the list is drawn with, in order.
      const notes: string[] = [];
      const draw = list.render.bind(list);
      list.render = (model: ObjectListModel) => {
        notes.push(model.note);
        draw(model);
      };
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.note).toBe('Deleting "Gate"…');
      a.dom.undoButton.click();
      await flush();
      await slow.release();
      expect(a.ctx.tourDocument.deleted()).toEqual([]);
      const restoring = notes.indexOf('Restoring "Gate"…');
      expect(restoring, "the undo said it runs").toBeGreaterThanOrEqual(0);
      expect(
        notes.slice(restoring).filter((n) => n.startsWith("Deleted")),
      ).toEqual([]);
      expect(list.lastModel?.note).toBe('Restored "Gate".');
    });

    // Why: the guard above keeps a late "Deleted ..." from overwriting
    // the undo, but a write that did not land is the creator's to know
    // whatever came after it: only the confirmation is dropped, never the
    // warning that the device holds no backup copy.
    it("still says a late delete's failed backup once the delete is no longer the last step", async () => {
      const slow = slowDraftStore();
      const a = await withHostedTour([hostedPin("h1", "Gate")], slow.store);
      await slow.release();
      const list = a.dom.objectList;
      const notes: string[] = [];
      const draw = list.render.bind(list);
      list.render = (model: ObjectListModel) => {
        notes.push(model.note);
        draw(model);
      };
      slow.mode.refuse = true;
      list.listHandlers!.remove("h1");
      await flush();
      a.dom.undoButton.click();
      await flush();
      await slow.release();
      const restoring = notes.indexOf('Restoring "Gate"…');
      expect(restoring).toBeGreaterThanOrEqual(0);
      const after = notes.slice(restoring);
      expect(after.filter((n) => n.startsWith("Deleted"))).toEqual([]);
      expect(after).toContain(
        `The delete of "Gate" could not be backed up: ${NOT_BACKED_UP}`,
      );
    });

    // Why: on the page there is no strip (the AR controls are the
    // session's), so the delete's outcome keeps its own Undo there.
    it("keeps the note's Undo beside a delete's outcome on the page", async () => {
      const a = await withHostedTour([hostedPin("h1", "Gate")]);
      a.endVisit();
      a.setup.renderAuthorReadout();
      a.dom.objectList.listHandlers!.remove("h1");
      await flush();
      expect(a.dom.objectList.lastModel?.undo).toBe(true);
      expect(a.dom.controls.hidden, "no strip on the page").toBe(true);
    });

    it(`withdraws Undo after ${String(OUTCOME_HOLD_MS)} ms, and an expired Undo restores nothing`, async () => {
      const a = await withHostedTour([hostedPin("h1", "Gate")]);
      // On the page: in AR the strip's persistent Undo takes the note's
      // place, so the note's Undo is the page's.
      a.endVisit();
      const list = a.dom.objectList;
      list.listHandlers!.remove("h1");
      await flush();
      expect(list.lastModel?.undo).toBe(true);
      expect(a.timers.at(-1)?.ms).toBe(OUTCOME_HOLD_MS);
      a.fireTimers();
      expect(list.lastModel?.undo).toBe(false);
      list.listHandlers!.undo();
      await flush();
      expect(a.ctx.tourDocument.deleted()).toEqual(["h1"]);
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
      /** The stored level as a build before F2 wrote it: no printed text. */
      storedWithoutText?: boolean;
      /** A draft store, the tour's draft opened on it before the mint. */
      store?: DraftFileStore;
    }) {
      const a = authoring(
        opts.store === undefined ? {} : { store: opts.store },
      );
      if (opts.store !== undefined) {
        a.setup.presentDraftForTour("https://example.test/tour.zip");
        await flush();
      }
      await a.mint();
      await a.placePin("near", [2, 0, -1]);
      await a.placePin("far", [60, 0, 0]);
      a.endVisit();
      if (opts.storedWithoutText === true) {
        const level = a.codes.inHand()!;
        const data = JSON.parse(level.json) as { qr: Record<string, unknown> };
        delete data.qr["printed"];
        a.codes.saveLevel({ id: level.id, json: JSON.stringify(data) });
      }
      const stored = a.codes.inHand()!;
      const pins = () =>
        new Map(
          a.ctx.tourDocument
            .entries()
            .map((p) => [
              p.object.kind === "shortText" ? p.object.caption : p.object.id,
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
          a.ctx.tourDocument
            .entries()
            .map((p) => [
              p.object.kind === "shortText" ? p.object.caption : p.object.id,
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
      const between = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "between",
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

    // Why (the 2026-10-08 field test, F3; owner decision D-F3): the stored
    // code's direction disagreed with the visit's GPS by 104 degrees; the
    // visit was turned that much to fit it, and the result screen said only
    // that the walk was too short. It now says that the two disagree.
    // 70 degrees: above the warning's 60, below what a 10 m walk at 5 m
    // can be off by (about 80, field test 3's limit), so the code still
    // corrects the visit.
    it("says on the result screen when the visit was turned a lot to fit the code", async () => {
      const { a } = await secondVisit({ yawDeg: 70, northM: 3, walkM: 10 });
      await openFinishableTour(a);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.dom.finishStatus.textContent).toMatch(
        /disagree by about 70 degrees/,
      );
    });

    // Why this test matters (field test 3, F6; owner decisions D-F6a and
    // D-F6b): the stored code's heading was about 100 degrees off, the
    // walk short of the position rule, and the Finish turned the whole
    // visit to fit the code - a pin placed 13 m away moved 24 m. Beyond
    // what the visit's GPS heading can be off by, the code is replaced and
    // the visit's own pins stay where they were placed.
    it("replaces a code whose stored heading the visit's GPS cannot explain, and leaves the visit's pins where they were placed", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 100,
        northM: 3,
        walkM: 10,
      });
      await a.placePin("bank", [10, 0, -8]);
      const placed = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "bank",
        )!.object.geo;
      a.endVisit();
      const decision = codePosition(a)?.decision as {
        kind: string;
        turnedDeg?: number;
      };
      expect(decision.kind).toBe("replace");
      expect(decision.turnedDeg).toBeCloseTo(100, 0);
      expect(codePosition(a)?.applied).toBe(true);
      expect(a.codes.inHand()?.json).not.toBe(stored.json);
      const bank = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "bank",
        )!.object.geo;
      expect(worldOf(bank).distanceTo(worldOf(placed))).toBeLessThan(0.1);
      await openFinishableTour(a);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.dom.finishStatus.textContent).toMatch(
        /saved direction was corrected: this visit's GPS disagreed with it by about 100 degrees/,
      );
      expect(a.dom.finishStatus.textContent).not.toMatch(/disagree by about/);
    });

    // Why this test matters: a station this visit started stands at its
    // first item, which the settle put through this visit's alignment -
    // the improved code's already. Taken along by the code as well, it
    // would move off its items, which the settle puts back.
    it("leaves a station this visit started at its first item, though the improved code reaches it", async () => {
      const { a } = await secondVisit({ yawDeg: 20, northM: 3, walkM: 30 });
      // About 28 m from the code and 29 m from the near pin's station: a
      // station of its own, within the code's reach.
      await a.placePin("new", [-28, 0, -12]);

      a.endVisit();
      expect(codePosition(a)?.decision).toEqual({ kind: "replace" });
      expect(codePosition(a)?.applied).toBe(true);
      const pin = a.ctx.tourDocument
        .objects()
        .find(
          (o) => o.object.kind === "shortText" && o.object.caption === "new",
        )!.object;
      const station = a.ctx.tourDocument
        .state()
        .stations.find((f) => f.id === pin.station)!;
      const near = a.ctx.tourDocument
        .objects()
        .find(
          (o) => o.object.kind === "shortText" && o.object.caption === "near",
        )!.object;
      expect(station.id).not.toBe(near.station);
      expect(station.geo).toMatchObject({
        lat: pin.geo.lat,
        lon: pin.geo.lon,
        alt: pin.geo.alt,
      });
      expect(codePosition(a)?.movedWithCode.map((m) => m.id)).toEqual([
        near.id,
      ]);
    });

    it("says nothing of a turn when the visit fits the code within the threshold", async () => {
      const { a } = await secondVisit({ yawDeg: 20, northM: 3, walkM: 10 });
      await openFinishableTour(a);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.dom.finishStatus.textContent).not.toMatch(/disagree/);
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

    // Why (r834 milestone review #1): a code measured before F2 is kept as
    // the stored reference when it is measured again, so the fresh level
    // that carried the text was dropped and the re-mint carried nothing -
    // F2 then never reached the tours it was written for. The re-mint
    // writes the measurement's own text when the level has none.
    it("writes the printed text on a code measured before F2 when a re-measure re-mints it", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
        storedWithoutText: true,
      });
      expect(readPrintedText(stored.json)).toBeNull();
      a.endVisit();
      expect(codePosition(a)?.decision).toEqual({ kind: "replace" });
      expect(a.codes.inHand()?.json).not.toBe(stored.json);
      expect(readPrintedText(a.codes.inHand()!.json)).toBe(TEXT);
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

    /** The station frame the pin labelled `label` stands in. */
    function stationOf(a: ReturnType<typeof authoring>, label: string) {
      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === label,
        )!;
      return a.ctx.tourDocument
        .state()
        .stations.find((s) => s.id === pin.object.station)!;
    }

    // Why these tests matter (characterization before the codes move into
    // the store, plan 2026-10-20-1159 M3a/M3b): a settle that improves a
    // code saves the code in the code book (`saveLevel`,
    // creator-settle.ts:1028-1031) and moves the stations it takes along
    // through the document (`moveStationsAlong`, :1385-1398), whose undo
    // history the code book is not part of. An undo of that settle's last
    // step puts the station back - that half holds today and must keep
    // holding.
    it("an undo of the settle's station move puts the station back", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      const before = stationOf(a, "near").geo;
      a.endVisit();
      expect(codePosition(a)?.applied).toBe(true);
      expect(a.codes.savedText(stored.id), "the code improved").not.toBe(
        stored.json,
      );
      expect(stationOf(a, "near").geo, "the code took it along").not.toEqual(
        before,
      );
      expect(a.ctx.tourDocument.undo().kind).toBe("undone");
      expect(stationOf(a, "near").geo).toEqual(before);
    });

    // Why this test matters (plan M3b, Q-D): the settle moved
    // each station and object as a document action of its own - one undo
    // step and one draft write round each - so an undo took back the last
    // station only. One settle is one step and one write round (still
    // several writes, so not crash-atomic).
    it("takes one undo step and one draft write round for a settle that improves a code and moves its stations", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      // A pin of this visit too: the settle re-poses it besides the
      // station the improved code takes along.
      await a.placePin("this visit", [3, 0, -2]);
      const past = a.ctx.tourDocument.state().past.length;
      let follows = 0;
      // Counted with the draft listener's own predicate
      // (`creator-document.ts`): the draft follows an edit OR a change of
      // the codes, so a code saved apart from the settle's step is a
      // second write round as well.
      a.ctx.store.listenToDocument({
        predicate: isAnyOf(isDocumentEdit, isCodeChange),
        effect: () => {
          follows += 1;
        },
      });
      a.endVisit();
      expect(a.codes.savedText(stored.id), "the code improved").not.toBe(
        stored.json,
      );
      expect(a.ctx.tourDocument.state().past.length - past).toBe(1);
      expect(follows, "the draft follows the settle once").toBe(1);
    });

    // Was today's split, a known divergence until M3b: the same undo left
    // the improved code in place, so the station was back at the old
    // code's spot while the code book still held - and the next Finish
    // wrote - the new one. The code in hand's text wins in the book
    // (`withHand`), so nothing short of the undo itself can put the
    // earlier text back. M3b's one-step settle with its undo listener
    // turned this row green; the marker came off, the assertion stayed.
    it("an undo of the settle's station move takes the code's improvement back too", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      a.endVisit();
      expect(a.codes.savedText(stored.id)).not.toBe(stored.json);
      a.ctx.tourDocument.undo();
      a.setup.renderAuthorReadout();
      expect(a.codes.savedText(stored.id)).toBe(stored.json);
    });

    // Why this test matters (plan M3b): the hand held the improved text,
    // and the hand's text wins at every later change of the book - so an
    // undo that only put the book back would see the improvement return
    // at the next write. The undo makes the hand let go of the code it
    // took back, its measurement with it, and the earlier text stays at
    // the next render and in what the next Finish and the draft write.
    it("lets the hand go of the code an undo of the settle took back, and the earlier text stays", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      a.endVisit();
      expect(a.codes.inHand()?.id).toBe(stored.id);
      a.ctx.tourDocument.undo();
      expect(a.codes.inHand()).toBeNull();
      expect(a.codes.measurement()).toBeNull();
      a.setup.renderAuthorReadout();
      a.codes.finished([]);
      expect(a.codes.savedText(stored.id)).toBe(stored.json);
      for (const written of [a.codes.toWrite(), a.codes.notHosted()]) {
        expect(written.find((l) => l.id === stored.id)?.json).toBe(stored.json);
      }
    });

    // Why this test matters (plan M3b): a redo of the settle's step puts
    // the improved text back, but NOT the hand. Intended: the undo let the
    // hand go of the code (its measurement too), and the step keeps the
    // codes' texts only - the hand is the creator's live state, and a redo
    // never re-takes a code the creator no longer holds. Pinned so a
    // change that makes the redo re-take it is a decision, not an accident.
    it("restores the improved text at a redo of the settle, but not the hand", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      a.endVisit();
      const improved = a.codes.savedText(stored.id);
      expect(improved).not.toBe(stored.json);
      a.ctx.tourDocument.undo();
      expect(a.codes.inHand()).toBeNull();
      a.ctx.store.dispatch(tourDocumentActions.redone());
      expect(a.codes.savedText(stored.id), "the text is redone").toBe(improved);
      expect(a.codes.inHand(), "the hand stays empty").toBeNull();
      expect(a.codes.measurement()).toBeNull();
    });

    // Why this test matters (plan M3b): the undo takes the settle's text
    // back and lets the hand go, but the code keeps its BOOK measurement
    // (the step holds the texts only). So the code still counts as changed
    // live - a draft restore does not overwrite it - and the visit that
    // measured it still lists it for a settle redone after a failed
    // Finish. Pinned, so the sidecar's statement of it stays true.
    it("keeps the code's book measurement after an undo of the settle, and the visit still lists it", async () => {
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      a.endVisit();
      const visits = [0, 1, 2, 3, 4, 5].filter((v) =>
        a.codes.measuredIn(stored.id, v),
      );
      expect(visits, "measured in a visit of this page").not.toEqual([]);
      a.ctx.tourDocument.undo();
      expect(a.codes.inHand()).toBeNull();
      for (const v of visits) {
        expect(a.codes.measuredIn(stored.id, v)).toBe(true);
        expect(a.codes.visitCodes(v).map((c) => c.level.id)).toContain(
          stored.id,
        );
      }
      // Changed live: a restored draft's text for the code does not win.
      a.codes.restoreLevels([{ id: stored.id, json: '{"from":"a draft"}' }]);
      expect(a.codes.savedText(stored.id)).toBe(stored.json);
    });

    // Why these tests matter: the one-step undo
    // of a settle (Q-D) had no button. The settle lands at the visit's
    // end, so the strip offers it in the next visit, named by what it
    // takes back, and ONE tap takes back the code's improvement, the
    // station it took along and the pins it moved - and the hand lets go.
    it("offers a settle's code improvement in the strip's Undo at the next visit, and one tap takes back the code, its station and the pins it moved", async () => {
      const { a, stored, before, pins } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
      });
      const station = stationOf(a, "near").geo;
      const settledIn = a.ctx.arSessionGeneration;
      a.endVisit();
      expect(codePosition(a)?.decision).toEqual({ kind: "replace" });
      expect(a.codes.savedText(stored.id)).not.toBe(stored.json);
      expect(stationOf(a, "near").geo).not.toEqual(station);
      expect(pins()).not.toEqual(before);
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoLabel.textContent).toBe("Undo: the code's improvement");
      expect(a.dom.undoButton.disabled).toBe(false);
      const steps = a.ctx.tourDocument.state().past.length;

      a.dom.undoButton.click();
      await flush();
      expect(a.ctx.tourDocument.state().past.length, "one step").toBe(
        steps - 1,
      );
      expect(a.codes.savedText(stored.id)).toBe(stored.json);
      expect(stationOf(a, "near").geo).toEqual(station);
      expect(pins()).toEqual(before);
      expect(a.codes.inHand(), "the hand lets go").toBeNull();
      expect(a.dom.objectList.lastModel?.note).toBe(
        "Undone: the code's improvement - the code and everything that moved with it are back where they were.",
      );
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");
      const log = a.dispatched.filter(
        (x) => x.type === "tourAuthoring/settleUndone",
      );
      expect(log).toHaveLength(1);
      // A replay pairs the undo with the `settled` action it takes back:
      // the visit that settled, beside the visit the tap was made in.
      expect(settledIn).not.toBe(a.ctx.arSessionGeneration);
      expect(log[0]?.payload).toMatchObject({
        levelIds: [stored.id],
        settledVisitIndex: settledIn,
        arVisitIndex: a.ctx.arSessionGeneration,
      });
    });

    // Why: the settle keeps what it decided per code for the Finish's
    // result line, and an undo of the settle takes that with it - or after
    // the creator took the improvement back the result would still say
    // "the code's saved position was improved by this walk", a false
    // statement about the zip they are about to publish.
    it("says nothing of the improvement on the Finish's result once the strip's Undo took it back", async () => {
      /** The Finish's result line after the settle, the undo tapped or not. */
      const finishLine = async (tap: boolean) => {
        const { a } = await secondVisit({ yawDeg: 20, northM: 3, walkM: 30 });
        a.endVisit();
        a.beginVisit();
        a.setup.renderAuthorReadout();
        if (tap) a.dom.undoButton.click();
        await flush();
        a.endVisit();
        await openFinishableTour(a);
        a.ctx.tourManifestStatus = "settled";
        a.dom.finishButton.click();
        await finished(a.ctx);
        expect(a.ctx.finishError).toBeNull();
        return a.dom.finishStatus.textContent;
      };
      // The control: without the tap the line does report it.
      expect(await finishLine(false)).toMatch(/improved/);
      expect(await finishLine(true)).not.toMatch(/improved/);
    });

    it("withdraws the settle's Undo once the creator places something after it", async () => {
      const { a } = await secondVisit({ yawDeg: 20, northM: 3, walkM: 30 });
      a.endVisit();
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled).toBe(false);
      await a.placePin("after", [1, 0, 1]);
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");
    });

    // Why: a visit that only measured a new code re-mints it through the
    // end alignment - a refinement of its own measurement, no automatic
    // change of a stored code (Q-D's scope) - so nothing is offered.
    it("offers no Undo for a settle that only refined this visit's own measurement", async () => {
      const a = authoring();
      await a.mint();
      await a.placePin("near", [2, 0, -1]);
      const steps = a.ctx.tourDocument.state().past.length;
      a.endVisit();
      expect(
        a.ctx.tourDocument.state().past.length,
        "the settle took a step",
      ).toBe(steps + 1);
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");
    });

    // Why: the async-UI rule for the settle's tap, success and failure.
    it("shows Undoing… until a settle's undo is backed up, and says so when its draft writes are refused", async () => {
      const slow = slowDraftStore();
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
        store: slow.store,
      });
      a.endVisit();
      await slow.release();
      a.beginVisit();
      a.setup.renderAuthorReadout();
      slow.mode.refuse = true;
      a.dom.undoButton.click();
      await flush();
      expect(a.dom.undoLabel.textContent).toBe("Undoing…");
      await slow.release();
      expect(a.dom.undoLabel.textContent).toBe("Undo");
      expect(a.codes.savedText(stored.id)).toBe(stored.json);
      expect(a.dom.objectList.lastModel?.note).toMatch(
        /^Undone: the code's improvement, but this device could not save a backup copy/,
      );
    });

    // Why this test matters (plan M3b): what the undo puts back must reach
    // the draft too, or a reload after the undo restores the improved code
    // the creator took back. The codes record follows the undo and the
    // hand letting go: it keeps the earlier text, and names no hand.
    it("writes the earlier text into the draft's codes at an undo of the settle", async () => {
      const { store, files } = memoryDraftStore();
      const { a, stored } = await secondVisit({
        yawDeg: 20,
        northM: 3,
        walkM: 30,
        store,
      });
      a.endVisit();
      await flush();
      const codes = () =>
        JSON.parse(String(files.get(CODES_KEY))) as {
          level: { id: string; json: string } | null;
          levels: { id: string; json: string }[];
        };
      const improved = codes().levels.find((l) => l.id === stored.id)?.json;
      expect(improved, "the settle wrote the improved code").not.toBe(
        stored.json,
      );
      a.ctx.tourDocument.undo();
      await flush();
      expect(codes().level).toBeNull();
      expect(codes().levels.find((l) => l.id === stored.id)?.json).toBe(
        stored.json,
      );
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
      const hosted = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "near",
        )!.object;
      hostInstead(a, tourOf([hosted]));
      a.endVisit();
      const edit = a.ctx.tourDocument
        .entries()
        .find((p) => p.object.id === hosted.id);
      expect(edit, "an edit by id in the page's work").toBeDefined();
      expect(edit!.object.geo).not.toEqual(before.get("near"));
      expect(edit!.placement).toBeUndefined();
    });

    // Why (tour editor plan 2026-10-17-1816, D17, the owner's condition):
    // in version 3 an improved code moves the whole STATION a hosted pin
    // sits in, atomically. The pin's local pose is never rewritten - not by
    // the settle, and not by the Finish that writes the move.
    it("moves the station of a hosted pin with an improved code, and the Finish keeps the pin's local pose", async () => {
      const { a } = await secondVisit({ yawDeg: 20, northM: 3, walkM: 30 });
      const hosted = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "near",
        )!.object;
      const opened = tourOf([hosted]);
      hostInstead(a, opened);
      const [station] = opened.stations;
      a.endVisit();
      expect(codePosition(a)?.applied).toBe(true);
      const moved = a.ctx.tourDocument.manifest()!;
      const [after] = moved.stations;
      expect(after!.geo).not.toEqual(station!.geo);
      // The blocks as they were: the same local poses, re-expressed in no
      // frame (the station moved, they ride along).
      expect(after!.blocks).toEqual(station!.blocks);
      // The page's edit is the pin where its moved station puts it.
      const edit = a.ctx.tourDocument
        .entries()
        .find((p) => p.object.id === hosted.id);
      expect(edit!.object.geo).toEqual(tourObjects(moved)[0]!.geo);
      expect(codePosition(a)?.movedWithCode.map((m) => m.id)).toEqual([
        hosted.id,
      ]);

      // The page's tour stays the moved one (the archive only gains a
      // file to rebuild from).
      await openFinishableTour(a);
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      const written = parseTourManifest(
        JSON.parse(serializeTourManifest(a.ctx.tourDocument.manifest()!)),
      );
      const home = written.stations.find((s) => s.id === station!.id)!;
      expect(home.blocks.map((i) => i.pose)).toEqual(
        station!.blocks.map((i) => i.pose),
      );
      expect(home.geo).toEqual(after!.geo);
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

    // M6 E2p review #1, #2, #4: the walks the pure rules could not see.
    // Each loses the phone's own work if the base is taken from the wrong
    // version: "replaced by a newer one" would be false, and the record
    // would not be offered back.
    describe("the draft's base comes from the tour as opened (M6 E2p review)", () => {
      /** A pin the hosted zip carries. */
      function hosted(id: string, label: string): TourObject {
        return mintPin({
          id,
          label,
          worldNuePosition: { x: 4, y: 400, z: 2 },
          zero: ZERO,
          nowIso: "2026-09-29T10:00:00.000Z",
        })!;
      }

      /** One page load: the tour as hosted now, the draft presented;
       *  `undefined` is a phone without a draft store. */
      async function load(
        store: DraftFileStore | undefined,
        objects: TourObject[],
      ): Promise<ReturnType<typeof authoring>> {
        const a = authoring(store === undefined ? {} : { store });
        await openFinishableTour(a);
        a.ctx.tourDocument.open(tourOf(objects));
        a.setup.presentDraftForTour(TOUR);
        await flush();
        return a;
      }

      it("offers a placement moved after a download-only Finish (review #2)", async () => {
        const { store } = memoryDraftStore();
        const a = await load(store, []);
        a.setWalk(walk());
        await a.mint();
        await a.placePin("Gate", [2, 0, -1]);
        a.endVisit();
        await flush();
        a.device.live = false;
        a.dom.finishButton.click();
        await finished(a.ctx);
        // The page's manifest now holds the pin; the hosted zip does not.
        const id = tourObjects(a.ctx.tourDocument.manifest()!)[0]!.id;
        a.dom.objectList.listHandlers!.editText(id, "Gate, edited");
        await flush();
        // The zip was never uploaded: the reload sees the tour without it.
        const b = await load(store, []);
        await vi.waitFor(() => {
          expect(b.dom.draftOfferText.textContent).not.toBe("");
        });
        expect(b.dom.draftOfferText.textContent).toMatch(/1 thing you placed/);
        expect(b.ctx.placementNote ?? "").not.toMatch(/replaced/);
      });

      it("offers a later edit of an object the phone itself published (review #1)", async () => {
        const { store } = memoryDraftStore();
        const a0 = hosted("h1", "Gate");
        const a = await load(store, [a0]);
        a.setWalk(walk());
        await a.mint();
        a.endVisit();
        await flush();
        a.dom.objectList.listHandlers!.editText("h1", "Gate, phone 1");
        await flush();
        // The creator uploaded that edit: the next load opens it hosted.
        const a1 = { ...a0, caption: "Gate, phone 1" } as TourObject;
        const b = await load(store, [a1]);
        b.dom.objectList.listHandlers!.editText("h1", "Gate, phone 2");
        await flush();
        // The tab dies before a Finish: the reload, still hosted at A1.
        const c = await load(store, [a1]);
        await vi.waitFor(() => {
          expect(c.dom.draftOfferText.textContent).not.toBe("");
        });
        expect(c.dom.draftOfferText.textContent).toMatch(/1 change/);
        expect(c.ctx.placementNote ?? "").not.toMatch(/replaced/);
      });

      // Why (re-review #1): the creator uploads this page's own Finish
      // from the same tab and edits again. The version they uploaded is
      // this device's work, so the later edit must be offered - a base
      // decided once per page load called it "replaced" and deleted it.
      it("offers an edit made after the creator uploaded this page's own Finish (re-review #1)", async () => {
        const { store } = memoryDraftStore();
        const a = await load(store, [hosted("h1", "Gate")]);
        a.setWalk(walk());
        await a.mint();
        a.endVisit();
        await flush();
        a.dom.objectList.listHandlers!.editText("h1", "Gate, phone 1");
        await flush();
        a.device.live = false;
        a.dom.finishButton.click();
        await finished(a.ctx);
        // As the next open reads it: parsed from the written file (third
        // review #5), not the page's in-memory object.
        const uploaded = tourObjects(
          parseTourManifest(
            JSON.parse(serializeTourManifest(a.ctx.tourDocument.manifest()!)),
          ),
        ).find((o) => o.id === "h1")!;
        // Uploaded from this tab; the page stays open and edits again.
        a.dom.objectList.listHandlers!.editText("h1", "Gate, phone 2");
        await flush();
        const c = await load(store, [uploaded]);
        await vi.waitFor(() => {
          expect(c.dom.draftOfferText.textContent).not.toBe("");
        });
        expect(c.dom.draftOfferText.textContent).toMatch(/1 change/);
        expect(c.ctx.placementNote ?? "").not.toMatch(/replaced/);
      });

      // Why (re-review #2): an edit made while the draft is still opening
      // is written when it opens; its base must still name the version the
      // creator edited (the desktop's), or the next load drops it.
      it("keeps an edit made while the draft opens, over a desktop edit (re-review #2)", async () => {
        const { store } = memoryDraftStore();
        const a0 = hosted("h1", "Gate");
        const a = await load(store, [a0]);
        a.setWalk(walk());
        await a.mint();
        a.endVisit();
        await flush();
        a.dom.objectList.listHandlers!.editText("h1", "Gate, phone");
        await flush();
        const desk = { ...a0, caption: "Gate, desk" } as TourObject;
        let open!: () => void;
        const b = authoring({
          store,
          storeOpens: new Promise<void>((r) => {
            open = r;
          }),
        });
        await openFinishableTour(b);
        b.ctx.tourDocument.open(tourOf([desk]));
        b.setup.presentDraftForTour(TOUR);
        b.dom.objectList.listHandlers!.editText("h1", "Gate, phone again");
        await flush();
        open();
        await flush();
        const c = await load(store, [desk]);
        await vi.waitFor(() => {
          expect(c.dom.draftOfferText.textContent).not.toBe("");
        });
        expect(c.dom.draftOfferText.textContent).toMatch(/1 change/);
      });

      // Why (F19, owner decision 2026-10-14): place a pin, Finish with a
      // download, upload that file, delete the pin on the desktop - the
      // phone's draft never learned of the upload, so the next open offered
      // the deleted pin back. Nothing tells a page an upload happened, so it
      // asks once; a yes makes the written versions SEEN hosted.
      describe("a download-only Finish, then a delete elsewhere (F19)", () => {
        async function placeAndFinish(
          store: DraftFileStore | undefined,
        ): Promise<ReturnType<typeof authoring>> {
          const a = await load(store, []);
          expect(a.dom.uploadAsk.hidden).toBe(true);
          a.setWalk(walk());
          await a.mint();
          await a.placePin("Gate", [2, 0, -1]);
          a.endVisit();
          await flush();
          a.device.live = false;
          a.dom.finishButton.click();
          await finished(a.ctx);
          // Asked once the Finish's own save delivered the file.
          await vi.waitFor(() => {
            expect(a.dom.uploadAsk.hidden).toBe(false);
          });
          return a;
        }

        it("after a yes, a pin deleted on the desktop stays deleted", async () => {
          const { store } = memoryDraftStore();
          const a = await placeAndFinish(store);
          a.dom.uploadYes.click();
          await vi.waitFor(() => {
            expect(a.dom.uploadYes.hidden).toBe(true);
          });
          await flush();
          // The desktop's file, uploaded: the tour without the pin.
          const b = await load(store, []);
          await vi.waitFor(() => {
            expect(b.ctx.placementNote ?? "").toMatch(
              /replaced by a newer one/,
            );
          });
          expect(b.dom.draftOfferText.textContent).not.toMatch(/you placed/);
        });

        // Why (PR #626 bot finding 3): a phone without a draft store has
        // nothing to note, so a yes cannot fail there - yet it said "This
        // phone could not note it", a warning that cannot come true, and
        // every later Save again asked again and failed again.
        it("on a phone without a draft store, a yes is noted: nothing to note, nothing failed", async () => {
          const a = await placeAndFinish(undefined);
          a.dom.uploadYes.click();
          await vi.waitFor(() => {
            expect(a.dom.uploadYes.hidden).toBe(true);
          });
          await flush();
          expect(a.dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.noted);
        });

        it("with no yes, the pin is offered back as before", async () => {
          const { store } = memoryDraftStore();
          const a = await placeAndFinish(store);
          a.dom.uploadNo.click();
          expect(a.dom.uploadAsk.hidden).toBe(true);
          await flush();
          const b = await load(store, []);
          await vi.waitFor(() => {
            expect(b.dom.draftOfferText.textContent).toMatch(
              /1 thing you placed/,
            );
          });
          expect(b.ctx.placementNote ?? "").not.toMatch(/replaced/);
        });

        // Why (F19 milestone review #2): the question about Finish A's file
        // stayed on screen through a second Finish whose save did not go
        // through, and a yes then noted that LATER, never-delivered file's
        // versions as hosted - so a pin placed after Finish A read as
        // "deleted elsewhere" at the next open of A's file, and was lost.
        it("a question left from an earlier Finish never notes a later Finish that was not saved", async () => {
          const { store } = memoryDraftStore();
          const a = await placeAndFinish(store);
          const first = a.ctx.rebuiltZip;
          const hostedA = [...tourObjects(a.ctx.tourDocument.manifest()!)];
          a.beginVisit();
          a.seeTheCode();
          await flush();
          await a.placePin("Bench", [3, 0, 1]);
          a.endVisit();
          await flush();
          a.device.live = false;
          a.seams.downloadZip = () => Promise.resolve(false);
          a.dom.finishButton.click();
          await vi.waitFor(() => {
            expect(a.ctx.rebuiltZip).not.toBe(first);
          });
          await flush();
          a.dom.uploadYes.click();
          await flush();
          // A's file is the one hosted: the bench is offered back.
          const b = await load(store, hostedA);
          await vi.waitFor(() => {
            expect(b.dom.draftOfferText.textContent).toMatch(
              /1 thing you placed/,
            );
          });
          expect(b.ctx.placementNote ?? "").not.toMatch(/replaced/);
        });
      });

      it("says a desktop edit won once, and forgets the replaced record (review #4)", async () => {
        const { store, files } = memoryDraftStore();
        const a0 = hosted("h1", "Gate");
        const a = await load(store, [a0]);
        a.setWalk(walk());
        await a.mint();
        a.endVisit();
        await flush();
        a.dom.objectList.listHandlers!.editText("h1", "Gate, phone");
        await flush();
        // The desktop editor renamed it in the hosted file meanwhile.
        const desk = { ...a0, caption: "Gate, desk" } as TourObject;
        const b = await load(store, [desk]);
        await vi.waitFor(() => {
          expect(b.ctx.placementNote ?? "").toMatch(/replaced by a newer one/);
        });
        await flush();
        expect(files.has("object:h1")).toBe(false);
        expect(files.has("base:h1")).toBe(false);
        const c = await load(store, [desk]);
        await flush();
        expect(c.ctx.placementNote ?? "").not.toMatch(/replaced/);
      });
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
      const pin = a.ctx.tourDocument.entries()[0]!.object;
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
      expect(a.ctx.tourDocument.entries()).toEqual([]);
      a.device.live = true;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.tourDocument.entries()).toHaveLength(1);
    });

    it("refuses a pin before this session's fixes reach the alignment floor", async () => {
      const a = authoring();
      a.codes.setInHand({ id: "lvl", json: "{}" }, null);
      // One fix of the store's was there before this session started.
      a.ctx.gpsSamplesAtSessionStart = 1;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.tourDocument.entries()).toEqual([]);
      a.ctx.gpsSamplesAtSessionStart = 0;
      await a.placePin("Gate", [2, 0, -1]);
      expect(a.ctx.tourDocument.entries()).toHaveLength(1);
    });

    // Why these tests matter (field test 2, F5; owner, 2026-10-09):
    // placing an object in the AR world is GPS and tracking only - a tour
    // builder without codes must place exactly as this one does. The gate
    // used to need a measured code too, so "Use 15.3 cm" emptied the hand
    // 20 m into the walk and greyed the place buttons for the rest of the
    // loop outside, with nothing on screen saying why.
    it("places a pin and a photo with no code measured or stored", async () => {
      const a = authoring();
      expect(a.codes.inHand()).toBeNull();
      a.setup.renderAuthorReadout();
      expect(a.dom.pinButton.disabled).toBe(false);
      await a.placePin("Gate", [2, 0, -1]);
      a.tapPhoto({ position: [0, 1.4, 0], rotation: [0, 0, 0, 1] });
      await flush();
      expect(a.ctx.tourDocument.entries().map((p) => p.object.kind)).toEqual([
        "shortText",
        "picture",
      ]);
      // The settle has no code to correct them through: the visit's own
      // GPS alignment places them.
      a.endVisit();
      expect(a.settledLogs().at(-1)?.payload.basis).toBe("visit-alignment");
    });

    it("places a pin after the code in hand's print size is adopted", async () => {
      const a = authoring();
      await a.mint();
      a.ctx.printSizeCheck = {
        ...a.ctx.printSizeCheck!,
        offer: () => ({ text: TEXT, sizeM: 0.153 }),
        answer: () => undefined,
      };
      a.dom.sizeOfferUse.click();
      expect(a.codes.inHand()).toBeNull();
      await a.placePin("Outside", [30, 0, -5]);
      expect(a.ctx.tourDocument.entries().map((p) => p.object.kind)).toEqual([
        "shortText",
      ]);
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
      const codes = JSON.parse(String(files.get(CODES_KEY))) as {
        levels: { id: string }[];
      };
      expect(codes.levels.map((l) => l.id)).toEqual([first.id, second.id]);
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
      const codes = JSON.parse(String(files.get(CODES_KEY))) as {
        levels: { id: string; json: string }[];
      };
      const settledA = codes.levels.find((l) => l.id === first.id)!;
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

      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "Beside A",
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
      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "at the copy",
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
      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "home pin",
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
      const pinBefore = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "by the copy",
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
      const pinAfter = a.ctx.tourDocument
        .entries()
        .find(
          (p) =>
            p.object.kind === "shortText" && p.object.caption === "by the copy",
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
      const pin = a.ctx.tourDocument
        .entries()
        .find(
          (p) => p.object.kind === "shortText" && p.object.caption === "by B",
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

    // Why (the strip's Undo): the confirmation writes the code book with
    // no step of its own, so the document's last step is still the move.
    // Its undo would take back the move's stations and objects but not the
    // code, which no longer holds the text the move set - and say the code
    // is back. The offer goes instead.
    it("withdraws the strip's Undo of a move once a later visit's confirmation rewrote the code", async () => {
      const { a, original } = await storedCode();
      await visitSeeing(a, 30);
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoLabel.textContent).toBe("Undo: the code's move");
      a.endVisit();
      const sameDayMs = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(sameDayMs + 25 * 3_600_000);
        await visitSeeing(a, 30);
      } finally {
        vi.useRealTimers();
      }
      expect(spotsOf(a).copies, "confirmed").toEqual([original]);
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled).toBe(true);
      expect(a.dom.undoLabel.textContent).toBe("Undo");
    });

    // Why: a Finish that already wrote the change into the zip keeps it
    // there - the undo changes the tour on this device, until the next
    // Finish saves it. The note says so, or the creator would think the
    // saved zip is already back.
    it("says the undo is saved at the next Finish when a Finish already wrote the change", async () => {
      const a = authoring();
      await openFinishableTour(a);
      await a.mint();
      a.endVisit();
      await visitSeeing(a, 30);
      a.ctx.tourManifestStatus = "settled";
      a.dom.finishButton.click();
      await finished(a.ctx);
      expect(a.ctx.finishError).toBeNull();
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoLabel.textContent).toBe("Undo: the code's move");
      a.dom.undoButton.click();
      await flush();
      expect(a.dom.objectList.lastModel?.note).toBe(
        "Undone: the code's move - the code and everything that moved with it are back where they were. The next Finish saves this in the zip.",
      );
    });

    // Why: defensive wording - an undo of a settle that took back none of
    // the codes it named (one changed between the chip's check and the
    // document's undo) must not say the code is back.
    it("says the code keeps its newer position when an undo of a settle took back none of its codes", async () => {
      const { a } = await storedCode();
      await visitSeeing(a, 30);
      const level = a.codes.inHand()!;
      a.codes.saveLevel({ id: level.id, json: `${level.json} ` });
      const said: string[] = [];
      await undoSettle({
        tour: a.ctx.tourDocument,
        target: "the code's move",
        visit: a.ctx.arSessionGeneration,
        settledVisit: a.ctx.arSessionGeneration,
        written: () => false,
        log: () => undefined,
        changed: () => undefined,
        say: (text) => said.push(text),
      });
      expect(said).toEqual([
        "Undone: the code's move - the stations and objects it moved are back, but the code changed since and keeps its newer position.",
      ]);
    });

    // Why: a failed Finish forgets its visit's settle, which settles again
    // at the visit's end and re-applies the decisions it made. The first
    // settle's offer must go with the unsettle (its records are re-applied,
    // not taken back), and the re-settle is no new automatic change to
    // offer - an Undo of it would drop the first settle's line while the
    // change stays in the document.
    it("withdraws a settle's Undo when a failed Finish unsettles it, and offers none for the re-settle", async () => {
      const { store } = memoryDraftStore();
      const a = authoring({ store });
      await openFinishableTour(a);
      a.setup.presentDraftForTour("https://example.test/tour.zip");
      await flush();
      await a.mint();
      a.endVisit();
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
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled, "withdrawn with the unsettle").toBe(
        true,
      );
      a.endVisit();
      await flush();
      a.beginVisit();
      a.setup.renderAuthorReadout();
      expect(a.dom.undoButton.disabled, "no offer for the re-settle").toBe(
        true,
      );
      expect(a.dom.undoLabel.textContent).toBe("Undo");
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
      const pinBefore = a.ctx.tourDocument
        .entries()
        .find((p) => p.object.kind === "shortText")!.object.geo;
      await visitSeeing(a, 30);
      const pinAfter = a.ctx.tourDocument
        .entries()
        .find((p) => p.object.kind === "shortText")!.object.geo;
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

describe(
  "the photo button while a photo is captured",
  { timeout: SLOW_MS },
  () => {
    // Why: the shutter disables the button for the encode, but the
    // "Capturing..." note re-renders the buttons, which enabled it again at
    // once - so a second tap could put a second photo in flight. The button
    // must stay disabled for the whole encode, through any render, and come
    // back after it, whether the encode landed or failed.
    const CAMERA: Pose = { position: [0.5, 1.4, -0.2], rotation: yawQ(90) };

    for (const outcome of ["lands", "fails"] as const) {
      it(`stays disabled for the whole encode, and is enabled again when it ${outcome}`, async () => {
        const a = authoring();
        await a.mint();
        a.encodes.hold = true;
        a.encodes.fail = outcome === "fails";
        a.tapPhoto(CAMERA);
        expect(a.dom.photoButton.disabled).toBe(true);
        // Any render meanwhile (a fix, a frame, a note) keeps it disabled.
        a.setup.renderAuthorReadout();
        expect(a.dom.photoButton.disabled).toBe(true);
        for (const land of a.encodes.waiting.splice(0)) land();
        await flush();
        expect(a.dom.photoButton.disabled).toBe(false);
        expect(a.ctx.placementNote).toMatch(
          outcome === "lands" ? /^Photo placed/ : /^Capturing failed/,
        );
      });
    }
  },
);

describe(
  "'New station here' and a photo: the arm is taken at the shutter tap (D8)",
  { timeout: SLOW_MS },
  () => {
    // Why: a photo is committed at its shutter tap, but it reaches the
    // document only when its encode lands. Read then, the arm missed a
    // photo whose visit ended meanwhile (the visit's end disarms) and went
    // to a photo shot BEFORE the creator armed. The photo takes the arm at
    // the tap, and gives it back when it is not placed, while its visit
    // still runs.
    const CAMERA: Pose = { position: [0.5, 1.4, -0.2], rotation: yawQ(90) };

    function lastPhoto(a: ReturnType<typeof authoring>) {
      const photo = a.ctx.tourDocument.entries().at(-1)!.object;
      expect(photo.kind).toBe("picture");
      return photo;
    }

    /** A pin a metre from the camera, placed before anything is armed:
     *  the station the rule alone would seat the photo in. */
    async function stationNearby(a: ReturnType<typeof authoring>) {
      await a.placePin("Nearby", [1, 0, 0]);
      const station = a.ctx.tourDocument.entries().at(-1)!.object.station;
      expect(station).toBeDefined();
      return station;
    }

    it("an armed photo starts its own station; the arm goes at the tap, not at the encode's end", async () => {
      const a = authoring();
      await a.mint();
      const nearby = await stationNearby(a);
      a.dom.newStationButton.click();
      expect(a.ctx.tourDocument.newStationArmed()).toBe(true);
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(false);
      expect(a.dom.newStationButton.attributes["aria-pressed"]).toBe("false");
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();
      expect(lastPhoto(a).station).toBeDefined();
      expect(lastPhoto(a).station).not.toBe(nearby);
      expect(a.ctx.placementNote).toMatch(/^Photo placed/);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(false);
    });

    it("armed at the tap, the photo starts its station even when the AR visit ends during its encode", async () => {
      const a = authoring();
      await a.mint();
      const nearby = await stationNearby(a);
      a.dom.newStationButton.click();
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.endVisit();
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();
      expect(lastPhoto(a).station).toBeDefined();
      expect(lastPhoto(a).station).not.toBe(nearby);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(false);
    });

    it("armed during 'Capturing...', the arm goes to the NEXT item, not to the photo being encoded", async () => {
      const a = authoring();
      await a.mint();
      a.encodes.hold = true;
      a.tapPhoto(CAMERA);
      a.dom.newStationButton.click();
      expect(a.ctx.tourDocument.newStationArmed()).toBe(true);
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();
      // The photo is seated by the station rule (every object names a
      // station), and the arm still waits.
      const photoStation = lastPhoto(a).station;
      expect(photoStation).toBeDefined();
      expect(a.ctx.tourDocument.newStationArmed()).toBe(true);
      // A few metres from the photo, where the rule alone would put the pin
      // into the photo's station: the arm makes it start its own.
      await a.placePin("Next", [3, 0, 1]);
      const next = a.ctx.tourDocument.entries().at(-1)!.object;
      expect(next.kind).toBe("shortText");
      expect(next.station).toBeDefined();
      expect(next.station).not.toBe(photoStation);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(false);
    });

    it("a photo that is not placed gives the arm back while its visit runs", async () => {
      const a = authoring();
      await a.mint();
      a.dom.newStationButton.click();
      a.encodes.fail = true;
      a.tapPhoto(CAMERA);
      await flush();
      expect(a.ctx.placementNote).toMatch(/^Capturing failed/);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(true);
      expect(a.dom.newStationButton.attributes["aria-pressed"]).toBe("true");
    });

    it("but not into a visit that ended: the visit's end disarmed it for good", async () => {
      const a = authoring();
      await a.mint();
      a.dom.newStationButton.click();
      a.encodes.hold = true;
      a.encodes.fail = true;
      a.tapPhoto(CAMERA);
      a.endVisit();
      for (const land of a.encodes.waiting.splice(0)) land();
      await flush();
      expect(a.ctx.placementNote).toMatch(/^Capturing failed/);
      expect(a.ctx.tourDocument.newStationArmed()).toBe(false);
    });
  },
);
