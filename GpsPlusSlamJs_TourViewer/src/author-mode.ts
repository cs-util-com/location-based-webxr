/**
 * Author mode (QR-pose plan M3; its own module since the flows plan M6). The
 * author panel exists only under ?author=1; its tracking controller is
 * (re)created per AR entry so the printed-size input is captured once at
 * start (changing it means exit + re-enter — cheap, and honest about what
 * the synthetic level actually carried). Minting derives the code's geo
 * pose from the stable QR pose and the session alignment, and hands the
 * author a `qr/<id>.json` download.
 */

import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  AUTHOR_DEFAULT_SIZE_M,
  mintQrLevel,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  recordQrDetection,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrPoseStability,
  selectStableQrPose,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import {
  authorLevelHint,
  authorStatusLine,
  buildAuthorControllerConfig,
} from "./qr-author-mode.js";
import type { TourViewerSeams } from "./seams.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";

export interface AuthorModeDom {
  panel: HTMLElement;
  /** The printed side length - lives in the print panel (DEC-F2). */
  sizeInput: HTMLInputElement;
  /** The print panel, opened when the size error points at it. */
  printPanel: HTMLDetailsElement;
  status: HTMLDivElement;
  mintButton: HTMLButtonElement;
  jsonBox: HTMLTextAreaElement;
  copyButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  hint: HTMLParagraphElement;
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface AuthorMode {
  renderAuthorReadout: () => void;
  /** Creates the author tracking controller for THIS AR entry; false (with
   *  the reason in the panel) keeps AR unstarted. */
  startAuthorPipeline: () => boolean;
}

export function wireAuthorMode(deps: {
  ctx: TourViewerSession;
  authorMode: boolean;
  arStore: TourViewerStore;
  seams: TourViewerSeams;
  dom: AuthorModeDom;
}): AuthorMode {
  const { ctx, authorMode, arStore, seams, dom } = deps;

  dom.panel.hidden = !authorMode;
  dom.sizeInput.value = String(AUTHOR_DEFAULT_SIZE_M);
  if (authorMode) {
    // Alignment arrives via GPS dispatches, not via controller state — the
    // readout must follow the store, or "waiting for GPS alignment" sticks.
    arStore.subscribe(() => {
      renderAuthorReadout();
    });
  }

  function authorAlignmentInfo(): MintAlignmentInfo {
    const state = arStore.getState();
    const accuracy = state.gpsData?.gpsEvents?.gpsAccuracyMedian;
    const sinceSessionStart = Math.max(
      0,
      selectGpsPositions(state).length - ctx.gpsSamplesAtSessionStart,
    );
    return {
      hasMatrix: selectAlignmentMatrix(state) !== null,
      sampleCount: sinceSessionStart,
      ...(typeof accuracy === "number" ? { gpsAccuracyM: accuracy } : {}),
    };
  }

  function renderAuthorReadout(): void {
    if (!authorMode) return;
    if (ctx.authorErrorText !== null) {
      dom.status.textContent = ctx.authorErrorText;
      dom.mintButton.disabled = true;
      return;
    }
    const state = arStore.getState();
    const stability =
      ctx.lastDetectedText === null
        ? null
        : selectQrPoseStability(state, ctx.lastDetectedText);
    const readout = authorStatusLine(
      ctx.lastDetectedText,
      stability,
      authorAlignmentInfo(),
    );
    dom.status.textContent = readout.text;
    dom.mintButton.disabled = !readout.canMint;
  }

  function startAuthorPipeline(): boolean {
    ctx.authorErrorText = null;
    // Validate BEFORE starting anything: a cleared number input yields 0, the
    // min attribute never fires outside a form, and the resulting RangeError
    // used to unwind into the generic error box — the surface the author is
    // not looking at (PR #360 review).
    const parsedSize = Number(dom.sizeInput.value);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      // The input lives in the print section since the flows plan M3 - name
      // it and open it, or the message points at a collapsed panel.
      ctx.authorErrorText =
        "Enter the printed code's side length in metres (e.g. 0.2) in the Print section above before starting.";
      dom.printPanel.open = true;
      renderAuthorReadout();
      return false;
    }
    ctx.activeSizeM = parsedSize;
    const frontEnd = seams.createQrFrontEnd();
    if (frontEnd === null) {
      ctx.authorErrorText =
        "This browser has no QR detector (BarcodeDetector) — use Android Chrome to author.";
      renderAuthorReadout();
      return false;
    }
    ctx.qrController = createQrTrackingController(
      buildAuthorControllerConfig(ctx.activeSizeM, {
        frontEnd,
        solvePose: (input) => seams.solveQrPose(input),
        getCameraPose: () => seams.getCameraPose(),
        getIntrinsics: (image) => seams.getIntrinsics(image),
        recordDetection: (event) => {
          ctx.authorErrorText = null; // a live detection supersedes a stale error
          ctx.lastDetectedText = event.text;
          arStore.dispatch(recordQrDetection(event));
          ctx.qrDebugView?.update(event.qrPoseWorld, ctx.activeSizeM);
          renderAuthorReadout();
        },
        onError: (message) => {
          ctx.authorErrorText = `QR tracking failed: ${message}`;
          renderAuthorReadout();
        },
      }),
    );
    renderAuthorReadout();
    return true;
  }

