/**
 * The creator's AR setup (guided-setup plan M3; the QR-pose plan's "author
 * mode" until 2026-09-08): the panel inside `#ar-root` that guides the
 * creator through measuring the hung code (the mint gate: stable pose plus
 * GPS alignment), keeps the measured level in the session, and on FINISH
 * rebuilds the hosted zip in the browser with `qr/<id>.json` and
 * `tour.json` added (DEC-N6), ends the AR session, and hands the creator
 * the download in step 5 - a fresh tap, because a download needs its own
 * user gesture. The manual "download the JSON and add it to the zip" hand-
 * off of the flows plan is gone: the zip is the artefact.
 *
 * The tracking controller is (re)created per AR entry so the printed-size
 * input is captured once at start (changing it means exit + re-enter -
 * cheap, and honest about what the synthetic level actually carried).
 */

import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  qrLevelEntryName,
  qrLevelIdFromEntryName,
} from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  AUTHOR_DEFAULT_SIZE_M,
  mintQrLevel,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  recordQrDetection,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrPoseStability,
  selectStableQrPose,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
  buildAuthorControllerConfig,
  FINISH_LABELS,
  finishBlockedHint,
  finishReadiness,
  setupHint,
} from "./qr-author-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { archiveFileName } from "./tour-session.js";
import type {
  ArController,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

export interface CreatorSetupDom {
  /** The setup panel inside `#ar-root` (DOM overlay). */
  panel: HTMLElement;
  /** The printed side length - lives in the print step (DEC-F2). */
  sizeInput: HTMLInputElement;
  /** The print step, opened when the size error points at it. */
  printPanel: HTMLDetailsElement;
  status: HTMLElement;
  mintButton: HTMLButtonElement;
  finishButton: HTMLButtonElement;
  /** Step 5 on the page (outside the overlay): where the download lands. */
  finishStatus: HTMLElement;
  downloadButton: HTMLButtonElement;
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface CreatorSetup {
  renderAuthorReadout: () => void;
  /** Creates the author tracking controller for THIS AR entry; false (with
   *  the reason in the panel) keeps AR unstarted. */
  startAuthorPipeline: () => boolean;
  /** A tour closed: step 5's download and status are stale (M3 review #6). */
  resetFinishStep: () => void;
}

export function wireCreatorSetup(deps: {
  ctx: TourViewerSession;
  mode: ViewerMode;
  arStore: TourViewerStore;
  arController: ArController;
  seams: TourViewerSeams;
  wizard: Wizard;
  dom: CreatorSetupDom;
}): CreatorSetup {
  const { ctx, mode, arStore, arController, seams, wizard, dom } = deps;
  const creator = mode === "creator";

  dom.panel.hidden = !creator;
  dom.sizeInput.value = String(AUTHOR_DEFAULT_SIZE_M);
  if (creator) {
    // Alignment arrives via GPS dispatches, not via controller state - the
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
    if (!creator) return;
    if (ctx.authorErrorText !== null) {
      dom.status.textContent = ctx.authorErrorText;
      dom.mintButton.disabled = true;
      return;
    }
    // The finish step owns the line while it runs and after it failed
    // (M3 review #1/#3): store dispatches keep arriving during the rebuild
    // (GPS fixes, detections) and used to overwrite both.
    if (ctx.finishing) {
      dom.status.textContent = ctx.finishProgress;
      dom.mintButton.disabled = true;
      dom.finishButton.disabled = true;
      return;
    }
    if (ctx.finishError !== null) {
      dom.status.textContent = ctx.finishError;
      dom.mintButton.disabled = true;
      dom.finishButton.disabled = false;
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
    // Once measured, the setup hint (what to do next) joins the live
    // measuring readout - re-measuring stays possible, and the readout's
    // gate wording (the fix count) stays visible on a re-entry.
    const hint = setupHint({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      hadLevel: (ctx.currentLevels?.size ?? 0) > 0,
    });
    dom.status.textContent =
      hint === "" ? readout.text : `${readout.text} · ${hint}`;
    dom.mintButton.disabled = !readout.canMint;
    const readiness = finishReadiness({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      manifest: ctx.tourManifestStatus,
    });
    dom.finishButton.disabled = readiness !== "ready";
    const blocked = finishBlockedHint(readiness);
    if (blocked !== "") dom.status.textContent += ` · ${blocked}`;
    if (readiness === "ready" && ctx.session !== null) {
      dom.status.textContent += ` · ${archiveSizeNote(ctx.session.archive.size)}`;
    }
  }

  function startAuthorPipeline(): boolean {
    ctx.authorErrorText = null;
    // Validate BEFORE starting anything: a cleared number input yields 0, the
    // min attribute never fires outside a form, and the resulting RangeError
    // used to unwind into the generic error box - the surface the creator is
    // not looking at (PR #360 review).
    const parsedSize = Number(dom.sizeInput.value);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      ctx.authorErrorText =
        "Enter the printed code's side length in metres (e.g. 0.16) in step 2 before starting.";
      dom.printPanel.open = true;
      renderAuthorReadout();
      return false;
    }
    ctx.activeSizeM = parsedSize;
    const frontEnd = seams.createQrFrontEnd();
    if (frontEnd === null) {
      ctx.authorErrorText =
        "This browser has no QR detector (BarcodeDetector) — use Android Chrome to set up a tour.";
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
      // Inside the DOM-overlay root - errorBox is a sibling of #ar-root and
      // therefore INVISIBLE during the AR session (milestone review #4).
      dom.status.textContent = result.error;
      return;
    }
    ctx.finishError = null; // a new measurement supersedes a failed finish
    // The file name IS the code's identity, derived from the exact text this
    // poster carries - so the creator never matches a number by hand. The
    // hash is async; until it lands the finish button stays off (the level
    // is not addressable yet), and a second mint before it lands is
    // superseded by the newest.
    const mintedText = ctx.lastDetectedText;
    const mintGeneration = ++ctx.mintGeneration;
    ctx.mintedLevel = null;
    dom.status.textContent = "Saving the measured position…";
    dom.finishButton.disabled = true;
    qrCodeId(mintedText).then(
      (id) => {
        if (mintGeneration !== ctx.mintGeneration) return;
        ctx.mintedLevel = { id, json: result.json };
        renderAuthorReadout();
      },
      () => {
        if (mintGeneration !== ctx.mintGeneration) return;
        dom.status.textContent =
          "Could not derive the code's identity - tap the button again.";
      },
    );
  });

  dom.finishButton.addEventListener("click", () => {
    const current = ctx.session;
    const minted = ctx.mintedLevel;
    if (
      current === null ||
      minted === null ||
      ctx.finishing ||
      ctx.tourManifestStatus !== "settled"
    ) {
      return;
    }
    // Both guards for the continuation: the tour may be re-opened and the
    // AR session may end (and a new one start) while the rebuild runs; the
    // result must not land in a session or a tour it was not made for
    // (M3 review #2).
    const sessionGeneration = ctx.arSessionGeneration;
    ctx.finishing = true;
    ctx.finishError = null;
    ctx.finishProgress = FINISH_LABELS.reading(current.archive.size);
    renderAuthorReadout();
    // A zip in the tolerated wrapped shape (`mytour/qr/<id>.json`) keeps
    // its level where it is; adding a second file at the root would leave
    // a stale duplicate on every finish.
    const existingLevelPath = current.entries
      .map((e) => e.filename)
      .find((name) => qrLevelIdFromEntryName(name) === minted.id);
    const entries = [
      {
        path: existingLevelPath ?? qrLevelEntryName(minted.id),
        data: minted.json,
      },
      {
        path: TOUR_MANIFEST_ENTRY,
        data: serializeTourManifest(
          ctx.tourManifest ?? createEmptyTourManifest(),
        ),
      },
    ];
    void (async () => {
      try {
        const input = await current.readWholeArchive();
        if (ctx.session !== current) return; // re-opened meanwhile
        const blob = await rebuildZipWithEntries(input, entries, {
          onProgress: (done, total) => {
            ctx.finishProgress = FINISH_LABELS.rebuilding(done, total);
            renderAuthorReadout();
          },
        });
        if (ctx.session !== current) return;
        ctx.rebuiltZip = {
          blob,
          filename: archiveFileName(current.archive.url),
        };
        dom.finishStatus.textContent = FINISH_LABELS.ready(blob.size);
        dom.downloadButton.disabled = false;
        // The session ends so the creator lands on the page, where the
        // download button is a fresh tap (a download needs its own user
        // gesture, plan §2.4) - unless it already ended and another one
        // started, which is then not ours to end.
        if (sessionGeneration === ctx.arSessionGeneration) {
          await arController.disable();
        }
        wizard.openStep("finish");
      } catch (err) {
        if (ctx.session === current) {
          ctx.finishError = FINISH_LABELS.failed(
            err instanceof Error ? err.message : String(err),
          );
        }
      } finally {
        ctx.finishing = false;
        ctx.finishProgress = "";
        renderAuthorReadout();
      }
    })();
  });

  dom.downloadButton.addEventListener("click", () => {
    const rebuilt = ctx.rebuiltZip;
    if (rebuilt === null) return;
    // Async-UI rule: in-progress before the await, the durable end state
    // after; a dismissed save picker (`false`) keeps the button live.
    dom.downloadButton.disabled = true;
    dom.downloadButton.textContent = FINISH_LABELS.saving;
    seams.downloadZip(rebuilt.blob, rebuilt.filename).then(
      (saved) => {
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = FINISH_LABELS.download;
        dom.finishStatus.textContent = saved
          ? FINISH_LABELS.saved(rebuilt.filename)
          : FINISH_LABELS.notSaved;
        if (saved) wizard.openStep("replace");
      },
      (err: unknown) => {
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = FINISH_LABELS.download;
        dom.finishStatus.textContent = FINISH_LABELS.failed(
          err instanceof Error ? err.message : String(err),
        );
      },
    );
  });

  return {
    renderAuthorReadout,
    startAuthorPipeline,
    resetFinishStep: () => {
      dom.downloadButton.disabled = true;
      dom.finishStatus.textContent = "";
    },
  };
}
