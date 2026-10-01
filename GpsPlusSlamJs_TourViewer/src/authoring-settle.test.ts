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
import { deletedKey, META_KEY, objectKey } from "./draft-persistence.js";
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
] as const;

function el() {
  const handlers = new Map<string, (event?: unknown) => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    focus: () => undefined,
    addEventListener: (type: string, handler: (event?: unknown) => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    /** Fire any other listener with an event (the overlay's
     *  `beforexrselect`). */
    fire: (type: string, event: unknown) => handlers.get(type)?.(event),
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

function authoring(options: { store?: DraftFileStore } = {}) {
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
  } = { alignment: yawAlignment(0, [0, 400, 0]), zero: ZERO };
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
            gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
              lat: ZERO.lat,
              lon: ZERO.lon,
            })),
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
    fn: (targets: ReadonlyMap<string, Object3D>) => string | null;
  } = { fn: () => null };
  const seams = {
    pickObjectInView: (targets: ReadonlyMap<string, Object3D>) =>
      pick.fn(targets),
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
    /** Put the reticle at `local` (odometry-NUE). */
    setReticle: (local: [number, number, number]): void => {
      reticleLocal.set(...local);
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

      expect(a.settledLogs().at(-1)?.payload.basis).toBe("code-corrected");
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
      a.setup.selectInView();
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
      const a = authoring();
      a.setAlignment(yawAlignment(0, [0, 400, 0]));
      await a.mint();
      await a.placePin("Gate", [2, 0, -1]);
      a.endVisit();
      const codeLocal = mintedOdom(a.dispatched);
      const gate = a.ctx.placedObjects[0]!.object;
      a.beginVisit();
      a.setAlignment(yawAlignment(30, [20, 401, -8]));
      a.seeTheCode();
      await flush();
      a.setReticle([4, 0, 2]);
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
      [4, 0, 2].forEach((v, i) => {
        expect(reticle[i]).toBeCloseTo(v, 9);
      });
      expect(log["sighting"]).not.toBeNull();
      // Rigid in AR now, like a new placement - and the visit's own settle
      // keeps it where the move put it.
      expect(
        a.inWorldGroup("Gate").distanceTo(new Vector3(4, 0, 2)),
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
      a.pick.fn = (targets) => {
        seen = targets;
        return targets.has("h1") ? "h1" : null;
      };
      a.setup.selectInView();
      // The ray is cast against each object's rendered root.
      expect(seen!.get("h1")).toBe(a.ctx.placedPreviews.get("h1")!.root);
      const model = a.dom.objectList.lastModel!;
      expect(model.rows.map((r) => [r.id, r.selected, r.canMove])).toEqual([
        ["h1", true, true],
      ]);
      a.pick.fn = () => null;
      a.setup.selectInView();
      expect(a.dom.objectList.lastModel!.rows).toEqual([]);
    });

    it("cancels the XR select of a tap on the panel, so Delete does not also select what is behind it", () => {
      const a = authoring();
      let prevented = false;
      a.dom.panel.fire("beforexrselect", {
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented).toBe(true);
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
