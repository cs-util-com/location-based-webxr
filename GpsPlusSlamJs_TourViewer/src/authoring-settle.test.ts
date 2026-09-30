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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  endQrPipeline,
} from "./tour-viewer-session.js";
import { objectPoseNue } from "./content-placement.js";
import { META_KEY, objectKey } from "./draft-persistence.js";
import { odomNueFromWebXr } from "./visit-anchoring.js";

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

/** The i-th detection of the code, from a camera stepping sideways
 *  (the fused-pose wiring test's walk: stable after about seven). */
function detection(i: number): QrDetectionEvent {
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
    cameraPose: { position: [dx, 0, 1.2], rotation: [0, 0, 0, 1] },
    intrinsics: K,
    imageWidth: 1024,
    imageHeight: 768,
    qrPoseWorld: raw,
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
] as const;

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    open: false,
    focus: () => undefined,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
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
  captured.configs.length = 0;
  const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
    (typeof DOM_KEYS)[number],
    ReturnType<typeof el>
  >;
  dom.sizeInput.value = String(SIZE_M);
  const ctx = createTourViewerSession();
  const real = createTourViewerStore();
  const gps = { alignment: yawAlignment(0, [0, 400, 0]) };
  const dispatched: { type: string; payload?: unknown }[] = [];
  const arStore = {
    ...real,
    getState: () =>
      ({
        ...real.getState(),
        gpsData: {
          zero: ZERO,
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
  const seams = {
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
    encodeFrameJpeg: () =>
      Promise.resolve({ blob: new Blob([]), width: 4, height: 3 }),
  } as unknown as TourViewerSeams;
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore,
    arController: {
      getState: () => ({ status: "running" }),
      disable: () => Promise.resolve(),
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
  function seeTheCode(): void {
    for (let i = 0; i < 8; i += 1) {
      captured.configs.at(-1)?.onDetection?.(detection(i));
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
    ctx.arSessionGeneration += 1;
    endQrPipeline(ctx);
    ctx.lastDetectedText = null;
    for (const preview of ctx.placedPreviews) preview.dispose();
    ctx.placedPreviews = [];
  }

  /** A new AR session: a fresh pipeline, then the visit's start. */
  function beginVisit(): void {
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

  return {
    ctx,
    dom,
    setup,
    dispatched,
    world,
    setAlignment,
    placePin,
    inWorldGroup,
    seeTheCode,
    mint,
    endVisit,
    beginVisit,
    settledLogs,
    labels,
    scene,
  };
}

describe("symptom A: a note placed in AR stays put while GPS re-solves", () => {
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
    const cameraPose: Pose = { position: [0.5, 1.4, -0.2], rotation: yawQ(90) };
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
});

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

describe("symptom B within a visit: the code and its notes settle together (B2)", () => {
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
    expect(pin.geo, "the settle should have moved the pin").not.toEqual(tapGeo);
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
});

describe("symptom B across visits: a later visit is corrected through the code (D10b)", () => {
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
    const offset = worldOf(later.geo).sub(codeWorldOf(a.ctx.mintedLevel!.json));
    // Relative to the code exactly as placed, turned by the FIRST visit's
    // alignment (the frame the code's geo was stored in) - not the 20 m
    // the second visit's GPS put between them.
    const expected = new Vector3(3, 0, 1).sub(codeLocal);
    expect(offset.distanceTo(expected)).toBeLessThan(1e-2);
    const logs = a.settledLogs();
    expect(logs.at(-1)?.payload.basis).toBe("code-corrected");
    // The stored code is the reference; the second visit does not move it.
    expect(logs.at(-1)?.payload.level).toBeNull();
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
    expect(shown, "the earlier note should be shown on re-entry").toBeDefined();
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
});
