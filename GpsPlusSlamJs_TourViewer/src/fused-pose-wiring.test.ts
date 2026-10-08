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
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import type * as QrCodeIdModule from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
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
/** The identity hash, passed through - except that a test can hold the
 *  `holdCall`-th call for a text until `release` (code book plan M1:
 *  the window while a measurement is in flight is one hash long). */
const idHold = vi.hoisted(() => ({
  text: null as string | null,
  holdCall: 0,
  calls: 0,
  gate: null as Promise<void> | null,
  /** From this call of `text` on, its identity cannot be derived (0:
   *  never) - the measurement's own derivation, after the sighting's
   *  succeeded. */
  failFrom: 0,
}));
vi.mock(
  "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id",
  async (importOriginal) => {
    const real = await importOriginal<typeof QrCodeIdModule>();
    return {
      ...real,
      qrCodeId: async (text: string) => {
        if (text === idHold.text) {
          idHold.calls += 1;
          if (idHold.failFrom > 0 && idHold.calls >= idHold.failFrom) {
            throw new Error("no Web Crypto");
          }
          if (idHold.calls === idHold.holdCall && idHold.gate !== null) {
            await idHold.gate;
          }
        }
        return real.qrCodeId(text);
      },
    };
  },
);

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
      codeTour?: Pick<ScanOpen, "onDetection" | "status" | "relation">;
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
      codes: setup.codes,
      detect: (i: number) => config.onDetection?.(fusedEvent(TEXT, i)),
      /** A detection of another code (code book plan M4c-2). */
      detectText: (text: string, i: number) =>
        config.onDetection?.(fusedEvent(text, i)),
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
      c.codes.setInHand({ id: "x", json: "{}" }, null);
      const generation = c.ctx.mintGeneration;
      const controllers = captured.configs.length;
      c.dom.sizeOfferUse.click();
      expect(sizeCheck.answers).toEqual([[TEXT, "adopted"]]);
      expect(c.dom.sizeInput.value).toBe("0.155");
      expect(c.ctx.activeSizeM).toBe(0.155);
      expect(c.codes.inHand()).toBeNull();
      expect(c.ctx.mintGeneration).toBe(generation + 1);
      // A new controller, and the old size's detections are gone.
      expect(captured.configs.length).toBe(controllers + 1);
      expect(c.arStore.getState().qrDetected.markers[TEXT]).toBeUndefined();
      expect(c.dom.sizeOfferUse.hidden).toBe(true);
      expect(c.dom.sizeOfferText.textContent).toBe(
        "Now using 15.5 cm (0.155 m) - walk slowly around the code again to measure it at this size.",
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
  // would stamp the OLD frame's pose into the printed code. Since U3 the
  // measurement follows the readout on its own, so the readout must not
  // read the old frame's pose either.
  it("does not read the old frame's pose after a tracking restart", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    c.arStore.dispatch(qrFrameChanged());
    c.setup.renderAuthorReadout();
    expect(c.dom.status.textContent).not.toMatch(/pose stable/i);
    expect(c.codes.inHand()).toBeNull();
  });

  it("reads the fused pose as stable where the single frames scatter", () => {
    const c = creator();
    for (let i = 0; i < 7; i++) c.detect(i);
    // Stable; the measurement then waits only for the GPS alignment.
    expect(c.dom.status.textContent).toMatch(/pose stable/i);
    expect(c.codes.inHand()).toBeNull();
  });

  // UI round 1, U3: no "Save the measured position" button - the code is
  // measured on its own once the gate is open, ONCE per visit and code
  // (plan review #1), so later detections do not keep re-measuring it.
  it("measures the code on its own once stable and aligned, once per visit", async () => {
    const c = creator({ aligned: true });
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    expect(c.dom.status.textContent).toMatch(/Code measured/);
    const generation = c.ctx.mintGeneration;
    for (let i = 7; i < 14; i++) c.detect(i);
    c.setup.renderAuthorReadout();
    expect(c.ctx.mintGeneration).toBe(generation);
  });

  // UI round 1, U3: with a code in hand, a NEW code (no saved position
  // anywhere) is still measured on its own - that is how a tour gains its
  // second code (each Finish writes the code in hand) - while another
  // STORED code stays a sighting (authoring-settle.test.ts).
  it("measures a new code while another code is in hand, once that one is saved in the tour", async () => {
    const c = creator({ aligned: true });
    c.codes.setInHand({ id: "an-earlier-code", json: "{}" }, null);
    // Hosted: the tour already carries it.
    c.ctx.currentLevels = new Map([["an-earlier-code", { qr: {} } as never]]);
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()?.id).not.toBe("an-earlier-code");
    });
    expect(c.codes.inHand()?.id).toBe(await qrCodeId(TEXT));
  });

  // Why (M6 follow-ups #10): a code whose identity cannot be derived when
  // it is measured is not measured, the creator is told so, and the code in
  // hand stays exactly as it was - the hand is never touched while the
  // identity is derived (U3), so nothing has to be put back. (On a phone
  // without Web Crypto the sighting's derivation fails first and no
  // measurement starts; the seam fails only the measurement's own.)
  it("measures nothing, says so, and keeps the hand when a code's identity fails", async () => {
    const c = creator({ aligned: true });
    const earlier = { id: "an-earlier-code", json: "{}" };
    c.codes.setInHand(earlier, null);
    c.ctx.currentLevels = new Map([["an-earlier-code", { qr: {} } as never]]);
    idHold.text = TEXT;
    idHold.calls = 0;
    idHold.failFrom = 2;
    try {
      for (let i = 0; i < 7; i++) c.detect(i);
      await vi.waitFor(() => {
        expect(c.ctx.placementNote).toMatch(/Could not derive the code/);
      });
      expect(c.codes.inHand()).toEqual(earlier);
      expect(c.codes.measurement()).toBeNull();
    } finally {
      idHold.text = null;
      idHold.failFrom = 0;
    }
  });

  // Code book plan M1 (a sampled mutation pass found it unpinned): Finish
  // is held while a measurement is in flight - the level it lands may be
  // the one the zip should carry.
  it("holds Finish while a measurement is in flight", async () => {
    const c = creator({ aligned: true });
    c.ctx.session = {
      archive: { url: "https://h.test/a.zip", size: 1 },
      entries: [],
      hostedFileName: () => null,
    } as never;
    c.ctx.tourManifestStatus = "settled";
    c.codes.setInHand({ id: "hosted", json: "{}" }, null);
    c.ctx.currentLevels = new Map([["hosted", { qr: {} } as never]]);
    let release: () => void = () => undefined;
    idHold.text = TEXT;
    idHold.calls = 0;
    // Call 1 identifies the sighting; call 2 is the measurement's.
    idHold.holdCall = 2;
    idHold.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      c.setup.renderAuthorReadout();
      expect(c.dom.finishButton.disabled).toBe(false);
      for (let i = 0; i < 7; i++) c.detect(i);
      await vi.waitFor(() => {
        expect(idHold.calls).toBe(2);
      });
      c.setup.renderAuthorReadout();
      expect(c.dom.finishButton.disabled).toBe(true);
      // And the click guard, not only the button state (M1 review #7): a
      // Finish tapped in that window does not start.
      c.dom.finishButton.disabled = false;
      c.dom.finishButton.click();
      expect(c.ctx.finishing).toBe(false);
      release();
      await vi.waitFor(() => {
        expect(c.codes.inHand()?.id).not.toBe("hosted");
      });
      await vi.waitFor(() => {
        expect(c.dom.finishButton.disabled).toBe(false);
      });
    } finally {
      release();
      idHold.text = null;
      idHold.gate = null;
    }
  });

  // Code book plan M1: adopting a measured print size empties the code in
  // hand; the code must then be measured again, at the new size.
  it("measures the code again at a newly adopted print size", async () => {
    const c = creator({ aligned: true });
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    sizeCheck.offer = { text: TEXT, sizeM: 0.1554 };
    c.detect(7);
    c.dom.sizeOfferUse.click();
    sizeCheck.offer = null;
    expect(c.codes.inHand()).toBeNull();
    for (let i = 8; i < 16; i++) {
      captured.configs.at(-1)?.onDetection?.(fusedEvent(TEXT, i));
    }
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    expect(c.codes.measurement()?.sizeM).toBe(0.155);
  });

  // Code book plan M4c-3: a size offer is adopted for ITS code - another
  // code in hand keeps its measurement and stays in hand.
  it("adopts a size for the offered code only, leaving another code in hand", async () => {
    const c = creator({ aligned: true });
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    const first = c.codes.inHand()!.id;
    const second = "https://gps.csutil.com/tour/?qr=second";
    for (let i = 0; i < 7; i++) c.detectText(second, i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()?.id).not.toBe(first);
    });
    const inHand = c.codes.inHand()!;
    sizeCheck.offer = { text: TEXT, sizeM: 0.2 };
    c.detect(7);
    c.dom.sizeOfferUse.click();
    sizeCheck.offer = null;
    expect(c.codes.inHand()).toEqual(inHand);
    expect(c.codes.measurement()?.levelId).toBe(inHand.id);
  });

  // Why this test matters (code book plan M4 milestone review #3): adopting
  // a size also sets the field, and a code measured on this page - not
  // hosted - was then solved at the field's NEW size, while its level said
  // the old one. A correction through its later sightings was off by
  // (ratio - 1) x the camera distance. It keeps the size it was measured at.
  it("keeps the size a code was measured at when another code's size is adopted", async () => {
    const c = creator({ aligned: true });
    const fieldM = Number(c.dom.sizeInput.value);
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    const first = c.codes.inHand()!.id;
    const second = "https://gps.csutil.com/tour/?qr=second";
    for (let i = 0; i < 7; i++) c.detectText(second, i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()?.id).not.toBe(first);
    });
    sizeCheck.offer = { text: second, sizeM: 0.3 };
    c.detectText(second, 7);
    c.dom.sizeOfferUse.click();
    sizeCheck.offer = null;
    expect(Number(c.dom.sizeInput.value)).toBe(0.3);
    // The restarted pipeline fetches each code's level before solving it.
    const config = captured.configs.at(-1)!;
    expect((await config.fetchLevel(TEXT)).qr.physicalSizeM).toBe(fieldM);
    expect((await config.fetchLevel(second)).qr.physicalSizeM).toBe(0.3);
  });

  // Code book plan M4c-3: a code the tour stores at its own printed size
  // is solved and measured at THAT size, not the size field's - two codes
  // printed at different sizes no longer share one.
  it("solves and measures a code at the size the tour stores for it", async () => {
    const c = creator({ aligned: true });
    const id = await qrCodeId(TEXT);
    c.ctx.currentLevels = new Map([
      [id, { version: 1, qr: { text: TEXT, physicalSizeM: 0.3 } } as never],
    ]);
    // The controller fetches a code's level before it solves the code.
    const level = await captured.configs.at(-1)!.fetchLevel(TEXT);
    expect(level.qr.physicalSizeM).toBe(0.3);
    expect(Number(c.dom.sizeInput.value)).not.toBe(0.3);
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    expect(c.codes.measurement()?.sizeM).toBe(0.3);
  });

  // Code book plan M4c-2 (replacing U3 milestone review #7's "Finish
  // first"): a Finish writes every code of the book since M4c-1, so a new
  // code is measured past an unsaved one and neither is dropped.
  it("measures a new code past one not saved yet", async () => {
    const c = creator({ aligned: true });
    c.codes.setInHand({ id: "measured-not-finished", json: "{}" }, null);
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()?.id).not.toBe("measured-not-finished");
    });
    expect(c.dom.status.textContent).not.toMatch(/Finish first/);
  });

  // Code book plan M4c-2: a code measured earlier in the visit is still
  // "measured" once another code has taken the hand - not "seen", and
  // never measured a second time.
  it("still reads a code measured earlier in the visit as measured after a second code", async () => {
    const c = creator({ aligned: true });
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    const first = c.codes.inHand()!.id;
    const second = "https://gps.csutil.com/tour/?qr=second";
    for (let i = 0; i < 7; i++) c.detectText(second, i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()?.id).not.toBe(first);
    });
    // Each measurement bumps the mint generation.
    const before = c.ctx.mintGeneration;
    for (let i = 7; i < 14; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.dom.status.textContent).toMatch(/Code measured/);
    });
    expect(c.ctx.mintGeneration).toBe(before);
  });

  // TourViewer scan-to-open plan §5 #13 (a pre-existing bug): a note in
  // the panel - "not saving a backup copy", a restored draft, a failed
  // delete - replaced the live readout and locked measuring until the next
  // Pin or Photo tap. Since U3 the automatic measurement must also leave
  // the note standing (plan review #1): nothing the creator did asked for
  // it.
  it("measures, and keeps the live readout and the note, when the panel carries a note", async () => {
    const c = creator({ aligned: true });
    c.setup.presentDraftForTour("https://example.test/tour.zip");
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    expect(
      c.ctx.placementNote,
      "the no-backup note must have fired, or this proves nothing",
    ).toContain("not saving a backup copy");
    for (let i = 0; i < 7; i++) c.detect(i);
    await vi.waitFor(() => {
      expect(c.codes.inHand()).not.toBeNull();
    });
    expect(c.ctx.placementNote).toContain("not saving a backup copy");
    expect(c.dom.status.textContent).toContain("not saving a backup copy");
    expect(c.dom.status.textContent).toMatch(/Code measured/);
  });

  // TourViewer scan-to-open plan §9 #4, #9, #10: the panel feeds every
  // detection to scan-to-open, says what it reports about the code in view,
  // names the open tour, and the measurement remembers which tour its code
  // named. UI round 1, U3: which codes are measured on their own.
  describe("step 4's scan-to-open in the panel", () => {
    function stub(
      status: CodeTourStatus,
      relation: ReturnType<ScanOpen["relation"]> = "this-tour",
    ) {
      const seen: string[] = [];
      return {
        seen,
        codeTour: {
          onDetection: (text: string) => {
            seen.push(text);
          },
          status: () => status,
          relation: () => relation,
        },
      };
    }

    async function settled(): Promise<void> {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    }

    it("feeds every detection and shows the code's status", () => {
      const s = stub({ kind: "failed", cause: "missing", retrying: true });
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 3; i++) c.detect(i);
      expect(s.seen).toEqual([TEXT, TEXT, TEXT]);
      expect(c.dom.status.textContent).toMatch(/Could not open the tour/);
    });

    // Code book plan §11 D5, extended by the owner: every code seen while
    // a tour is open is measured - another tour's too, also for a tour
    // that has codes (before M4c-2 only for a tour with none).
    it("measures another tour's code, for a tour with codes too", async () => {
      const s = stub({ kind: "added-to-open-tour" }, "other-tour");
      const first = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 7; i++) first.detect(i);
      await vi.waitFor(() => {
        expect(first.codes.inHand()).not.toBeNull();
      });
      expect(first.dom.status.textContent).toMatch(/added to the open tour/);

      const withCodes = creator({ aligned: true, codeTour: s.codeTour });
      withCodes.ctx.currentLevels = new Map([["other", { qr: {} } as never]]);
      for (let i = 0; i < 7; i++) withCodes.detect(i);
      await vi.waitFor(() => {
        expect(withCodes.codes.inHand()).not.toBeNull();
      });
      expect(withCodes.dom.status.textContent).not.toMatch(/not measured/);
    });

    it("measures nothing with no tour open", async () => {
      // ...and the line never claims a measurement (U3: "ready" is not
      // "measured").
      const s = stub({ kind: "quiet" }, "no-tour-open");
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 7; i++) c.detect(i);
      await settled();
      expect(c.codes.inHand()).toBeNull();
      expect(c.dom.status.textContent).toMatch(/Code seen\./);
      expect(c.dom.status.textContent).not.toMatch(/Code measured/);
    });

    // The owner's extension of D5: a stray QR that names no tour is
    // "another anchor that can stabilize the virtual objects".
    it("measures a code naming no tour while a tour is open", async () => {
      const s = stub({ kind: "quiet" }, "not-a-tour");
      const c = creator({ aligned: true, codeTour: s.codeTour });
      for (let i = 0; i < 7; i++) c.detect(i);
      await vi.waitFor(() => {
        expect(c.codes.inHand()).not.toBeNull();
      });
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
  });
});
