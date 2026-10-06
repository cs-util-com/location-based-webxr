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
 */

import { authoringFinished, visitSettled } from "./tour-authoring-actions.js";
import {
  codePositionSentence,
  type CodePositionOutcome,
} from "./code-position-rule.js";
import {
  planCodePosition,
  type CodePositionPlan,
} from "./code-position-settle.js";
import { moveWithCode, withinCodeReach } from "./move-with-code.js";
import {
  answerAtSpot,
  isSecondCopySpot,
  savedPoseKey,
} from "./code-move-prompt.js";
import {
  planVisitSettle,
  storedGeo,
  settleAlignment,
  sightedCodeOffset,
  type CodeSighting,
  type CorrectionRefusal,
  type SettleBasis,
  type SettleChoice,
} from "./visit-settle.js";

import {
  AUTHOR_DEFAULT_SIZE_M,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  serializeSignedTourManifest,
  signedManifestFilesOf,
  successorManifest,
  TourIntegrityError,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourCaptureSpots,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectQrFusedEntries,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import {
  ArchiveLimitError,
  rebuildZipWithEntries,
} from "gps-plus-slam-app-framework/storage";
import { bakeCaptureSpots } from "./capture-bake.js";
import {
  finishButtonText,
  hideFinishForResult,
  leaveNeedsConfirm,
  leaveQuestion,
  type FinishGuardInput,
} from "./finish-guard.js";
import { scanEntryNames } from "./tour-read-set.js";
import { finishEntries, type FinishEntry } from "./finish-entries.js";
import { wireCreatorHandoff } from "./creator-handoff.js";
import { wireCreatorDraft } from "./creator-draft.js";
import { wireCreatorPreviews } from "./creator-previews.js";
import { wireCreatorAlignmentPicks } from "./creator-alignment-picks.js";
import { wireCreatorMovePrompt } from "./creator-move-prompt.js";
import { wireCreatorPlacement } from "./creator-placement.js";
import { wireCreatorMeasuring } from "./creator-measuring.js";

import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";

import { newObjectId } from "./content-placement.js";

import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  applyObjectChanges,
  contentEntriesToRemove,
  objectContentKey,
} from "./authoring-draft.js";
import {
  removeDraftDeletion,
  writeDraftDeletion,
  writeDraftObject,
} from "./draft-persistence.js";
import { buildSummaryModel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import { buildVisitLogEntry, createVisitLog, newVisitId } from "./visit-log.js";
import {
  authoringObjects,
  upsertPlaced,
  wireObjectEditing,
} from "./object-editing.js";
import type { ObjectListView } from "./object-list.js";
import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
  FINISH_LABELS,
  finishBlockedHint,
  finishReadiness,
  codeTourLine,
  correctionRefusedLine,
  entryHint,
  setupHint,
} from "./qr-author-mode.js";
import {
  downloadSafeName,
  nameSurvivesDownload,
} from "./content-disposition.js";

