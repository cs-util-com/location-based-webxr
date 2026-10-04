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
 * the average fails the stable-pose tests below.
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
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { Matrix4 } from "three";
import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { endQrPipeline } from "./tour-viewer-session.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import type { CodeTourStatus, ScanOpen } from "./scan-open.js";

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

// The creator's print-size check (QR size consensus plan S3a) is tested on
// its own (print-size-check.test.ts); here a controllable stand-in, whose
// defaults (no offer, nothing pending) leave the other tests as they were.
const sizeCheck = vi.hoisted(() => ({
  offer: null as { text: string; sizeM: number } | null,
  detections: [] as string[],
  answers: [] as [string, string][],
}));
vi.mock("./print-size-check.js", () => ({
  createPrintSizeCheck: () => ({
    onDetection: (text: string) => sizeCheck.detections.push(text),
    offer: () => sizeCheck.offer,
    pending: () => false,
    answer: (text: string, answer: string) => {
      sizeCheck.answers.push([text, answer]);
      sizeCheck.offer = null;
    },
    reset: () => undefined,
  }),
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
    return { ctx, arStore, placement, config, detect };
  }

  // Milestone review of b4b #3: the level lookup's callbacks run INSIDE the
  // fetch the controller awaits, before its dispose guard; a lookup that
  // finishes after the session ended must not pin "Code X has no level" or
  // a level into the next session.
  it("drops a level lookup that finishes after the session ended", async () => {
    const v = viewer();
    v.ctx.levelByText.clear();
    endQrPipeline(v.ctx);
    await v.config.fetchLevel("https://gps.csutil.com/tour/?qr=late");
    expect(v.ctx.viewerUnknownCode).toBeNull();
    expect(v.ctx.levelByText.size).toBe(0);
  });

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

  // Plan §66-§67: each lock's new evaluation feeds the ?debug=1 counts and
  // the visitor hint's last evaluation.
  it("counts each lock's evaluation and keeps the last one for the hint", () => {
    const v = viewer();
    for (let i = 0; i < 7; i++) v.detect(i);
    const counts = v.ctx.fusedTallies?.get(TEXT)?.summary();
    expect(counts?.locks).toBe(7);
    expect(counts?.stable).toBeGreaterThan(0);
    expect(v.ctx.viewerLastEvaluation?.text).toBe(TEXT);
    expect(v.ctx.viewerLastEvaluation?.result.status).toBe("stable");
  });

  // Plan §67 #10: the counts outlive the session end (the readout still
  // shows them) and are replaced at the next start; a late evaluation of
  // the ended session reaches neither the new counts nor the hint.
  it("keeps the counts past the session end and starts fresh ones per session", () => {
    const v = viewer();
    for (let i = 0; i < 3; i++) v.detect(i);
    const old = v.ctx.fusedTallies;
    endQrPipeline(v.ctx);
    expect(v.ctx.fusedTallies).toBe(old);
    v.placement.startViewerPipeline();
    expect(v.ctx.fusedTallies).not.toBe(old);
    expect(v.ctx.fusedTallies?.size).toBe(0);
    expect(v.ctx.viewerLastEvaluation).toBeNull();
    v.config.onDetection?.(fusedEvent(TEXT, 3));
    v.config.resolveStablePose?.(TEXT);
    expect(v.ctx.fusedTallies?.size).toBe(0);
    expect(v.ctx.viewerLastEvaluation).toBeNull();
  });
});