  dom.mintButton.addEventListener("click", () => {
    if (ctx.lastDetectedText === null) return;
    const state = arStore.getState();
    const stablePose = selectStableQrPose(state, ctx.lastDetectedText);
    if (stablePose === null) return; // the gate lost stability since render
    const result = mintQrLevel({
      odomPose: stablePose,
      alignmentMatrix: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      alignment: authorAlignmentInfo(),
      sizeM: ctx.activeSizeM,
      nowIso: new Date().toISOString(),
    });
    if (!result.ok) {
      // Inside the DOM-overlay root — errorBox is a sibling of #ar-root and
      // therefore INVISIBLE during the AR session (milestone review #4).
      dom.status.textContent = result.error;
      return;
    }
    dom.jsonBox.value = result.json;
    dom.jsonBox.hidden = false;
    dom.copyButton.hidden = false;
    dom.downloadButton.hidden = false;
    dom.hint.hidden = false;
    // The file name IS the code's identity, derived from the exact text this
    // poster carries — so the author never has to match a number by hand.
    const mintedText = ctx.lastDetectedText;
    // Cleared BEFORE the new hash starts: otherwise a second mint's download
    // button carries the PREVIOUS code's file name until the microtask lands.
    ctx.mintedCodeId = null;
    dom.hint.textContent = authorLevelHint(null);
    qrCodeId(mintedText).then(
      (id) => {
        ctx.mintedCodeId = id;
        dom.hint.textContent = authorLevelHint(id);
      },
      () => {
        // A failed hash is not a failed mint: the JSON is already usable, and
        // the hint stays useful without an identity.
        dom.hint.textContent = authorLevelHint(null);
      },
    );
  });

  dom.copyButton.addEventListener("click", () => {
    // Async-UI rule + the AnchorStarter label-revert guard: a second click
    // during the transient label must not capture it as the idle label.
    navigator.clipboard.writeText(dom.jsonBox.value).then(
      () => {
        dom.copyButton.textContent = "Copied ✓";
        setTimeout(() => (dom.copyButton.textContent = "Copy JSON"), 2000);
      },
      () => {
        dom.copyButton.textContent = "Copy failed — select the text above";
        setTimeout(() => (dom.copyButton.textContent = "Copy JSON"), 2000);
      },
    );
  });

  dom.downloadButton.addEventListener("click", () => {
    // Hidden-anchor download (the session-summary precedent). Browsers strip
    // path separators from `download`, so the file arrives as `<id>.json`; the
    // panel's hint tells the author to place it under `qr/` in the zip.
    const blob = new Blob([dom.jsonBox.value], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ctx.mintedCodeId ?? "qr-level"}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  return { renderAuthorReadout, startAuthorPipeline };
}