import { createPrintSizeCheck } from "./print-size-check.js";
import type { ScanOpen } from "./scan-open.js";
import type { TourViewerSeams } from "./seams.js";
import { archiveFileName, type TourSession } from "./tour-session.js";
import {
  type ArController,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

/** What a visit settled through (`visitSettles` in `wireCreatorSetup`). */
interface VisitSettleRecord {
  readonly basis: SettleBasis;
  readonly alignment: number[];
  /** The store's alignment when the settle ran. */
  readonly visitAlignment: ReturnType<typeof selectAlignmentMatrix>;
  readonly zero: LatLong;
  /** The sighting a code correction used; null otherwise. */
  readonly sighting: CodeSighting | null;
  /** The level in hand when the settle ran, before any re-mint. */
  readonly referenceLevel: {
    readonly id: string;
    readonly json: string;
  } | null;
  /** A code correction the plausibility bound refused; null otherwise. */
  readonly refused: CorrectionRefusal | null;
}

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
  /** Step 4's tail: the rebuilt zip's status and download (F10). Outside
   *  `#ar-root` - the download is tapped after the session ends. */
  finishBlock: HTMLElement;
  /** The "put it back where the old one is" copy, revealed once the zip
   *  has actually been saved. Was step 6 until the flow rework. */
  replaceHelp: HTMLElement;
  /** The share route's extra sentence inside the replace instructions -
   *  hidden on the download route, where it would be noise. */
  replaceHelpShare: HTMLElement;
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
  /** The moved-code prompt (authoring plan 2026-09-28-0953 §3.6, D20,
   *  M5b; UI round 1, U3: "Did the poster move here?"): asked in AR once
   *  the code in hand has been seen far from its saved spot for long
   *  enough, with its three answers (`code-move-prompt.ts` decides when).
   *  The one question about the code's position left (the measure and
   *  replace buttons are gone, U3). */
  movePrompt: HTMLElement;
  movePromptText: HTMLElement;
  movePromptUse: HTMLButtonElement;
  movePromptCopy: HTMLButtonElement;
  movePromptLater: HTMLButtonElement;
  /** Undo of a "Yes, it moved" while its visit runs (before the settle
   *  applies it). */
  moveUndo: HTMLElement;
  moveUndoText: HTMLElement;
  moveUndoButton: HTMLButtonElement;
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface CreatorSetup {
  renderAuthorReadout: () => void;
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

/** A written entry's record for `manifest.json`: the SHA-256 and size of
 *  the bytes the zip will hold (a string is written as UTF-8). */
async function fileRecordOf(
  data: Blob | Uint8Array | string,
): Promise<TourFileRecord> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(await data.arrayBuffer());
  return { sha256: await sha256Hex(bytes), size: bytes.length };
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
  codeTour?: Pick<ScanOpen, "onDetection" | "status" | "tourOf" | "relation">;
  /** The summary after Finish (authoring plan 2026-09-28-0953 M3b,
   *  `summary-panel.ts`); none in the node tests that do not need it. */
  summary?: Pick<SummaryPanel, "show" | "hide">;
}): CreatorSetup {
  const { ctx, mode, arStore, arController, seams, wizard, dom } = deps;
  const codeTour: Pick<
    ScanOpen,
    "onDetection" | "status" | "tourOf" | "relation"
  > = deps.codeTour ?? {
    onDetection: () => undefined,
    status: () => ({ kind: "quiet" }),
    tourOf: () => null,
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
  /** The running visit's per-moment alignments (owner decision D33,
   *  `creator-alignment-picks.ts`). */
  const alignmentPicks = wireCreatorAlignmentPicks({
    ctx,
    arStore,
    alignmentInfo: () => authorAlignmentInfo(),
  });
  /** The tour's on-device draft (`creator-draft.ts`): the offer, the
   *  ordered writes, the rejections and the move prompt's answers. */
  const draft = wireCreatorDraft({
    ctx,
    dom,
    openDraftStore,
    visitLog,
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
      mintedLevel: ctx.mintedLevel,
      measurement: ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
      gpsAccuracyM: authorAlignmentInfo().gpsAccuracyM,
    }),
    codes: storedCodes,
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

  /** The stored codes' geo (the level in hand, then the open tour's other
   *  levels), for the list's "4 m from the code". */
  function storedCodes(): QrGeoPose[] {
    const out: QrGeoPose[] = [];
    const inHand = ctx.mintedLevel;
    const inHandGeo = inHand === null ? null : storedGeo(inHand.json);
    if (inHandGeo !== null) out.push(inHandGeo);
    for (const [id, level] of ctx.currentLevels ?? []) {
      if (id === inHand?.id || level.qr.geo === undefined) continue;
      out.push(level.qr.geo);
    }
    return out;
  }

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
    const sighting = ctx.visitCodeSighting;
    const hint = entryHint({
      tourOpen: ctx.session !== null,
      codeSeen:
        sighting !== null &&
        (ctx.mintedLevel === null || sighting.levelId === ctx.mintedLevel.id),
    });
    return hint === "" ? "" : `${hint} · `;
  }

  /** Whether the level in hand is a stored pose THIS visit did not measure
   *  (hosted, draft, or an earlier visit's): what a new measurement keeps. */
  function levelInHandIsStored(): boolean {
    const level = ctx.mintedLevel;
    const measurement = ctx.codeMeasurement;
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

  /** The moved-code prompt and its undo (`creator-move-prompt.ts`; UI
   *  round 1, U3: "Did the poster move here?"). */
  const movePrompt = wireCreatorMovePrompt({
    ctx,
    arStore,
    dom,
    draft,
    sessionLive,
    levelInHandIsStored: () => levelInHandIsStored(),
    judgeRefusal: () => {
      judgeRefusal();
    },
    settled: (visit) => visitSettles.has(visit),
    alignmentInfo: () => authorAlignmentInfo(),
    render: () => {
      renderAuthorReadout();
    },
  });
  /** Codes moved to the poster's new spot (a "Yes, it moved" the settle
   *  applied), by the visit that moved them: the visit log's move boundary
   *  (§7j #12). An improved position of the same poster is no boundary:
   *  every visit saw that one poster. */
  const movedInVisit = new Map<string, number>();
  /** What each settle since the last Finish decided for the code in hand:
   *  the result screen's line (`codePositionSentence`). */
  let codePositionOutcomes: CodePositionOutcome[] = [];
  /** The visit whose settle CHANGED the code's saved position, and the
   *  plan it applied - re-applied when a failed Finish settles it again. */
  let appliedCode: { visit: number; plan: CodePositionPlan } | null = null;

  function renderAuthorReadout(): void {
    measuring.renderSizeOffer();
    if (!creator) return;
    // In AR the line is clamped to two lines, the whole of it a tap away
    // (see `statusExpanded`); on the page it is whole.
    dom.status.dataset["clamped"] =
      sessionLive() && !statusExpanded ? "true" : "false";
    placement.renderButtons();
    movePrompt.render();
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
      finishReadiness({
        measured: ctx.mintedLevel !== null,
        tourOpen: ctx.session !== null,
        manifest: ctx.tourManifestStatus,
      }) === "ready"
    );
    // The save cannot be forgotten (UI round 1, U2): after AR with changes
    // not finished, Finish says so; while a rebuilt file waits for its
    // save on a phone, Finish steps aside for it.
    const guard = guardInput();
    dom.finishButton.textContent = finishButtonText(guard);
    if (hideFinishForResult(guard)) dom.finishButton.hidden = true;
    renderKeepScan();
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
    const readiness = finishReadiness({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      manifest: ctx.tourManifestStatus,
    });
    // Not while a measurement is in flight: the level it lands may be the
    // one the zip should carry.
    dom.finishButton.disabled = readiness !== "ready" || measuring.inFlight();
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
      refusalLead() +
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
    const hint = setupHint({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      inTour:
        ctx.mintedLevel !== null && ctx.currentLevels?.has(ctx.mintedLevel.id)
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
    // A code that is not measured is not "added to the open tour" either
    // (U3 milestone review #6): the ready line says why.
    const codeLine =
      view?.ready === "not-measured" &&
      (codeStatus.kind === "added-to-open-tour" ||
        codeStatus.kind === "unknown")
        ? ""
        : codeTourLine(codeStatus);
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
    dom,
    alignmentPicks,
    draft,
    previews,
    alignmentInfo: () => authorAlignmentInfo(),
    settledVisit: (visit) => visitSettles.get(visit),
    lateArrival: (visit, photo) => {
      const settled = visitSettles.get(visit);
      if (settled === undefined) return;
      logSettle(
        visit,
        "late-arrival",
        settled,
        [
          {
            object: photo,
            basis: settled.basis,
            alignment: settled.alignment,
            refused: settled.refused,
          },
        ],
        null,
        null,
      );
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
    wizard,
    codeTour,
    alignmentPicks,
    draft,
    sessionLive,
    alignmentInfo: () => authorAlignmentInfo(),
    placeEarlierObjects: () => {
      placeEarlierObjects();
    },
    render: () => {
      renderAuthorReadout();
    },
  });

  /** The code correction this visit's latest sighting would make, when
   *  the plausibility bound refused it (M2c review #2): the panel says so
   *  until the visit ends or a sighting is accepted. */
  let liveRefusal: CorrectionRefusal | null = null;

  /** A refused correction's line, as the live line's lead. */
  function refusalLead(): string {
    return liveRefusal === null
      ? ""
      : `${correctionRefusedLine(liveRefusal)} · `;
  }

  function refusalOf(
    choice: ReturnType<typeof settleAlignment>,
  ): CorrectionRefusal | null {
    return choice === null ? null : choice.refused;
  }

  /**
   * Re-judge this visit's latest sighting through the CURRENT alignment -
   * the settle's choice - and update `liveRefusal` from it, WITHOUT moving
   * the earlier objects: the move prompt calls this on every new fix, and
   * the objects' frame changes only in `placeEarlierObjects` (a sighting
   * of the code or an explicit action; §7m #8, the owner's drift
   * complaint). Null, with `liveRefusal` left as it was, outside a visit
   * (no frame) or before the scene exists.
   */
  function judgeRefusal(): ReturnType<typeof settleAlignment> {
    // Nothing to judge outside a visit - and nothing to read either.
    if (!previews.inVisit() || seams.getScene() === null) return null;
    const state = arStore.getState();
    const choice = settleAlignment({
      visit: ctx.arSessionGeneration,
      alignment: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      mintedLevel: ctx.mintedLevel,
      measurement: ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
      gpsAccuracyM: authorAlignmentInfo().gpsAccuracyM,
    });
    liveRefusal = refusalOf(choice);
    return choice;
  }

  /** Move the earlier visits' frame to where this visit's knowledge of the
   *  code puts it (`creator-previews.ts`). Cheap: one matrix. */
  function placeEarlierObjects(): void {
    previews.placeEarlier(judgeRefusal());
  }

  /**
   * What each settled visit settled through, by `arSessionGeneration`
   * (authoring plan 2026-09-28-0953 §3.2; M2c review #1 and #6). Two jobs:
   *
   * - A visit settles ONCE. A Finish tapped during a visit settles it at
   *   the tap, and the session end the Finish then causes finds it here and
   *   does nothing - a second settle would re-mint the code a moment after
   *   the zip was written. Keyed by the visit a settle actually RAN for:
   *   the generation read at any other moment is not that visit, because
   *   between visits it already names the NEXT one (a page-side Finish once
   *   marked the next visit settled that way, so it never settled).
   * - A photo of the visit that lands AFTER its settle (the encode is
   *   async) is minted through the same record when it lands: the visit's
   *   END choice. The visit's other objects went through their own picks
   *   (D33), so a late photo can differ from them by the drift between its
   *   capture and the visit's end.
   *
   * Recorded even for a visit with nothing to settle yet, for that photo.
   */
  const visitSettles = new Map<number, VisitSettleRecord>();

  /**
   * Settle the running AR visit (authoring plan 2026-09-28-0953 §3.2, M2c):
   * the code measured in it and every object placed in it get their geo
   * recomputed from its odometry pose (`visit-settle.ts` decides through
   * which alignment: each object's own pick, near a code event the
   * code's, D33 and its review R1 and R3), the
   * draft is rewritten so a reload keeps it, and the troubleshooting
   * recording gets a `tourAuthoring/settled` action.
   *
   * READS THE STORE, SO IT MUST RUN BEFORE THE SESSION'S TEARDOWN:
   * `teardownArSessionState` resets the alignment (`ar-entry.ts` calls
   * `endAuthorVisit` first; a test pins the order).
   */
  function settleVisit(trigger: "visit-end" | "finish"): void {
    const visit = ctx.arSessionGeneration;
    if (visitSettles.has(visit)) return;
    // The settle applies a "Yes, it moved" or not: after it there is
    // nothing to take back, even if a failed Finish settles again (U3
    // milestone review #4).
    movePrompt.settling(visit);
    // The picks see the alignment as it stands at the end (the fallback).
    alignmentPicks.sync();
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const picks = alignmentPicks.picks();
    // The end alignment's extent: the D31 marker of a code re-minted
    // through it (R7 of D33).
    const alignmentGpsExtentM = alignmentPicks.gpsExtent(
      selectGpsPositions(state),
    );
    const gpsAccuracyM = authorAlignmentInfo().gpsAccuracyM;
    // A STORED code this visit saw: keep its saved position, or replace it
    // with this visit's view of it (UI round 1, U3). A change is made by
    // handing the settle a measurement of the code, so it is re-minted as
    // if measured here - through the sighting's own pick.
    const level = ctx.mintedLevel;
    // A settle redone after a failed Finish re-applies the decision it
    // already made: the code is in hand at its new spot, the objects near
    // it have moved once, and the visit log keeps the saved pose (U3
    // milestone review #8).
    const reapplied =
      appliedCode !== null && appliedCode.visit === visit
        ? appliedCode.plan
        : null;
    const position =
      reapplied ??
      planCodePosition({
        visit,
        mintedLevel: level,
        measurement: ctx.codeMeasurement,
        sighting: ctx.visitCodeSighting,
        picks,
        alignment: visitAlignment,
        zero,
        endQuality: {
          extentM: alignmentGpsExtentM ?? null,
          accuracyM: gpsAccuracyM ?? null,
        },
        sizeM: ctx.activeSizeM,
        answerAt: (offset) =>
          level === null
            ? null
            : answerAtSpot(draft.moveAnswers(), {
                levelId: level.id,
                savedKey: savedPoseKey(level.json),
                offset,
              }),
      });
    const remint = position?.measurement ?? null;
    const input = {
      visit,
      placed: ctx.placedObjects,
      alignment: visitAlignment,
      zero,
      mintedLevel: level,
      measurement: remint ?? ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
      alignmentInfo: authorAlignmentInfo(),
      alignmentGpsExtentM,
      gpsAccuracyM,
      nowIso: new Date().toISOString(),
      // Each object at its own moment (D33); a re-minted stored code at its
      // sighting's.
      picks:
        remint === null || position === null
          ? picks
          : { ...picks, measurement: position.pick },
    };
    const choice = settleAlignment(input);
    // Pure, so planned before the log: the log marks the pose this settle
    // saves for the code, which is how the summary grades what visitors
    // get (M3a/M3b review #2).
    const plan =
      choice === null || zero === null ? null : planVisitSettle(input);
    const applied =
      position !== null &&
      remint !== null &&
      plan !== null &&
      plan.level !== null;
    // A real move is the visit log's boundary (§7j #12), set before the
    // log is written.
    if (applied && position.decision.kind === "move") {
      movedInVisit.set(position.levelId, visit);
    }
    if (applied) appliedCode = { visit, plan: position };
    if (position !== null && reapplied === null) {
      codePositionOutcomes.push({ decision: position.decision, applied });
    }
    // A "Yes, it moved" holds for its visit only: applied now, or asked
    // again next time - never applied later, out of Undo's reach (U3
    // milestone review #5).
    if (
      level !== null &&
      draft.moveAnswers().some((a) => a.answer === "moved")
    ) {
      draft.setMoveAnswers(
        draft
          .moveAnswers()
          .filter((a) => !(a.answer === "moved" && a.levelId === level.id)),
      );
      void draft.saveMeta();
    }
    logVisit(visit, state, choice?.alignment ?? null, plan?.level ?? null);
    if (choice === null || zero === null) return;
    const record: VisitSettleRecord = {
      basis: choice.basis,
      alignment: choice.alignment,
      visitAlignment,
      zero,
      sighting:
        choice.basis === "code-corrected" ? ctx.visitCodeSighting : null,
      referenceLevel: ctx.mintedLevel,
      refused: choice.refused,
    };
    visitSettles.set(visit, record);
    const decided =
      position === null
        ? undefined
        : {
            levelId: position.levelId,
            decision: position.decision,
            offsetM: position.offsetM,
            candidate: position.candidate,
            stored: position.stored,
            applied,
            movedWithCode: [] as {
              id: string;
              before: QrGeoPose;
              after: QrGeoPose;
            }[],
          };
    if (plan === null) {
      // Nothing to recompute, but a decision about the code is still the
      // recording's to keep.
      if (decided !== undefined) {
        logSettle(visit, trigger, record, [], null, null, decided);
      }
      return;
    }
    for (const { index, object } of plan.objects) {
      const entry = ctx.placedObjects[index];
      if (entry === undefined) continue;
      ctx.placedObjects[index] = { ...entry, object };
      // The record only: a photo's bytes did not change.
      draft.recordPlacement(object);
    }
    if (plan.level !== null) {
      ctx.mintedLevel = plan.level;
      void draft.saveMeta();
    }
    // An IMPROVED position takes the pins and photos near it along, so
    // they keep their place next to the poster (owner decision
    // 2026-10-06); a real move leaves them where they are (D19).
    const movedWithCode =
      applied &&
      reapplied === null &&
      position.decision.kind === "replace" &&
      level !== null
        ? moveEarlierWithCode(visit, level.json, plan.level.json)
        : [];
    logSettle(
      visit,
      trigger,
      record,
      plan.objects,
      plan.level,
      plan.levelAlignment,
      decided === undefined ? undefined : { ...decided, movedWithCode },
    );
  }

  /**
   * Move the earlier objects within reach of an improved code with it
   * (`move-with-code.ts`): every object of the tour this visit did not
   * place - the hosted ones, a restored draft's, an earlier visit's -
   * within 40 m of the code's OLD position, as an edit by id (the Finish
   * writes it like any move). A pin keeps its orientation: it has none
   * (`mintPin` writes the identity).
   */
  function moveEarlierWithCode(
    visit: number,
    beforeJson: string,
    afterJson: string,
  ): { id: string; before: QrGeoPose; after: QrGeoPose }[] {
    const from = storedGeo(beforeJson);
    const to = storedGeo(afterJson);
    if (from === null || to === null) return [];
    const moved: { id: string; before: QrGeoPose; after: QrGeoPose }[] = [];
    for (const entry of authoringObjects(
      ctx.tourManifest?.objects ?? [],
      ctx.placedObjects,
      ctx.deletedObjectIds,
    )) {
      if (entry.placed?.placement?.visit === visit) continue;
      const before = entry.object.geo;
      if (!withinCodeReach(before, from)) continue;
      const turned = moveWithCode(before, from, to);
      const after: QrGeoPose =
        entry.object.kind === "pin"
          ? { ...before, lat: turned.lat, lon: turned.lon, alt: turned.alt }
          : turned;
      const object = { ...entry.object, geo: after };
      ctx.placedObjects = upsertPlaced(ctx.placedObjects, {
        ...(entry.placed ?? {}),
        object,
      });
      draft.recordPlacement(object);
      moved.push({ id: object.id, before, after });
    }
    if (moved.length > 0) previews.sync();
    return moved;
  }

  /**
   * Copy the settling visit into the page-side log (M3b) while the store
   * still holds it: its walk, and each code it saw through ITS OWN
   * alignment (`visit-log.ts`). The fused path goes through
   * `pathAlignment` - what the visit's objects settled through - so the
   * pins sit on it. A visit settled again (a failed Finish) replaces its
   * entry. `savedLevel` is the level this settle re-mints from the visit's
   * measurement, if any: its pose is marked on the code, so the summary
   * can grade the stored pose by the visit it came from.
   */
  function logVisit(
    visit: number,
    state: ReturnType<typeof arStore.getState>,
    pathAlignment: readonly number[] | null,
    savedLevel: { id: string; json: string } | null,
  ): void {
    const codes: { levelId: string; odomPose: CodeSighting["odomPose"] }[] = [];
    const measurement = ctx.codeMeasurement;
    if (measurement !== null && measurement.visit === visit) {
      codes.push({
        levelId: measurement.levelId,
        odomPose: measurement.odomPose,
      });
    }
    // The tour's other stored codes this visit saw (M3a/M3b review #6),
    // then the code in hand last: the log keeps each code's LAST look.
    // Never a print answered "It's a second copy" (M5b review #11).
    for (const seen of measuring.storedSightings()) {
      if (seen.visit !== visit || isSecondCopy(state, seen.sighting)) {
        continue;
      }
      codes.push({
        levelId: seen.sighting.levelId,
        odomPose: seen.sighting.odomPose,
      });
    }
    const sighting = ctx.visitCodeSighting;
    if (sighting !== null && !isSecondCopy(state, sighting)) {
      codes.push({ levelId: sighting.levelId, odomPose: sighting.odomPose });
    }
    const savedGeo = savedLevel === null ? null : storedGeo(savedLevel.json);
    const entry = buildVisitLogEntry({
      visitId: newVisitId(pageId, visit),
      atMs: Date.now(),
      gpsPositions: selectGpsPositions(state),
      odometryPositions: selectOdometryPositions(state),
      alignment: selectAlignmentMatrix(state),
      pathAlignment,
      zero: selectZeroReference(state),
      storeAccuracyM: authorAlignmentInfo().gpsAccuracyM ?? null,
      codes,
      saved:
        savedLevel === null || savedGeo === null
          ? null
          : { levelId: savedLevel.id, geo: savedGeo },
      // The move boundary (M5b): the codes this visit moved to a new spot.
      moved: [...movedInVisit].flatMap(([levelId, v]) =>
        v === visit ? [levelId] : [],
      ),
    });
    // A visit with no fix and no code has nothing to show or to combine.
    if (entry.gps.length === 0 && entry.codes.length === 0) return;
    draft.recordVisit(entry);
  }

  /**
   * Whether `sighting` - of the code in hand - lies, through this visit's
   * plain alignment (the move prompt's view of it), at a spot answered
   * "It's a second copy" for that level and its saved pose (M5b review
   * #11). Only the level in hand: the prompt asks about no other code, so
   * no other code has such an answer.
   */
  function isSecondCopy(
    state: ReturnType<typeof arStore.getState>,
    sighting: CodeSighting,
  ): boolean {
    const level = ctx.mintedLevel;
    if (level === null || sighting.levelId !== level.id) return false;
    const offset = sightedCodeOffset({
      visit: ctx.arSessionGeneration,
      alignment: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      mintedLevel: level,
      measurement: ctx.codeMeasurement,
      sighting,
    });
    return (
      offset !== null &&
      isSecondCopySpot(draft.moveAnswers(), {
        levelId: level.id,
        savedKey: savedPoseKey(level.json),
        offset,
      })
    );
  }

  /**
   * The summary after Finish (M3b): every visit of this tour in the log,
   * each code's stored pose (the level in hand, then the tour's others),
   * and the objects the zip now carries. A summary that cannot be built
   * hides rather than failing the Finish that already succeeded.
   */
  function showSummary(): void {
    const summary = deps.summary;
    if (summary === undefined) return;
    try {
      summary.show(
        buildSummaryModel({
          visits: visitLog.entries(),
          references: codeReferences(),
          objects: ctx.tourManifest?.objects ?? [],
        }),
      );
    } catch {
      summary.hide();
    }
  }

  /** Each code's stored pose: the level in hand, then the tour's others. */
  function codeReferences(): { levelId: string; geo: QrGeoPose | null }[] {
    const inHand = ctx.mintedLevel;
    const references: { levelId: string; geo: QrGeoPose | null }[] =
      inHand === null
        ? []
        : [{ levelId: inHand.id, geo: storedGeo(inHand.json) }];
    for (const [id, level] of ctx.currentLevels ?? []) {
      if (id === inHand?.id) continue;
      references.push({ levelId: id, geo: level.qr.geo ?? null });
    }
    return references;
  }

  /** Forget the settle of `visit` if it is still the running visit, so
   *  its session end settles it again (with everything placed since). */
  function unsettleRunningVisit(visit: number | null): void {
    if (visit !== null && visit === ctx.arSessionGeneration) {
      visitSettles.delete(visit);
    }
  }

  /**
   * Log a settle into the troubleshooting recording: the visit's own, or
   * a late arrival's through its visit's record - so a replay finds every
   * settled geo, whenever it was settled.
   */
  function logSettle(
    visit: number,
    trigger: "visit-end" | "finish" | "late-arrival",
    record: VisitSettleRecord,
    objects: readonly ({ object: TourObject } & SettleChoice)[],
    level: { id: string; json: string } | null,
    levelAlignment: number[] | null,
    codePosition?: Parameters<typeof visitSettled>[0]["codePosition"],
  ): void {
    arStore.dispatch(
      visitSettled({
        ...(codePosition === undefined ? {} : { codePosition }),
        arVisitIndex: visit,
        atMs: Date.now(),
        trigger,
        basis: record.basis,
        visitAlignment: record.visitAlignment,
        usedAlignment: record.alignment,
        sighting: record.sighting,
        // Each object's own choice (D33): its alignment, and why.
        objects: objects.map(({ object, basis, alignment, refused }) => ({
          id: object.id,
          geo: object.geo,
          basis,
          usedAlignment: alignment,
          refusedCorrection: refused,
        })),
        levelAlignment,
        level,
        referenceLevel: record.referenceLevel,
        zero: record.zero,
        refusedCorrection: record.refused,
      }),
    );
  }

  /** What the save guard reads (`finish-guard.ts`). */
  function guardInput(): FinishGuardInput {
    return {
      sessionLive: sessionLive(),
      arAvailable: arController.getState().status !== "unsupported",
      placedCount: ctx.placedObjects.length,
      deletedCount: ctx.deletedObjectIds.length,
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

  /** The open tour's entries a visitor never reads, kept for the tour and
   *  manifest it was computed for: the readout renders on every dispatch,
   *  and a scan can hold thousands of entries. */
  let scanMemo: {
    session: TourSession;
    manifest: TourManifest | null;
    count: number;
  } | null = null;

  function renderKeepScan(): void {
    const current = ctx.session;
    if (current === null || ctx.tourManifestStatus !== "settled") {
      dom.keepScanRow.hidden = true;
      return;
    }
    if (
      scanMemo?.session !== current ||
      scanMemo.manifest !== ctx.tourManifest
    ) {
      scanMemo = {
        session: current,
        manifest: ctx.tourManifest,
        count: scanEntryNames(
          current.entries.map((e) => e.filename),
          ctx.tourManifest ?? createEmptyTourManifest(),
          current.manifestWrap,
        ).length,
      };
    }
    // Chosen on the page before AR (UI round 1, U2): hidden in a session,
    // since the Finish there reads it.
    // ... and while a rebuilt file waits: the next Finish rebuilds from it,
    // so a changed tick could not change it (U2 milestone review #2).
    dom.keepScanRow.hidden =
      sessionLive() || ctx.rebuiltZip !== null || scanMemo.count === 0;
  }

  /**
   * The recorded photos' spots for this Finish (scan-pass plan S1, S-D11):
   * the tour's own when it carries them, else baked from its recording,
   * else none - the tour then keeps the visitor's live join, as before S1,
   * and `notPlaced` says why for the creator. A recording that cannot be
   * read or joined never fails the Finish; a cap's refusal and a failed
   * integrity check do, as every read's does.
   */
  async function captureSpotsForFinish(
    current: TourSession,
    manifest: TourManifest,
  ): Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> {
    if (manifest.captureSpots !== undefined) {
      return { spots: manifest.captureSpots };
    }
    if (!current.hasRecording) return {};
    try {
      const bake = await bakeCaptureSpots(current, {
        shouldContinue: () => ctx.session === current,
        onChunk: (done, total) => {
          ctx.finishProgress = FINISH_LABELS.placingPhotos(done, total);
          renderAuthorReadout();
        },
      });
      return bake.kind === "baked"
        ? { spots: bake.spots }
        : { notPlaced: bake.reason };
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      if (err instanceof TourIntegrityError) throw err;
      return {
        notPlaced: `reading the recording failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  dom.finishButton.addEventListener("click", () => {
    const current = ctx.session;
    if (
      current === null ||
      ctx.mintedLevel === null ||
      measuring.inFlight() ||
      ctx.finishing ||
      ctx.tourManifestStatus !== "settled"
    ) {
      return;
    }
    // The visit still running is settled BEFORE anything is read for the
    // zip (plan §3.2): its objects and its code are written as settled, not
    // as tapped. A visit already over was settled at its end.
    const settledAtTap = sessionLive() ? ctx.arSessionGeneration : null;
    if (settledAtTap !== null) settleVisit("finish");
    const minted = ctx.mintedLevel;
    // Both guards for the continuation: the tour may be re-opened and the
    // AR session may end (and a new one start) while the rebuild runs; the
    // result must not land in a session or a tour it was not made for
    // (M3 review #2).
    const sessionGeneration = ctx.arSessionGeneration;
    ctx.finishing = true;
    ctx.finishError = null;
    ctx.placementNote = null;
    ctx.finishProgress = FINISH_LABELS.reading(current.archive.size);
    renderAuthorReadout();
    let wroteZip = false;
    void (async () => {
      try {
        // Assembled INSIDE the try (M4 review #1): a manifest the reader
        // rejects (a duplicate id) must fail the finish visibly, not throw
        // past `finishing = true` and freeze the panel.
        const entryNames = current.entries.map((e) => e.filename);
        // The session derived this prefix when it opened the zip; deriving
        // it a second time here is how the writer and the reader drifted
        // apart in the first place (PR #435 review).
        const wrap = current.manifestWrap;
        const manifestPath = `${wrap}${TOUR_MANIFEST_ENTRY}`;
        // The manifest: what the zip carried, with this device's records
        // REPLACING theirs by id (an edit or a move of a hosted object),
        // the new ones appended and the deleted ones filtered out (plan
        // §3.4, M4); the photos' bytes become content entries next to it.
        const manifest = ctx.tourManifest ?? createEmptyTourManifest();
        const photos = await captureSpotsForFinish(current, manifest);
        const captureSpots = photos.spots;
        if (ctx.session !== current) return; // re-opened meanwhile
        const deleted = [...ctx.deletedObjectIds];
        const written: TourManifest = {
          ...manifest,
          ...(captureSpots === undefined ? {} : { captureSpots }),
          // Never an id twice, and not for tidiness: the serializer REJECTS
          // duplicates, so one restored object that is already in the
          // manifest would make every finish throw - for as long as the
          // draft is restored, with no escape inside the app (M5 review #4).
          objects: applyObjectChanges(
            manifest.objects,
            ctx.placedObjects.map((p) => p.object),
            deleted,
          ),
        };
        // A deleted photo takes its content file with it. A signature over
        // the old list cannot cover the files this Finish rewrites, so it
        // goes - the output is unsigned until K2 signs on export. The list
        // itself CONTINUES for a listed tour (K1 milestone review R7, below);
        // anything else carrying the name is dropped with it.
        const [listName, ...signatureNames] = signedManifestFilesOf(entryNames);
        const listed =
          current.integrity.kind === "listed" && listName !== undefined
            ? { integrity: current.integrity, entry: listName }
            : null;
        // The published copy carries only what visitors read unless the
        // creator keeps the walk (S-D10): the walk, its unbaked frames, depth.
        // Never without baked spots (S1 milestone review #2): the walk is
        // then the only way a viewer can place the photos, and the hosted
        // file may be the creator's only copy of it.
        const scanLeftOut =
          dom.keepScanInput.checked || written.captureSpots === undefined
            ? []
            : scanEntryNames(entryNames, written, wrap);
        const removed = [
          ...contentEntriesToRemove(manifest.objects, deleted, wrap),
          ...scanLeftOut,
          ...signatureNames,
          ...(listed === null && listName !== undefined ? [listName] : []),
        ];
        // The level replaced where the zip holds it (also wrapped), a new
        // one inside a listed tour's folder or at the root
        // (`finish-entries.ts`), then the manifest and the photos.
        const entries: FinishEntry[] = finishEntries({
          entryNames,
          levels: [minted],
          wrap,
          listed: listed !== null,
          manifestPath,
          manifestJson: serializeTourManifest(written),
          photos: ctx.placedObjects.flatMap((p) =>
            p.object.kind === "photo" && p.blob !== undefined
              ? [{ image: p.object.image, blob: p.blob }]
              : [],
          ),
        });
        // The input is the NEWEST bytes for this tour: a previous finish's
        // rebuild when there is one, because it already carries that
        // batch's content entries - rebuilding from the hosted zip again
        // would write a manifest referencing photos the archive does not
        // contain (PR #435 review, the second half of the second-finish
        // bug). A tour close clears the rebuilt zip, so a re-opened tour
        // starts from what is actually hosted.
        const previous = ctx.rebuiltZip;
        const input = previous?.blob ?? (await current.readWholeArchive());
        if (ctx.session !== current) return; // re-opened meanwhile
        // The series' list, continued: the same series id, the next
        // version, and the hash of every file this zip will hold - the
        // kept ones from the list the input carries (checked at open and
        // as a whole by readWholeArchive, or written by the last Finish),
        // the written ones hashed here. Without it the series id's only
        // home was dropped (R7).
        let signedManifest: SignedTourManifest | undefined;
        if (listed !== null) {
          signedManifest = successorManifest(
            listed.integrity.manifest,
            listed.entry,
            {
              ...(previous?.signedManifest === undefined
                ? {}
                : { baseFiles: previous.signedManifest.files }),
              removed,
              written: new Map(
                await Promise.all(
                  entries.map(
                    async (e) => [e.path, await fileRecordOf(e.data)] as const,
                  ),
                ),
              ),
              createdAt: new Date().toISOString(),
            },
          );
          entries.push({
            path: listed.entry,
            data: serializeSignedTourManifest(signedManifest),
          });
        }
        const blob = await rebuildZipWithEntries(input, entries, {
          remove: removed,
          // The open archive is untrusted, so its rebuild inflates under
          // the session's own budget (K0 milestone review R1). A previous
          // Finish's zip is this page's own output, stored and bounded:
          // the rebuild sizes a budget for it itself.
          ...(previous === null ? { budget: current.budget } : {}),
          onProgress: (done, total) => {
            ctx.finishProgress = FINISH_LABELS.rebuilding(done, total);
            renderAuthorReadout();
          },
        });
        if (ctx.session !== current) return;
        const hosted = current.hostedFileName();
        ctx.rebuiltZip = {
          blob,
          ...(signedManifest === undefined ? {} : { signedManifest }),
          // The hosted file's own name first: Drive offers "Replace" only
          // for the same name (Drive replace plan §2 decision 3) - made safe
          // to save where a phone would change it, and the Drive steps then
          // ask for the same rename on Drive (§5 #7).
          filename:
            hosted === null
              ? archiveFileName(current.archive.url)
              : nameSurvivesDownload(hosted)
                ? hosted
                : downloadSafeName(hosted),
        };
        dom.finishStatus.textContent = [
          handoff.drive()
            ? FINISH_LABELS.readyDrive(blob.size, ctx.rebuiltZip.filename)
            : FINISH_LABELS.ready(blob.size, handoff.route() === "share"),
          ...(scanLeftOut.length === 0
            ? []
            : [FINISH_LABELS.scanLeftOut(scanLeftOut.length)]),
          ...(photos.notPlaced === undefined
            ? []
            : [FINISH_LABELS.photosNotPlaced(photos.notPlaced)]),
          // What the settles decided for the code (UI round 1, U3): no
          // button announces it any more.
          codePositionSentence(codePositionOutcomes),
        ]
          .filter((line) => line !== "")
          .join(" ");
        dom.downloadButton.textContent = handoff.idleLabel();
        dom.downloadButton.disabled = false;
        // The placed objects are in the zip now; the next finish (a
        // re-measure, a re-opened tour) must not append them again - and
        // the in-memory manifest has to ADVANCE to what was just written,
        // or a second finish in the same open tour would rebuild from the
        // pre-finish manifest and silently drop this batch (PR #435
        // review). `tourManifest` is otherwise only written at tour open.
        ctx.tourManifest = written;
        // Only what this zip carries leaves the list - by CONTENT, not id:
        // a photo that landed while the zip was rebuilt is in neither, and
        // waits for the next Finish (M2c review #6). A photo that leaves
        // keeps its bytes here for its preview: the hosted zip does not
        // have them until the creator uploads this one.
        const inZip = new Map(
          written.objects.map((o) => [o.id, objectContentKey(o)]),
        );
        const kept: typeof ctx.placedObjects = [];
        for (const p of ctx.placedObjects) {
          if (inZip.get(p.object.id) !== objectContentKey(p.object)) {
            kept.push(p);
          } else if (p.blob !== undefined) {
            previews.keepFinishedPhoto(p.object.id, p.blob);
          }
        }
        ctx.placedObjects = kept;
        // The deletions are applied: the manifest no longer carries them.
        // (Their tombstones stay in the draft until the hosted zip lacks
        // them too - the same proof the objects wait for.)
        ctx.deletedObjectIds = ctx.deletedObjectIds.filter(
          (id) => !deleted.includes(id),
        );
        previews.sync();
        wroteZip = true;
        measuring.noteFinished(minted.id);
        movePrompt.clearUndo();
        // The result screen said them; the next Finish reports its own.
        codePositionOutcomes = [];
        arStore.dispatch(
          authoringFinished({
            levelId: minted.id,
            manifest: written,
            atMs: Date.now(),
          }),
        );
        // NOT cleared here, and not on the download tap either: the zip is
        // only in the creator's hands, not yet in the file the world sees.
        // It is cleared when a re-opened tour turns out to carry these ids
        // (see presentDraftForTour) - the one signal that is proof.
        void draft.saveMeta();
        // The session ends so the creator lands on the page, where the
        // download button is a fresh tap (a download needs its own user
        // gesture, plan §2.4) - unless it already ended and another one
        // started, which is then not ours to end.
        if (sessionGeneration === ctx.arSessionGeneration) {
          await arController.disable();
          // A close during the session's end already hid the block; showing
          // it now would put the closed tour's button on the next page.
          if (ctx.session !== current) return;
        }
        // The download used to be step 5. It is the END of step 4 (F10):
        // the creator finished in AR, the session is closing, and what they
        // need next is one tap in the step they are already in. The reveal
        // happens AFTER the disable above, so the block cannot appear over
        // a session that is still compositing.
        wizard.openStep("measure");
        dom.finishBlock.hidden = false;
        // The summary of every visit (M3b), on the page with the download.
        showSummary();
        // The save is the one thing left (UI round 1, U2): brought into
        // view and focused, rather than the top of step 4.
        dom.downloadButton.scrollIntoView?.({ block: "center" });
        dom.downloadButton.focus?.();
      } catch (err) {
        if (ctx.session === current) {
          ctx.finishError = FINISH_LABELS.failed(
            err instanceof Error ? err.message : String(err),
          );
          // A file this Finish already made stays reachable with the
          // retry (U2 milestone review #4).
          if (ctx.rebuiltZip !== null) dom.finishBlock.hidden = false;
        }
      } finally {
        // A Finish that wrote no zip leaves its visit unsettled again while
        // it still runs: what the creator places after a failure must
        // settle with the rest of the visit at its end, through one
        // alignment - the tap's settle is redone then.
        if (!wroteZip) unsettleRunningVisit(settledAtTap);
        ctx.finishing = false;
        ctx.finishProgress = "";
        renderAuthorReadout();
      }
    })();
  });

  // The rebuilt zip's hand-off: download, share or Drive save, and the
  // replace steps it earns (`creator-handoff.ts`).
  const handoff = wireCreatorHandoff({
    ctx,
    seams,
    dom,
    render: () => {
      renderAuthorReadout();
    },
  });

  return {
    renderAuthorReadout,
    leaveNeedsConfirm: () => leaveNeedsConfirm(guardInput()),
    leaveQuestion: () => leaveQuestion(guardInput()),
    startAuthorPipeline: () => measuring.start(),
    beginAuthorVisit: () => {
      if (!creator) return;
      const scene = seams.getScene();
      if (scene === null) return;
      // Earlier visits' objects (plan §3.2): each keeps only its geo in this
      // visit, so they go into one frame that starts at the scene root -
      // placed from geo, like the viewer's content - and moves under the
      // world group once the code is seen (`placeEarlierObjects`).
      alignmentPicks.reset();
      previews.beginVisit(scene);
      placeEarlierObjects();
      editing.render();
      // The summary describes the visits up to the last Finish; this visit
      // makes it stale, and the next Finish shows it again (M3b).
      deps.summary?.hide();
    },
    endAuthorVisit: () => {
      if (!creator) return;
      settleVisit("visit-end");
      measuring.endVisit();
      alignmentPicks.reset();
      ctx.visitCodeSighting = null;
      liveRefusal = null;
      movePrompt.endVisit();
      statusExpanded = false;
      // What the previews were made from, and the earlier visits' frame.
      previews.endVisit();
      // An AR selection means nothing on the page.
      editing.reset();
    },
    resetFinishStep: () => {
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
      // The offer, the draft namespace, its rejections and the move
      // prompt's answers belonged to the tour that just closed.
      draft.reset();
      // The closing tour's previews, photo bytes and list (M4).
      previews.reset();
      editing.reset();
      // The summary and the visits belonged to the closing tour (M3b).
      deps.summary?.hide();
      visitLog.clear();
      // And the move prompt's boundaries and undo (M5b).
      movedInVisit.clear();
      movePrompt.reset();
      codePositionOutcomes = [];
      appliedCode = null;
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