describe("the creator measures and mints with the fused pose", () => {
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
    const handlers = new Map<string, () => void>();
    return {
      hidden: false,
      textContent: "",
      disabled: false,
      value: "",
      open: false,
      dataset: {} as Record<string, string>,
      addEventListener: (type: string, handler: () => void) =>
        handlers.set(type, handler),
      click: () => handlers.get("click")?.(),
      // The object list's view (authoring plan M4): a stand-in.
      bind: () => undefined,
      render: () => undefined,
    };
  }
  /** The real store, with a solved GPS alignment laid over its state: the
   *  detections still flow through the real reducers, and the mint gate's
   *  second half (the alignment) is met, so Save can unlock. */
  function alignedOver(
    real: ReturnType<typeof createTourViewerStore>,
  ): ReturnType<typeof createTourViewerStore> {
    const gpsData = {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        // The stored form: 16 numbers, read with `Matrix4.fromArray`.
        alignmentMatrix: new Matrix4().toArray(),
        gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
          lat: 47.5,
          lon: 8.7,
        })),
      },
    };
    return {
      ...real,
      getState: () => ({ ...real.getState(), gpsData }) as never,
    };
  }
  function creator(
    options: {
      aligned?: boolean;
      codeTour?: Pick<ScanOpen, "onDetection" | "status" | "tourOf">;
    } = {},
  ) {
    captured.configs.length = 0;
    const dom = Object.fromEntries(DOM_KEYS.map((k) => [k, el()])) as Record<
      (typeof DOM_KEYS)[number],
      ReturnType<typeof el>
    >;
    dom.sizeInput.value = String(FUSED_SIZE_M);
    const ctx = createTourViewerSession();
    const real = createTourViewerStore();
    const arStore = options.aligned === true ? alignedOver(real) : real;
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
      ...(options.codeTour === undefined ? {} : { codeTour: options.codeTour }),
    });
    expect(setup.startAuthorPipeline()).toBe(true);
    const config = captured.configs.at(-1)!;
    return {
      ctx,
      dom,
      arStore,
      setup,
      detect: (i: number) => config.onDetection?.(fusedEvent(TEXT, i)),
    };
  }

  // QR size consensus plan S3a: the print is measured while the creator
  // walks; a measured size on offer can be adopted, which must restart the
  // measuring at that size and drop a position saved at the old one.
  describe("the print-size offer", () => {
    it("feeds every detection to the print-size check", () => {
      sizeCheck.detections.length = 0;
      const c = creator();
      for (let i = 0; i < 3; i++) c.detect(i);
      expect(sizeCheck.detections).toEqual([TEXT, TEXT, TEXT]);
    });

    it("shows the offer, and adopting it restarts measuring at the measured size", () => {
      const c = creator();
      c.detect(0);
      expect(c.dom.sizeOffer.hidden).toBe(true);
      sizeCheck.offer = { text: TEXT, sizeM: 0.1554 };
      sizeCheck.answers.length = 0;
      c.detect(1);
      expect(c.dom.sizeOffer.hidden).toBe(false);
      expect(c.dom.sizeOfferUse.textContent).toBe("Use 15.5 cm");
      expect(c.dom.sizeOfferKeep.textContent).toBe("Keep 16.0 cm");
      // A position saved at the old size (plan §12 #2).
      c.ctx.mintedLevel = { id: "x", json: "{}" };
      const generation = c.ctx.mintGeneration;
      const controllers = captured.configs.length;
      c.dom.sizeOfferUse.click();
      expect(sizeCheck.answers).toEqual([[TEXT, "adopted"]]);
      expect(c.dom.sizeInput.value).toBe("0.155");
      expect(c.ctx.activeSizeM).toBe(0.155);
      expect(c.ctx.mintedLevel).toBeNull();
      expect(c.ctx.mintGeneration).toBe(generation + 1);
      // A new controller, and the old size's detections are gone.
      expect(captured.configs.length).toBe(controllers + 1);
      expect(c.arStore.getState().qrDetected.markers[TEXT]).toBeUndefined();
      expect(c.dom.sizeOfferUse.hidden).toBe(true);
      expect(c.dom.sizeOfferText.textContent).toBe(
        "Now using 15.5 cm (0.155 m) - walk slowly around the code again, then save the position.",
      );
    });

    it("lets the creator keep the typed size", () => {
      const c = creator();
      sizeCheck.offer = { text: TEXT, sizeM: 0.1554 };
      sizeCheck.answers.length = 0;
      c.detect(0);
      c.dom.sizeOfferKeep.click();
      expect(sizeCheck.answers).toEqual([[TEXT, "kept"]]);
      expect(c.dom.sizeOffer.hidden).toBe(true);
      expect(c.dom.sizeInput.value).toBe(String(FUSED_SIZE_M));
    });
  });

  // Plan §66: the ?debug=1 readout counts the creator's evaluations too.
  it("counts each detection's fused evaluation for the debug readout", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    const counts = c.ctx.fusedTallies?.get(TEXT)?.summary();
    expect(counts?.locks).toBe(7);
    expect(counts?.stable).toBeGreaterThan(0);
  });

  // Milestone review of b4b #1: the readout and the mint read the fused
  // result; a cached one survives a tracking restart, and minting from it
  // would stamp the OLD frame's pose into the printed code.
  it("does not mint the old frame's pose after a tracking restart", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    c.arStore.dispatch(qrFrameChanged());
    c.dom.mintButton.click();
    expect(c.dom.status.textContent).not.toMatch(/no usable gps alignment/i);
    expect(c.dom.status.textContent).not.toMatch(/pose stable/i);
  });

  it("reads the fused pose as stable where the single frames scatter", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    // Stable; the mint then waits only for the GPS alignment.
    expect(c.dom.status.textContent).toMatch(/pose stable/i);
  });

  // TourViewer scan-to-open plan §5 #13 (a pre-existing bug): a note in
  // the panel - "not saving a backup copy", a restored draft, a failed
  // delete - replaced the live readout and locked Save until the next Pin
  // or Photo tap. On a device without OPFS the backup note fires when the
  // tour opens, before any measuring, so Save could never unlock: Pin and
  // Photo need a saved position first.
  it("keeps Save and the live readout when the panel carries a note", async () => {
    const c = creator({ aligned: true });
    c.setup.presentDraftForTour("https://example.test/tour.zip");
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    expect(
      c.ctx.placementNote,
      "the no-backup note must have fired, or this proves nothing",
    ).toContain("not saving a backup copy");
    for (let i = 0; i < 7; i++) c.detect(i);
    expect(c.dom.status.textContent).toContain("not saving a backup copy");
    expect(c.dom.status.textContent).toMatch(/measured and stable/i);
    expect(c.dom.mintButton.disabled).toBe(false);
  });

  // TourViewer scan-to-open plan §9 #4, #9, #10: the panel feeds every
  // detection to scan-to-open, says what it reports about the code in view,
  // names the open tour, keeps Save off for a code of another tour, and the
  // mint remembers which tour its code named.
  describe("step 4's scan-to-open in the panel", () => {
    function stub(status: CodeTourStatus) {
      const seen: string[] = [];
      return {
        seen,
        codeTour: {
          onDetection: (text: string) => {
            seen.push(text);
          },
          status: () => status,
          tourOf: () => "https://h.test/a.zip",
        },
      };
    }

    it("feeds every detection and shows the code's status", () => {
      const s = stub({ kind: "failed", cause: "missing", retrying: true });
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 3; i++) c.detect(i);
      expect(s.seen).toEqual([TEXT, TEXT, TEXT]);
      expect(c.dom.status.textContent).toMatch(/Could not open the tour/);
    });

    it("keeps Save on for a code of another tour: it joins the open tour", () => {
      // Plan §13 (owner): in authoring there is no wrong code.
      const s = stub({ kind: "added-to-open-tour" });
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 7; i++) c.detect(i);
      expect(c.dom.status.textContent).toMatch(/measured and stable/i);
      expect(c.dom.status.textContent).toMatch(/added to the open tour/);
      expect(c.dom.mintButton.disabled).toBe(false);
    });

    it("keeps Save on when the level in hand was measured for another tour", () => {
      // Milestone review #6: with no tour open, a level bound to a tour that
      // never opens must not block measuring this code - a new measurement
      // replaces it.
      const s = stub({ kind: "measured-for-another", label: "x.zip" });
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 7; i++) c.detect(i);
      expect(c.dom.status.textContent).toMatch(
        /You measured the code of x.zip/,
      );
      expect(c.dom.mintButton.disabled).toBe(false);
    });

    it("names the open tour", () => {
      const c = creator({
        aligned: true,
        codeTour: stub({ kind: "quiet" }).codeTour,
      });
      c.ctx.tourLabel = "a.zip";
      c.detect(0);
      expect(c.dom.status.textContent).toMatch(/Tour: a.zip/);
    });

    it("records the tour the measured code named", async () => {
      const c = creator({
        aligned: true,
        codeTour: stub({ kind: "quiet" }).codeTour,
      });
      for (let i = 0; i < 7; i++) c.detect(i);
      expect(c.dom.mintButton.disabled).toBe(false);
      c.dom.mintButton.click();
      await vi.waitFor(() => expect(c.ctx.mintedLevel).not.toBeNull());
      expect(c.ctx.mintedLevelTour).toEqual({
        levelId: c.ctx.mintedLevel?.id,
        tourUrl: "https://h.test/a.zip",
      });
    });
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
