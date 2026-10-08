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
 * input is captured once at start; the one mid-session change is adopting
 * the print size the phone measured (QR size consensus plan S3a), which
 * restarts the pipeline at that size and drops the old detections.
 *
 * Since the code book refactor plan's M2 this file is the COMPOSITION ROOT:
 * it wires the `creator-*.ts` modules (draft, previews, alignment picks,
 * move prompt, placement, measuring, settle, finish, hand-off), keeps the
 * readout that joins them, and returns the hooks `main.ts` and
 * `ar-entry.ts` call. Each module owns its state; the hooks fan out to
 * their `endVisit` / `reset`.
 */

import {
  AUTHOR_DEFAULT_SIZE_M,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrFusedEntries,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";

import {
  finishButtonText,
  hideFinishForResult,
  leaveNeedsConfirm,
  leaveQuestion,
  type FinishGuardInput,
} from "./finish-guard.js";

import { wireCreatorHandoff } from "./creator-handoff.js";
import { wireCreatorCodes, type CreatorCodes } from "./creator-codes.js";
import { wireCreatorDraft } from "./creator-draft.js";
import { wireCreatorPreviews } from "./creator-previews.js";
import { wireCreatorAlignmentPicks } from "./creator-alignment-picks.js";
import { wireCreatorPlacement } from "./creator-placement.js";
import { wireCreatorMeasuring } from "./creator-measuring.js";
import { wireCreatorSettle } from "./creator-settle.js";
import { wireCreatorFinish } from "./creator-finish.js";

import { newObjectId } from "./content-placement.js";

import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";

import {
  removeDraftDeletion,
  writeDraftDeletion,
  writeDraftObject,
} from "./draft-persistence.js";

import type { SummaryPanel } from "./summary-panel.js";
import { createVisitLog } from "./visit-log.js";
import { wireObjectEditing } from "./object-editing.js";
import type { ObjectListView } from "./object-list.js";
import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
  finishBlockedHint,
  codeTourLine,
  entryHint,
  setupHint,
} from "./qr-author-mode.js";

import { createPrintSizeCheck } from "./print-size-check.js";
import type { ScanOpen } from "./scan-open.js";
import type { TourViewerSeams } from "./seams.js";

