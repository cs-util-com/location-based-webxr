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
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
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
function authoring() {
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
    openDraftStore: () => Promise.resolve(undefined),
  });
  expect(setup.startAuthorPipeline()).toBe(true);

  /** Place a pin at `local` (odometry-NUE) with this label. */
  async function placePin(label: string, local: [number, number, number]) {
    reticleLocal.set(...local);
    dom.pinLabel.value = label;
    dom.pinSave.click();
    await flush();
  }

  /** Where a label sits in the AR world group's frame right now. */
  function inWorldGroup(label: string): Vector3 {
    const object = labels.find((o) => o.name === label);
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
    detect: (i: number) => captured.configs.at(-1)?.onDetection?.(detection(i)),
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
