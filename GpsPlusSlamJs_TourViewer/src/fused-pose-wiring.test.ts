/**
 * The TourViewer on the fused QR pose (QR near-frontal pose plan §60-§61,
 * b4b-3): the viewer votes with it and the creator measures and mints with
 * it, instead of today's average of single-frame poses.
 *
 * Why these tests matter: the switch is invisible in the e2e suite (its
 * fixture scripts a pose unrelated to the corners). Here the corners come
 * from ONE true code pose while the single-frame poses scatter by +-6 deg
 * around it - all within the old average's 12 deg inlier cone, but beyond
 * its 5 deg spread gate - so the old pipeline never goes stable and the
 * fused one does, at the true rotation. A pipeline still on
 * the average fails every test below.
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
import { qrFrameChanged } from "gps-plus-slam-app-framework/state";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";

// The pipelines build their controller from this module; capture the config
// they hand it and give back a controller that does nothing.
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

const FUSED_SIZE_M = 0.16;
const K = { fx: 820, fy: 820, cx: 512, cy: 384 };
const yaw = (deg: number): Pose["rotation"] => [
  0,
  Math.sin((deg * Math.PI) / 360),
  0,
  Math.cos((deg * Math.PI) / 360),
];
/** The code's true pose: at the origin facing +z, turned 6 deg about y. */
const TRUE_CODE: Pose = { position: [0, 0, 0], rotation: yaw(6) };

/** The i-th detection of `text`, from a camera at (-0.3 + 0.1 i, 0, 1.2). */
function fusedEvent(text: string, i: number): QrDetectionEvent {
  const dx = -0.3 + 0.1 * i;
  const corners = buildObjectPoints(FUSED_SIZE_M).map((p) => {
    const w = rotateVectorByQuaternion(TRUE_CODE.rotation, p);
    return projectViewPoint([w[0] - dx, w[1], w[2] - 1.2], K)!;
  });
  const raw: Pose = {
    position: [0, 0, 0],
    rotation: yaw(6 + ((i % 3) - 1) * 6),
  };
  return {
    text,
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

/** Angle between two unit quaternions, degrees. */
function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!,
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

const TEXT = "https://gps.csutil.com/tour/?qr=x";
const seams = {
  schedule: () => () => undefined,
  createQrFrontEnd: () => ({
    kind: "barcode-detector",
    detect: () => Promise.resolve(null),
  }),
  solveQrPose: () => null,
  getIntrinsics: () => null,
  getScene: () => null,
  canShareZip: () => false,
} as unknown as TourViewerSeams;

describe("the viewer votes with the fused pose", () => {
  function viewer() {
    captured.configs.length = 0;
    const ctx = createTourViewerSession();
    const arStore = createTourViewerStore();
    const hooks = createUnwiredHooks();
    hooks.renderArStatus = vi.fn();
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
    });
    ctx.levelByText.set(TEXT, {
      version: 1,
      qr: { physicalSizeM: FUSED_SIZE_M },
    });
    placement.startViewerPipeline();
    const config = captured.configs.at(-1)!;
    const detect = (i: number) => {
      const event = fusedEvent(TEXT, i);
      config.onDetection?.(event);
      return config.resolveStablePose?.(TEXT) ?? null;
    };
    return { ctx, arStore, placement, detect };
  }

  it("resolves the stable pose at the true rotation, not the scattered single frames", () => {
    const v = viewer();
    let pose: Pose | null = null;
    for (let i = 0; i < 7; i++) pose = v.detect(i);
    expect(pose).not.toBeNull();
    expect(angleDeg(pose!.rotation, TRUE_CODE.rotation)).toBeLessThan(0.5);
  });

  it("stops voting at a tracking restart until the code is seen again", () => {
    const v = viewer();
    for (let i = 0; i < 7; i++) v.detect(i);
    v.arStore.dispatch(qrFrameChanged());
    expect(
      captured.configs.at(-1)!.resolveStablePose?.(TEXT) ?? null,
    ).toBeNull();
  });

  it("starts a new fused source with every pipeline start (per AR session)", () => {
    const v = viewer();
    const first = v.ctx.fusedPose;
    v.placement.startViewerPipeline();
    expect(v.ctx.fusedPose).not.toBeNull();
    expect(v.ctx.fusedPose).not.toBe(first);
  });
});

describe("the creator measures and mints with the fused pose", () => {
  const DOM_KEYS = [
    "panel",
    "controls",
    "finishBlock",
    "replaceHelp",
    "replaceHelpShare",
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
  ] as const;
  function el() {
    const handlers = new Map<string, () => void>();
    return {
      hidden: false,
      textContent: "",
      disabled: false,
      value: "",
      open: false,
      addEventListener: (type: string, handler: () => void) =>
        handlers.set(type, handler),
      click: () => handlers.get("click")?.(),
    };
  }
  function creator() {
    captured.configs.length = 0;
    const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
      (typeof DOM_KEYS)[number],
      ReturnType<typeof el>
    >;
    dom.sizeInput.value = String(FUSED_SIZE_M);
    const ctx = createTourViewerSession();
    const arStore = createTourViewerStore();
    const setup = wireCreatorSetup({
      ctx,
      mode: "creator",
      arStore,
      arController: {
        getState: () => ({ status: "running" }),
        disable: () => undefined,
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
    const config = captured.configs.at(-1)!;
    return {
      dom,
      detect: (i: number) => config.onDetection?.(fusedEvent(TEXT, i)),
    };
  }

  it("reads the fused pose as stable where the single frames scatter", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    // Stable; the mint then waits only for the GPS alignment.
    expect(c.dom.status.textContent).toMatch(/pose stable/i);
  });

  it("mints from the fused pose: the tap reaches the mint, which needs the alignment next", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    const before = c.dom.status.textContent;
    c.dom.mintButton.click();
    // A mint that found no stable pose returns without a word; one that
    // found it reports what the mint itself refused (no alignment here).
    expect(c.dom.status.textContent).not.toBe(before);
  });
});