import {
  type ArController,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

/**
 * Whether an AR session is live, from the controller's status.
 *
 * `starting` counts: the camera is coming up and the creator is already
 * looking through the overlay. `stopping` counts for the mirror-image
 * reason - the session is still composited while it tears down.
 */
export function arSessionLive(status: string): boolean {
  return status === "starting" || status === "running" || status === "stopping";
}

export interface CreatorSetupDom {
  /** The setup panel inside `#ar-root` (DOM overlay). Shown for a creator
   *  on the whole page, because `status` is where a REFUSED AR entry says
   *  why - and a refused entry never starts a session. */
  panel: HTMLElement;
  /** The AR-only buttons inside the panel. Hidden unless a session is
   *  live: on a desktop they sat greyed out under an "AR not supported"
   *  button, misaligned and meaningless (second testing session, F11). */
  controls: HTMLElement;
  /** Step 4's tail: the rebuilt zip's status and save (F10). Outside
   *  `#ar-root` - the Finish saves the zip once the session has ended. */
  finishBlock: HTMLElement;
  /** The "put it back where the old one is" copy, revealed once the zip
   *  has actually been saved. Was step 6 until the flow rework. */
  replaceHelp: HTMLElement;
  /** The replace instructions for Dropbox, GitHub and OneDrive... */
  replaceHelpGeneric: HTMLElement;
  /** ...and a Drive tour's own numbered steps with the zip's name, written
   *  here (Drive replace plan §2 decision 1). */
  replaceHelpDrive: HTMLElement;
  /** The printed side length - lives in the print step (DEC-F2). */
  sizeInput: HTMLInputElement;
  /** The print step, opened when the size error points at it. */
  printPanel: HTMLDetailsElement;
  status: HTMLElement;
  finishButton: HTMLButtonElement;
  /** "Keep the walk recording in the zip" (scan-pass plan S1, S-D10):
   *  shown beside Finish only for a tour that carries entries visitors
   *  never read; unticked, the Finish leaves them out. */
  keepScanRow: HTMLElement;
  keepScanInput: HTMLInputElement;
  /** Step 5 on the page (outside the overlay): where the download lands. */
  finishStatus: HTMLElement;
  downloadButton: HTMLButtonElement;
  /** The placement controls (inside the overlay): a pin at the reticle
   *  with a label, a photo of the current camera frame. */
  pinButton: HTMLButtonElement;
  pinLabel: HTMLInputElement;
  pinSave: HTMLButtonElement;
  pinCancel: HTMLButtonElement;
  photoButton: HTMLButtonElement;
  /** The "unsaved work is still on this device" offer (F13). */
  draftOffer: HTMLElement;
  draftOfferText: HTMLElement;
  draftRestore: HTMLButtonElement;
  draftDismiss: HTMLButtonElement;
  draftDiscard: HTMLButtonElement;
  /** The print-size offer inside the panel (QR size consensus plan S3a):
   *  its own element, because `status` is rewritten on every dispatch. */
  sizeOffer: HTMLElement;
  sizeOfferText: HTMLElement;
  sizeOfferUse: HTMLButtonElement;
  sizeOfferKeep: HTMLButtonElement;
  /** The placed objects' list with Edit text, Move and Delete (authoring
   *  plan 2026-09-28-0953 §3.4, M4): `object-list.ts`'s view. */
  objectList: ObjectListView;
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface CreatorSetup {
  /** The one owner of the codes (`creator-codes.ts`): the code in hand,
   *  its measurement and the book, read and written only through it. */
  readonly codes: CreatorCodes;
  renderAuthorReadout: () => void;
  /** Every code this page measured or took (code book plan M4d): the
   *  print step counts them with the hosted ones. */
  measuredCodeIds: () => string[];
  /** True while leaving (the page, or for another tour) should ask first:
   *  a rebuilt tour file was not saved (UI round 1, U2, `finish-guard`). */
  leaveNeedsConfirm: () => boolean;
  /** The question to ask then (`finish-guard`'s `leaveQuestion`). */
  leaveQuestion: () => string;
  /** Creates the author tracking controller for THIS AR entry; false (with
   *  the reason in the panel) keeps AR unstarted. */
  startAuthorPipeline: () => boolean;
  /** A tour closed: step 5's download and status are stale (M3 review #6). */
  resetFinishStep: () => void;
  /** A creator's AR visit runs: show the earlier visits' objects. */
  beginAuthorVisit: () => void;
  /** A creator's AR visit ends: settle it (before the store teardown). */
  endAuthorVisit: () => void;
  /** A tour opened and its manifest settled: load any draft for it, and
   *  either offer what is not already hosted or delete a spent one. */
  presentDraftForTour: (tourUrl: string) => void;
  /** A tap in AR (an XR `select` the overlay did not cancel): select the
   *  object under the tap (its target ray; the screen centre when null),
   *  or clear the selection on a miss. */
  selectInView: (tap: SelectTargetRay | null) => void;
}

export function wireCreatorSetup(deps: {
  ctx: TourViewerSession;
  mode: ViewerMode;
  arStore: TourViewerStore;
  arController: ArController;
  seams: TourViewerSeams;
  wizard: Wizard;
  dom: CreatorSetupDom;
  /** Opens this tour's draft namespace, or resolves undefined where there
   *  is no persistence (no OPFS, blocked site data, a quota wall). */
  openDraftStore?: (key: string) => Promise<DraftFileStore | undefined>;
  /** Step 4's scan-to-open (`scan-open.ts`, owned by `archive-open`):
   *  fed every detection, asked what to say about the code in view. */
  codeTour?: Pick<ScanOpen, "onDetection" | "status" | "relation">;
  /** The summary after Finish (authoring plan 2026-09-28-0953 M3b,
   *  `summary-panel.ts`); none in the node tests that do not need it. */
  summary?: Pick<SummaryPanel, "show" | "hide">;
}): CreatorSetup {
  const { ctx, mode, arStore, arController, seams, wizard, dom } = deps;
  const codeTour: Pick<ScanOpen, "onDetection" | "status" | "relation"> =
    deps.codeTour ?? {
      onDetection: () => undefined,
      status: () => ({ kind: "quiet" }),
      // The node tests' stand-in: every code is the open tour's, so it is
      // measured as soon as the gate opens (`main.ts` always passes the
      // real scan-to-open).
      relation: () => "this-tour",
    };
  const creator = mode === "creator";
  const openDraftStore =
    deps.openDraftStore ?? (() => Promise.resolve(undefined));

  /**
   * The creator's AR visits, page-side (authoring plan 2026-09-28-0953 §3.3
   * and §7 #4, M3b): the store forgets a visit's walk and alignment at its
   * end, and the summary after Finish needs every visit. Filled at each
   * settle, written to the draft one file per visit, restored with a
   * restored draft, emptied when the tour closes.
   */
  const visitLog = createVisitLog();
  /** This page load's id: a visit id is this plus the visit's generation,
   *  which restarts at 0 on every load (`newVisitId`). */
  const pageId = newObjectId();
  /** The one owner of the codes (`creator-codes.ts`, plan M4a). */
  const codes = wireCreatorCodes({ ctx });
  /** The running visit's per-moment alignments (owner decision D33,
   *  `creator-alignment-picks.ts`). */
  const alignmentPicks = wireCreatorAlignmentPicks({
    arStore,
    codes,
    alignmentInfo: () => authorAlignmentInfo(),
  });
  /** The tour's on-device draft (`creator-draft.ts`): the offer, the
   *  ordered writes, the rejections and the move prompt's answers. */
  const draft = wireCreatorDraft({
    ctx,
    dom,
    openDraftStore,
    visitLog,
    codes,
    wizard,
    sessionLive,
    syncPreviews: () => {
      previews.sync();
    },
    render: () => {
      renderAuthorReadout();
    },
  });
  /** The placed objects' previews and the earlier visits' frame
   *  (`creator-previews.ts`). */
  const previews = wireCreatorPreviews({
    ctx,
    arStore,
    seams,
    creator,
    objects: () => editing.objects(),
  });

  dom.panel.hidden = !creator;
  // ONE TAP, ONE EVENT (the PhysicsDemo pattern, `ar-mode.ts`): a tap on
  // the DOM overlay fires a DOM click AND an XR select, and a select picks
  // the object under the ring (M4) - so a tap on Delete would also select
  // whatever stands behind the button. Cancelling `beforexrselect` on the
  // panel suppresses only the XR half, and only for taps on the panel.
  dom.panel.addEventListener("beforexrselect", (event) => {
    event.preventDefault();
  });
  dom.sizeInput.value = String(AUTHOR_DEFAULT_SIZE_M);

  // The print-size check (QR size consensus plan S3a): measures the printed
  // code by parallax while the creator walks; reset per AR session and per
  // tour (ar-entry, archive-open).
  ctx.printSizeCheck = createPrintSizeCheck({
    estimate: (text) =>
      seams.estimateQrPrintSize(selectQrFusedEntries(arStore.getState(), text)),
  });

  /** True while the AR session is up: what gates the controls and the live
   *  measuring readout. Read from the controller rather than tracked, so
   *  it cannot drift out of step with the session it describes. */
  function sessionLive(): boolean {
    return arSessionLive(arController.getState().status);
  }

  /** The object list and its actions (authoring plan 2026-09-28-0953
   *  §3.4, M4): edit, move and delete over the same in-memory state the
   *  placement fills, and the selection a tap in AR makes. */
  const editing = wireObjectEditing({
    ctx,
    arStore,
    view: dom.objectList,
    getArWorldGroup: () => seams.getArWorldGroup(),
    sessionLive,
    placementAllowed: () => placement.allowed(),
    notePlaced: (id) => {
      alignmentPicks.notePlaced(id);
    },
    settleInputs: () => ({
      mintedLevel: codes.inHand(),
      measurement: codes.measurement(),
      sighting: codes.sighting(),
      gpsAccuracyM: authorAlignmentInfo().gpsAccuracyM,
    }),
    codes: () => codes.storedPoses(),
    saveDraftObject: (object, blob) =>
      draft.write(object.id, (store) => writeDraftObject(store, object, blob)),
    saveDraftDeletion: (id) =>
      draft.write(id, (store) => writeDraftDeletion(store, id)),
    forgetDraftDeletion: (id) =>
      draft.write(id, (store) => removeDraftDeletion(store, id)),
    schedule: (fn, ms) => seams.schedule(fn, ms),
    forgetDraftObject: (id) => draft.forgetObject(id),
    syncPreviews: () => {
      previews.sync();
    },
    renderAuthorReadout: () => {
      renderAuthorReadout();
    },
  });

  if (creator) {
    // Alignment arrives via GPS dispatches, not via controller state - the
    // readout must follow the store, or "waiting for GPS alignment" sticks.
    // So does the zero, which the previews from geo wait for.
    arStore.subscribe(() => {
      alignmentPicks.sync();
      if (
        previews.waitingForZero() &&
        selectZeroReference(arStore.getState()) !== null
      ) {
        previews.sync();
      }
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

  /** The entry hint (§3.2a, D5) as the line's first part, until this
   *  visit has seen the code in hand (or any code, with none measured). */
  function entryLead(): string {
    const sighting = codes.sighting();
    const inHand = codes.inHand();
    const hint = entryHint({
      tourOpen: ctx.session !== null,
      codeSeen:
        sighting !== null &&
        (inHand === null || sighting.levelId === inHand.id),
    });
    return hint === "" ? "" : `${hint} · `;
  }

  /** Whether the level in hand is a stored pose THIS visit did not measure
   *  (hosted, draft, or an earlier visit's): what a new measurement keeps. */
  function levelInHandIsStored(): boolean {
    const level = codes.inHand();
    const measurement = codes.measurement();
    return (
      level !== null &&
      !(
        measurement?.levelId === level.id &&
        measurement.visit === ctx.arSessionGeneration
      )
    );
  }

  /**
   * The AR status line opened to its full length by a tap (2026-10-01).
   *
   * The live readout joins up to five sentences - the code's status, the
   * measuring readout, the setup hint, the tour and the zip size - and in
   * AR it sits ABOVE the controls: on a 360x640 phone with the code's
   * re-measure offered and an object selected it pushed the last control
   * below the first screen (ar-layout.spec.js). Clamped to two lines
   * (CSS, `data-clamped`) it costs two lines, the text itself unchanged -
   * a screen reader and every check on it read the whole - and a tap on it
   * (inside the panel, so no XR select) shows all of it. Choosing ONE
   * sentence instead would decide what the author does not need to read,
   * and the line's order already leads with what to act on. Each visit
   * starts clamped; the page is never clamped.
   */
  let statusExpanded = false;
  dom.status.addEventListener("click", () => {
    statusExpanded = !statusExpanded;
    renderAuthorReadout();
  });

  function renderAuthorReadout(): void {
    measuring.renderSizeOffer();
    if (!creator) return;
    // In AR the line is clamped to two lines, the whole of it a tap away
    // (see `statusExpanded`); on the page it is whole.
    dom.status.dataset["clamped"] =
      sessionLive() && !statusExpanded ? "true" : "false";
    placement.renderButtons();
    // A new fix re-judges the refusal line (§7m #8; the line only, never the
    // earlier objects' frame).
    settle.judgeOnNewFix();
    editing.render();
    // F11: the AR controls belong to the AR session. On the setup page they
    // were a row of greyed-out buttons under "AR not supported", which is
    // what the owner reported. The STATUS line stays either way - it is
    // where a refused entry explains itself, and a refusal means no session
    // ever starts (M3 review #4).
    dom.controls.hidden = !sessionLive();
    // Finish is NOT a camera control. It is reachable whenever there is
    // something to finish: a creator who measured, placed content and then
    // left AR could tap it on the page before this milestone, and F11 asked
    // for the greyed-out AR buttons to go, not for the finish to become
    // session-only (M3 milestone review #4). A failed finish keeps it too,
    // or its own "try again" would have nothing to try.
    dom.finishButton.hidden = !(
      sessionLive() ||
      ctx.finishError !== null ||
      finish.readiness() === "ready"
    );
    // The save cannot be forgotten (UI round 1, U2): after AR with changes
    // not finished, Finish says so; while a rebuilt file waits for its
    // save on a phone, Finish steps aside for it.
    const guard = guardInput();
    dom.finishButton.textContent = finishButtonText(guard);
    if (hideFinishForResult(guard)) dom.finishButton.hidden = true;
    finish.renderKeepScan();
    if (ctx.authorErrorText !== null) {
      dom.status.textContent = ctx.authorErrorText;
      return;
    }
    // The finish step owns the line while it runs and after it failed
    // (M3 review #1/#3): store dispatches keep arriving during the rebuild
    // (GPS fixes, detections) and used to overwrite both.
    if (ctx.finishing) {
      dom.status.textContent = ctx.finishProgress;
      dom.finishButton.disabled = true;
      return;
    }
    if (ctx.finishError !== null) {
      dom.status.textContent = ctx.finishError;
      dom.finishButton.disabled = false;
      return;
    }
    const readiness = finish.readiness();
    // Not while a measurement is in flight: the level it lands may be the
    // one the zip should carry.
    dom.finishButton.disabled = !finish.canStart();
    // Everything above this line is a message about something that
    // happened - an error, a rebuild - and is shown whenever it is true.
    // Below is the LIVE measuring readout, which describes a camera: "hold
    // the phone on the printed code so it fills the screen" on a desktop
    // page with no session running is an instruction for a situation the
    // creator is not in.
    if (!sessionLive()) {
      dom.status.textContent = ctx.placementNote ?? "";
      return;
    }
    // A placement's outcome (or a draft notice) stands until the next tap
    // (M4 review #3) AHEAD of the readout, never instead of it: in its
    // place it also locked Save, and on a device without OPFS the backup
    // notice fires at tour open, before any measuring - so Save never
    // unlocked (scan-to-open plan §5 #13).
    const lead =
      entryLead() +
      settle.refusalLead() +
      (ctx.placementNote === null ? "" : `${ctx.placementNote} · `);
    // evaluate, not last: a cache hit unless the detections changed - and
    // after a tracking restart the old frame's result must not stand
    // (milestone review of b4b #1).
    const fused =
      ctx.lastDetectedText === null
        ? null
        : (ctx.fusedPose?.evaluate(ctx.lastDetectedText) ?? null);
    const view =
      ctx.lastDetectedText === null
        ? null
        : measuring.outcome(ctx.lastDetectedText);
    const readout = authorStatusLine(
      ctx.lastDetectedText,
      fused,
      authorAlignmentInfo(),
      ctx.lastDetectedText !== null &&
        (ctx.printSizeCheck?.pending(ctx.lastDetectedText) ?? false),
      view?.ready ?? "measured",
    );
    // Once measured, the setup hint (what to do next) joins the live
    // measuring readout - the readout's gate wording (the fix count) stays
    // visible on a re-entry.
    const inHandId = codes.inHand()?.id ?? null;
    const hint = setupHint({
      measured: codes.inHand() !== null,
      tourOpen: ctx.session !== null,
      inTour:
        inHandId !== null && ctx.currentLevels?.has(inHandId)
          ? "this-code"
          : (ctx.currentLevels?.size ?? 0) > 0
            ? "other-codes"
            : "none",
      keptStored: levelInHandIsStored(),
    });
    const count = placement.countLine();
    // What is happening to the tour the code names (plan §9 #9), and which
    // tour is open (§9 #10) - derived each render, never a one-off note.
    const codeStatus = codeTour.status(ctx.lastDetectedText);
    const codeLine = codeTourLine(codeStatus);
    const tour = ctx.tourLabel === null ? "" : ` · Tour: ${ctx.tourLabel}`;
    dom.status.textContent =
      lead +
      (hint === "" ? readout.text : `${readout.text} · ${hint}`) +
      count +
      (codeLine === "" ? "" : ` · ${codeLine}`) +
      tour;
    // Measured on its own once the gate opens (UI round 1, U3).
    measuring.maybeMeasure(readout.canMint, view?.measure === true);
    const blocked = finishBlockedHint(readiness);
    if (blocked !== "") dom.status.textContent += ` · ${blocked}`;
    if (readiness === "ready" && ctx.session !== null) {
      dom.status.textContent += ` · ${archiveSizeNote(ctx.session.archive.size)}`;
    }
  }

  /** Placing a pin or a photo in AR (`creator-placement.ts`). */
  const placement = wireCreatorPlacement({
    ctx,
    arStore,
    arController,
    seams,
    codes,
    dom,
    alignmentPicks,
    draft,
    previews,
    alignmentInfo: () => authorAlignmentInfo(),
    sizeOf: (text) => measuring.sizeOf(text),
    settledVisit: (visit) => settle.record(visit),
    lateArrival: (visit, photo) => {
      settle.lateArrival(visit, photo);
    },
    render: () => {
      renderAuthorReadout();
    },
  });

  /** The code's measuring: the QR pipeline, the size offer, the automatic
   *  measurement and the codes seen (`creator-measuring.ts`). */
  const measuring = wireCreatorMeasuring({
    ctx,
    arStore,
    seams,
    dom,
    codes,
    wizard,
    codeTour,
    alignmentPicks,
    draft,
    sessionLive,
    alignmentInfo: () => authorAlignmentInfo(),
    placeEarlierObjects: () => {
      settle.placeEarlierObjects();
    },
    render: () => {
      renderAuthorReadout();
    },
  });

  /** The visit's settle, the refusal line, the visit log and the summary
   *  (`creator-settle.ts`). */
  const settle = wireCreatorSettle({
    ctx,
    arStore,
    seams,
    previews,
    codes,
    alignmentPicks,
    draft,
    visitLog,
    pageId,
    ...(deps.summary === undefined ? {} : { summary: deps.summary }),
    alignmentInfo: () => authorAlignmentInfo(),
    sizeOf: (text) => measuring.sizeOf(text),
  });

  /** What the save guard reads (`finish-guard.ts`). */
  function guardInput(): FinishGuardInput {
    return {
      sessionLive: sessionLive(),
      arAvailable: arController.getState().status !== "unsupported",
      placedCount: ctx.placedObjects.length,
      deletedCount: ctx.deletedObjectIds.length,
      codeCount: codes.toWrite().length,
      rebuilt:
        ctx.rebuiltZip === null
          ? null
          : { delivered: ctx.rebuiltZip.delivered === true },
      // A failed backup write is noted once; from then on the page cannot
      // promise the phone keeps the work (U2 milestone review #3).
      draftPersists: draft.persists(),
      finishFailed: ctx.finishError !== null,
    };
  }

  // The rebuilt zip's hand-off: the Finish's own save, the button's save
  // again, and the replace steps a save earns (`creator-handoff.ts`).
  const handoff = wireCreatorHandoff({
    ctx,
    seams,
    dom,
    render: () => {
      renderAuthorReadout();
    },
  });

  /** Finish: the rebuilt zip and what it changes (`creator-finish.ts`). */
  const finish = wireCreatorFinish({
    ctx,
    arStore,
    arController,
    wizard,
    codes,
    dom,
    measuring,
    settle,
    handoff,
    previews,
    draft,
    sessionLive,
    render: () => {
      renderAuthorReadout();
    },
  });

  return {
    codes,
    renderAuthorReadout,
    measuredCodeIds: () => codes.ids(),
    leaveNeedsConfirm: () => leaveNeedsConfirm(guardInput()),
    leaveQuestion: () => leaveQuestion(guardInput()),
    startAuthorPipeline: () => measuring.start(),
    beginAuthorVisit: () => {
      if (!creator) return;
      const scene = seams.getScene();
      if (scene === null) return;
      // Earlier visits' objects (plan §3.2): each keeps only its geo in this
      // visit, so they start in the plain frame at the scene root - placed
      // from geo, like the viewer's content - and move into the frame of
      // the code nearest them once this visit sees it (`placeEarlierObjects`,
      // M5b).
      alignmentPicks.reset();
      previews.beginVisit(scene);
      settle.placeEarlierObjects();
      editing.render();
      // The summary describes the visits up to the last Finish; this visit
      // makes it stale, and the next Finish shows it again (M3b).
      deps.summary?.hide();
    },
    endAuthorVisit: () => {
      if (!creator) return;
      settle.settleVisit("visit-end");
      measuring.endVisit();
      alignmentPicks.reset();
      codes.endVisit();
      settle.endVisit();
      statusExpanded = false;
      // What the previews were made from, and the earlier visits' frame.
      previews.endVisit();
      // An AR selection means nothing on the page.
      editing.reset();
    },
    resetFinishStep: () => {
      // The code in hand and the book belonged to the closing tour (M5
      // review #9). First, so nothing reset below reads them.
      codes.reset();
      // The download button, its line and the replace steps
      // (`creator-handoff.ts`).
      handoff.reset();
      // A "keep the walk" given for the closing tour is not given for the
      // next one (S1 milestone review #9).
      dom.keepScanInput.checked = false;
      // The rebuilt zip belonged to the tour that just closed, so the block
      // offering it goes away with it (M3 review #6) - otherwise a newly
      // opened tour shows a dead download button from the previous one.
      dom.finishBlock.hidden = true;
      // The offer, the draft namespace and its rejections belonged to the
      // tour that just closed.
      draft.reset();
      // The closing tour's previews, photo bytes and list (M4).
      previews.reset();
      editing.reset();
      // The summary and the visits belonged to the closing tour (M3b).
      deps.summary?.hide();
      visitLog.clear();
      // And the visit log's move boundaries and the code-spot decisions.
      settle.reset();
      measuring.reset();
    },
    presentDraftForTour: (tourUrl) => {
      if (!creator) return; // a visitor authors nothing
      // The manifest just settled: its objects join the previews and the
      // list (M4 - an author reopening a tour sees what is already there).
      previews.sync();
      editing.render();
      // Then its draft: offered, swept as spent, or started.
      draft.present(tourUrl);
    },
    selectInView: (tap) => {
      if (!creator || !sessionLive()) return;
      const targets = new Map(
        [...ctx.placedPreviews].map(([id, preview]) => [id, preview.root]),
      );
      editing.select(seams.pickObjectInView(targets, tap));
    },
  };
}
