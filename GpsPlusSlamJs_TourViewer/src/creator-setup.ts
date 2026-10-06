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

import { usablePhotoFrame } from "./photo-frame.js";
import {
  authoringFinished,
  codeMeasured,
  codeMoveAnswered,
  codeMovePrompted,
  objectPlaced,
  visitSettled,
} from "./tour-authoring-actions.js";
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
  MOVE_PROMPT_LABELS,
  movePromptText,
  rememberMoveAnswer,
  savedPoseKey,
  trackMovePrompt,
  type MoveAnswer,
  type MovePrompt,
  type MovePromptOnset,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";
import {
  measurementRole,
  planVisitSettle,
  storedGeo,
  settleAlignment,
  sightedCodeOffset,
  type CodeMeasurement,
  type CodeSighting,
  type CorrectionRefusal,
  type SettleBasis,
  type SettleChoice,
} from "./visit-settle.js";
import { tallyEvaluation, type FusedTallies } from "./qr-debug-readout.js";
import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import {
  qrLevelEntryName,
  qrLevelIdFromEntryName,
} from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  AUTHOR_DEFAULT_SIZE_M,
  MIN_ALIGNMENT_SAMPLES,
  mintQrLevel,
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
  clearQrMarker,
  recordQrDetection,
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
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { Group, Vector3, type Object3D } from "three";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";

import {
  mintPhoto,
  mintPin,
  newObjectId,
  renderTourObjects,
  type TourObjectRendererDeps,
} from "./content-placement.js";
import { odomNueFromWebXr } from "./visit-anchoring.js";
import { createVisitAlignmentTracker } from "./visit-alignment-picks.js";
import { createGpsExtentTracker } from "gps-plus-slam-app-framework/state/gps-extent-tracker";
import { createWalkedDistanceTracker } from "./walked-distance-tracker.js";
import { createKeyedChain } from "./keyed-chain.js";

import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  applyObjectChanges,
  contentEntriesToRemove,
  draftDeletionsNotYetHosted,
  draftHasUnhostedLevel,
  draftIsSpent,
  draftKeyForTour,
  draftObjectsNotYetHosted,
  objectContentKey,
  restoredText,
  restoreOfferText,
} from "./authoring-draft.js";
import {
  readDraft,
  removeDraftDeletion,
  removeDraftObject,
  writeDraftDeletion,
  writeDraftMeta,
  writeDraftObject,
  writeDraftVisit,
} from "./draft-persistence.js";
import { buildSummaryModel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import {
  buildVisitLogEntry,
  createVisitLog,
  newVisitId,
  type VisitLogEntry,
} from "./visit-log.js";
import {
  authoringObjects,
  upsertPlaced,
  wireObjectEditing,
  type AuthoringObject,
} from "./object-editing.js";
import type { ObjectListView } from "./object-list.js";
import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
  autoMeasureAllowed,
  type CodeReadyState,
  buildAuthorControllerConfig,
  FINISH_LABELS,
  finishBusyLabel,
  finishHandoffStatus,
  finishHelpVisibility,
  finishIdleLabel,
  finishBlockedHint,
  finishReadiness,
  MISSING_SIZE_MESSAGE,
  adoptedSizeNote,
  codeTourLine,
  correctionRefusedLine,
  driveReplaceSteps,
  entryHint,
  finishRoute,
  setupHint,
  type FinishRoute,
  type HandoffOutcome,
  sizeOfferView,
} from "./qr-author-mode.js";
import {
  downloadSafeName,
  nameSurvivesDownload,
} from "./content-disposition.js";
import { isDriveUrl } from "./open-errors.js";
import { createPrintSizeCheck } from "./print-size-check.js";
import type { ScanOpen } from "./scan-open.js";
import type { TourViewerSeams } from "./seams.js";
import { archiveFileName, type TourSession } from "./tour-session.js";
import {
  endQrPipeline,
  type ArController,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import type { Wizard } from "./wizard.js";

/** Why a measurement found no stable pose: the gate closed since the
 *  render, so it is tried again. */
const STEADY_LOST = "the code is not measured steadily";

/** What a measurement became (`measureCode`). */
type MeasureOutcome =
  | { readonly kind: "measured" | "kept" | "superseded" }
  | { readonly kind: "failed"; readonly reason: string };

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

  /** This tour's draft store, once a tour is open. */
  let draftStore: DraftFileStore | undefined;
  /**
   * The ids this tour's meta records as rejected, carried so that EVERY
   * meta write re-states them.
   *
   * A write that dropped the list would un-reject a draft whose files are
   * still on disk, which is the resurrection this design exists to
   * prevent. Set from the read (already pruned to ids that still have
   * files), reset when the tour closes, and never shared between tours.
   */
  let draftRejected: readonly string[] = [];
  /**
   * The draft's writes, queued so that each lands after the ones issued
   * before it: one queue per tour's META, one per OBJECT ID within a tour
   * (an id's record, photo and tombstone move together). Keys from
   * {@link metaChainKey} and {@link objectChainKey}.
   *
   * The meta: every write for a tour targets one key in one directory, and
   * the mint and finish ones are unawaited - so an earlier write landing
   * later would overwrite a newer one, including a rejection or a measured
   * level (PR #456 review).
   *
   * An object: a placement's write is unawaited too, so without the queue a
   * quick delete of it could land first and the placement come back on the
   * next open (M4 review #7; the M2c review's filed #7). Queued per id, an
   * operation that takes several steps - a claim of a rejected id, then
   * the write (see `writeForObject`) - is also never interleaved with
   * another operation on the same id.
   *
   * KEYED BY THE NAMESPACE KEY, not by the raw url - `draftKeyForTour`
   * trims, so two urls differing only in surrounding whitespace share one
   * directory and one meta key. Keyed by the raw url they would get two
   * independent chains, which is the same clobber through another door,
   * and it is reachable: the paste paths trim before opening, but the
   * `?qr=` boot passes the decoded payload through untouched, and that is
   * external data (PR #460 review). That makes
   * both properties structural rather than remembered: a tour that stalls
   * blocks only itself, and the ordering survives any interleaving of
   * opens. Two earlier shapes each held only half of that - one chain per
   * session blocked every tour behind a stall, and one chain plus "the
   * last tour seen" lost the ordering for A after B was opened in between
   * (PR #457 and #459 reviews).
   *
   * A key is dropped once its queue drains, so this holds only work in
   * flight.
   */
  const draftWrites = createKeyedChain();
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
  function metaChainKey(tourUrl: string): string {
    return JSON.stringify(["meta", draftKeyForTour(tourUrl)]);
  }
  function objectChainKey(tourUrl: string, id: string): string {
    return JSON.stringify(["object", draftKeyForTour(tourUrl), id]);
  }
  /** Each decoded code text's level id (`qrCodeId`, a hash - async), so a
   *  detection can be matched to the level in hand synchronously. */
  const codeIds = new Map<string, string>();
  /** The levels a Finish in this page wrote into the tour: saved, so a
   *  new code may take the hand from them (`codeOutcome`). */
  const finishedLevelIds = new Set<string>();
  /** Measurements in flight: Finish waits for them (`measureCode`). */
  let measuring = 0;
  /** The codes measured on their own in this visit, by visit and text:
   *  each once per visit (UI round 1, U3; plan review #1; `maybeMeasure`). */
  const autoMeasured = new Set<string>();
  /**
   * The running visit's per-moment alignments (owner decision D33): each
   * object placed or moved, the code measured and each sighting of the code
   * in hand is settled through the first mature alignment after its own
   * moment (`visit-alignment-picks.ts`), not the drifted end one. Fed on
   * every store change and before every noted moment; emptied per visit.
   * Nothing visible depends on it: the previews stay rigid as placed.
   */
  const alignmentPicks = createVisitAlignmentTracker();
  /** The session's GPS extent, the picks' maturity (40 m, D34). */
  const gpsExtent = createGpsExtentTracker();
  /** How far the author has walked, each event's stamp (R1, R3 of D33). */
  const walkedDistance = createWalkedDistanceTracker();
  /** What the picks last saw: the alignment and zero references and the
   *  fix count. */
  let pickedFrom: readonly [unknown, unknown, number] | null = null;

  /** Hand the picks the alignment as it stands now, when it changed. */
  function syncAlignmentPicks(): void {
    const state = arStore.getState();
    const alignmentMatrix = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const positions = selectGpsPositions(state);
    if (
      pickedFrom !== null &&
      pickedFrom[0] === alignmentMatrix &&
      pickedFrom[1] === zero &&
      pickedFrom[2] === positions.length
    ) {
      return;
    }
    pickedFrom = [alignmentMatrix, zero, positions.length];
    alignmentPicks.noteAlignment({
      alignmentMatrix,
      zero,
      gpsExtentM: gpsExtent.update(positions),
      walkedM: walkedDistance.update({
        gpsPositions: positions,
        odometryPositions: selectOdometryPositions(state),
      }),
      alignmentInfo: authorAlignmentInfo(),
    });
  }

  /** An object placed or moved in the running visit, now. */
  function notePlaced(id: string): void {
    syncAlignmentPicks();
    alignmentPicks.notePlacement(id, Date.now());
  }

  /** The visit's sighting of the code in hand changed. */
  function setVisitSighting(sighting: CodeSighting): void {
    ctx.visitCodeSighting = sighting;
    syncAlignmentPicks();
    alignmentPicks.noteSighting(sighting, Date.now());
  }

  /** A new visit's picks start empty. */
  function resetAlignmentPicks(): void {
    alignmentPicks.reset();
    pickedFrom = null;
  }
  /** The creator-facing url of the open tour, for later draft writes. */
  let draftTourUrl: string | null = null;
  /** What a draft is offering, until the creator answers. */
  let offered: {
    objects: readonly TourObject[];
    /** EVERY id the READ saw on disk - not just the unhosted ones the
     *  offer shows, and not just the ones that parsed. Rejecting a draft
     *  deletes what was there: objects the hosted zip already carries
     *  (filtered out of the offer but still files), and records `readDraft`
     *  refused - an older version's shape, or a photo whose bytes never
     *  landed. `clear` used to sweep those and nothing else does now. */
    storedIds: readonly string[];
    photos: ReadonlyMap<string, Blob>;
    /** The measured level and the size it was measured at - the other
     *  half of a lost walk, and what makes Finish reachable again. */
    level: { id: string; json: string } | null;
    sizeM: number;
    /** The deletions the hosted zip still carries (tombstones, plan
     *  §3.4, M4). */
    deleted: readonly string[];
    /** How `objects` splits into new placements and changes of objects
     *  the hosted zip carries - the offer's and the restore's words. */
    counts: { placed: number; changed: number };
    /** The draft's AR visits (M3b), for the summary after Finish. */
    visits: readonly VisitLogEntry[];
  } | null = null;
  /** Said once, not per placement: a creator mid-walk cannot act on it. */
  let warnedAboutPersistence = false;

  /**
   * Record something placed. Fire-and-forget on purpose: the placement
   * already happened in memory, and the draft is a safety net - a storage
   * problem must never fail the tap that made it.
   */
  /** Say once that the walk is not being backed up. A creator mid-session
   *  cannot act on it more often than that, and repeating it would push
   *  the measuring readout off the line. */
  function noteNoPersistence(): void {
    if (warnedAboutPersistence) return;
    warnedAboutPersistence = true;
    ctx.placementNote =
      "This device is not saving a backup copy - finish and download before closing the page.";
    renderAuthorReadout();
  }

  function recordPlacement(object: TourObject, blob?: Blob): void {
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (store === undefined || tourUrl === null) {
      // No draft namespace YET - no tour open, or its draft still opening -
      // is not a storage failure: the draft writes these when it opens
      // (scan-to-open plan §9 #5). Only an opened namespace without a store
      // is one.
      if (draftTourUrl !== null) noteNoPersistence();
      return;
    }
    void writeForObject(store, tourUrl, object.id, (s) =>
      writeDraftObject(s, object, blob),
    ).then((ok) => {
      if (!ok) noteNoPersistence();
    });
  }

  /**
   * Record one AR visit's log (M3b) in memory and in the draft, the way a
   * placement is recorded: fire-and-forget, in the id's queue, and before
   * the tour's draft is open it is written when it opens.
   */
  function recordVisit(entry: VisitLogEntry): void {
    visitLog.record(entry);
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (store === undefined || tourUrl === null) {
      if (draftTourUrl !== null) noteNoPersistence();
      return;
    }
    writeVisit(store, tourUrl, entry);
  }

  function writeVisit(
    store: DraftFileStore,
    tourUrl: string,
    entry: VisitLogEntry,
  ): void {
    void writeForObject(store, tourUrl, entry.visitId, (s) =>
      writeDraftVisit(s, entry),
    ).then((ok) => {
      if (!ok) noteNoPersistence();
    });
  }

  /**
   * Write something FOR object `id` - its record and bytes, or its
   * tombstone - in that id's queue, and only once the meta no longer
   * rejects the id (M4 review #1).
   *
   * THE META OUTRANKS AN OBJECT'S FILES (`readDraft`), so a change to an
   * id the meta rejects - a published tour reopened and its spent draft
   * swept, or "Delete it" - was hidden by the next read and swept by the
   * next open: the edit lost, or the deleted object back at the next
   * Finish. A change made now is newer than that rejection, so the id is
   * CLAIMED first, in this order, each step awaited:
   *   1. the rejected files are removed - once the meta stops rejecting
   *      the id, a stale file of the rejected draft must not be there to
   *      come back if the tab dies before step 3;
   *   2. the meta is rewritten without the id;
   *   3. the change is written.
   * A crash between any two steps leaves either the rejection or nothing
   * for the id, never the rejected draft's version. A refused meta write
   * still lets the change be written - it is newer than anything on disk -
   * and reports false, so the creator hears it is not backed up.
   *
   * Only while `store` is still the open tour's: `draftRejected` is that
   * tour's list.
   */
  function writeForObject(
    store: DraftFileStore,
    tourUrl: string,
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    return draftWrites.run(objectChainKey(tourUrl, id), async () => {
      let claimed = true;
      if (draftStore === store && draftRejected.includes(id)) {
        await removeDraftObject(store, id);
        draftRejected = draftRejected.filter((rejected) => rejected !== id);
        claimed = await recordMeta(tourUrl);
      }
      const wrote = await write(store);
      return claimed && wrote;
    });
  }

  /**
   * Remove a rejected id's files (a discard, a spent draft, an unfinished
   * earlier sweep) in that id's queue - and only if it is STILL rejected
   * when its turn comes: a change made since claimed it, and the file on
   * disk is that change now (`writeForObject`). Skipped too once another
   * tour is open: the next open of this one sweeps what the meta rejects.
   */
  function sweepRejected(
    store: DraftFileStore,
    tourUrl: string,
    id: string,
  ): void {
    void draftWrites.run(objectChainKey(tourUrl, id), async () => {
      if (draftStore === store && draftRejected.includes(id)) {
        await removeDraftObject(store, id);
      }
    });
  }

  /**
   * `ids` minus those the creator changed or deleted in this page (M4):
   * an edit of a hosted object keeps its id, so its file on disk is the
   * live change's now, and a sweep of an older draft must not take it.
   */
  function notLive(ids: readonly string[]): string[] {
    const live = new Set([
      ...ctx.placedObjects.map((p) => p.object.id),
      ...ctx.deletedObjectIds,
      // This page's visits (M3b): a read racing their first write may list
      // them, and they are this page's work, never the old draft's.
      ...visitLog.ids(),
    ]);
    return ids.filter((id) => !live.has(id));
  }

  /**
   * One draft write for the object list's actions (authoring plan
   * 2026-09-28-0953 §3.4, M4), AWAITED: the row shows its in-progress state
   * until this settles and then says whether the change reached the draft.
   * Before the tour's draft namespace exists there is nothing to write yet
   * and nothing failed - `presentDraftForTour` writes what was made
   * meanwhile - so that reads as landed.
   */
  function draftWrite(
    id: string,
    write: (store: DraftFileStore) => Promise<boolean>,
  ): Promise<boolean> {
    const store = draftStore;
    const tourUrl = draftTourUrl;
    if (tourUrl === null) return Promise.resolve(true);
    if (store === undefined) {
      noteNoPersistence();
      return Promise.resolve(false);
    }
    return writeForObject(store, tourUrl, id, write).catch(() => false);
  }

  /**
   * What the HOSTED zip currently stores for `levelId`, or null.
   *
   * The CONTENT, not just the presence of the id: a level's id is a hash of
   * the printed TEXT, so re-measuring the same poster writes a new
   * measurement under the same id. "The zip has a level with this id" is
   * therefore not evidence that it has THIS measurement, and deleting a
   * draft on that basis would throw away a re-measure - the most expensive
   * thing a creator does.
   */
  async function hostedLevelJson(levelId: string): Promise<string | null> {
    const session = ctx.session;
    if (session === null) return null;
    const entry = session.entries.find(
      (e) => qrLevelIdFromEntryName(e.filename) === levelId,
    );
    if (entry === undefined) return null;
    try {
      // Under the text cap, like every JSON the session reads (K0
      // milestone review R10): a level file is text on the JS heap.
      return await session.loadEntryText(entry.filename);
    } catch {
      // Unreadable is not proof of anything, and the safe direction is to
      // KEEP the draft.
      return null;
    }
  }

  /**
   * Record the tour, the printed size and the measured level.
   *
   * @param tourUrl the CREATOR-FACING url, which is what the store is keyed
   *   by. `ctx.session.archive.url` is normalised - for a Drive tour it is
   *   the proxy route - so writing that here would make the field disagree
   *   with the key and with its own documentation.
   */
  function recordMeta(tourUrl: string): Promise<boolean> {
    const store = draftStore;
    if (store === undefined) return Promise.resolve(false);
    // The size comes from the FIELD, not from `ctx.activeSizeM`: that is
    // only assigned at AR entry, so before the first session it still holds
    // the previous tour's value.
    const sizeM = Number(dom.sizeInput.value);
    const meta = {
      tourUrl,
      sizeM:
        Number.isFinite(sizeM) && sizeM > 0 ? sizeM : AUTHOR_DEFAULT_SIZE_M,
      level: ctx.mintedLevel,
      // Re-stated on every write, not only on the discard's: this file is
      // rewritten on each mint, each finish and each tour open, and one
      // that omitted the list would hand a rejected draft back on the next
      // read. (NOT on each placement - `recordPlacement` writes the object
      // file only and never reaches here; PR #456 review.)
      rejected: draftRejected,
      // The move prompt's answers (M5b), re-stated like the rejections.
      moveAnswers,
    };
    // Values captured NOW, write ordered by call within this tour. The
    // chain keeps one refused write from breaking the queue behind it.
    return draftWrites.run(metaChainKey(tourUrl), () =>
      writeDraftMeta(store, meta),
    );
  }

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
  /** The confirmation after adopting a size, until the code is stable again. */
  let adoptedNote: string | null = null;

  /** True while the AR session is up: what gates the controls and the live
   *  measuring readout. Read from the controller rather than tracked, so
   *  it cannot drift out of step with the session it describes. */
  function sessionLive(): boolean {
    return arSessionLive(arController.getState().status);
  }
  /** A preview sync found no zero yet (see `syncPreviews`): the store
   *  subscription runs it again once the zero lands. */
  let previewsWaitForZero = false;

  /** The object list and its actions (authoring plan 2026-09-28-0953
   *  §3.4, M4): edit, move and delete over the same in-memory state the
   *  placement fills, and the selection a tap in AR makes. */
  const editing = wireObjectEditing({
    ctx,
    arStore,
    view: dom.objectList,
    getArWorldGroup: () => seams.getArWorldGroup(),
    sessionLive,
    placementAllowed,
    notePlaced: (id) => {
      notePlaced(id);
    },
    settleInputs: () => ({
      mintedLevel: ctx.mintedLevel,
      measurement: ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
      gpsAccuracyM: authorAlignmentInfo().gpsAccuracyM,
    }),
    codes: storedCodes,
    saveDraftObject: (object, blob) =>
      draftWrite(object.id, (store) => writeDraftObject(store, object, blob)),
    saveDraftDeletion: (id) =>
      draftWrite(id, (store) => writeDraftDeletion(store, id)),
    forgetDraftDeletion: (id) =>
      draftWrite(id, (store) => removeDraftDeletion(store, id)),
    schedule: (fn, ms) => seams.schedule(fn, ms),
    forgetDraftObject: (id) => {
      const store = draftStore;
      const tourUrl = draftTourUrl;
      if (store === undefined || tourUrl === null) return Promise.resolve();
      // In the id's queue: a placement's write still in flight lands first,
      // and this removal after it (M4 review #7).
      return draftWrites.run(objectChainKey(tourUrl, id), () =>
        removeDraftObject(store, id),
      );
    },
    syncPreviews: () => {
      syncPreviews();
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
      syncAlignmentPicks();
      if (
        previewsWaitForZero &&
        selectZeroReference(arStore.getState()) !== null
      ) {
        syncPreviews();
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

  /**
   * Placement needs the alignment the mint gate needs (a measured code,
   * and this session's fixes solved in - the matrix alone is the identity
   * from the first fix, M4 review #2), a live session, and no rebuild in
   * flight. Re-checked at every tap, not only at render.
   */
  function placementAllowed(): boolean {
    const alignment = authorAlignmentInfo();
    return (
      ctx.mintedLevel !== null &&
      alignment.hasMatrix &&
      alignment.sampleCount >= MIN_ALIGNMENT_SAMPLES &&
      arController.getState().status === "running" &&
      !ctx.finishing
    );
  }

  function renderPlacementButtons(): void {
    const allowed = placementAllowed();
    dom.pinButton.disabled = !allowed;
    dom.photoButton.disabled = !allowed || ctx.latestFrame === null;
    if (!allowed) hideLabelInput();
  }

  function hideLabelInput(): void {
    dom.pinLabel.hidden = true;
    dom.pinSave.hidden = true;
    dom.pinCancel.hidden = true;
  }

  /** The print-size offer, or the confirmation after adopting one. */
  function renderSizeOffer(): void {
    const live = sessionLive();
    if (!live) adoptedNote = null;
    const offer = live ? (ctx.printSizeCheck?.offer() ?? null) : null;
    dom.sizeOfferUse.hidden = offer === null;
    dom.sizeOfferKeep.hidden = offer === null;
    if (offer !== null) {
      const view = sizeOfferView(offer.sizeM, ctx.activeSizeM);
      dom.sizeOffer.hidden = false;
      dom.sizeOfferText.textContent = view.text;
      dom.sizeOfferUse.textContent = view.useLabel;
      dom.sizeOfferKeep.textContent = view.keepLabel;
      return;
    }
    dom.sizeOffer.hidden = adoptedNote === null;
    dom.sizeOfferText.textContent = adoptedNote ?? "";
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

  // -------------------------------------------------------------------------
  // The moved-code prompt (authoring plan 2026-09-28-0953 §3.6 "Authoring
  // (D20 ask once)", milestone M5b; UI round 1, U3: "Did the poster move
  // here?"). WHEN it asks is `code-move-prompt.ts`'s; WHAT a "Yes" does is
  // the settle's (`code-position-settle.ts`): the new spot is saved at the
  // visit's end once the visit walked enough. This is the state and the DOM.
  // -------------------------------------------------------------------------

  /** Where the running offset beyond the prompt's trigger began (the
   *  tracker's state). */
  let moveOnset: MovePromptOnset | null = null;
  /** The prompt on screen. */
  let movePrompt: MovePrompt | null = null;
  /** The onset the shown prompt was logged for: one log per ask. */
  let movePromptLogged: MovePromptOnset | null = null;
  /** Every answer, per level and spot - read from the draft's meta at tour
   *  open, re-stated by every meta write. */
  let moveAnswers: RememberedMoveAnswer[] = [];
  /** The store's fix count at the last refusal re-evaluation: a new fix
   *  re-judges the latest sighting through the new alignment - the
   *  refusal only, never the earlier objects' frame (§7m #8). */
  let moveFixCount = -1;
  /** Codes moved to the poster's new spot (a "Yes, it moved" the settle
   *  applied), by the visit that moved them: the visit log's move boundary
   *  (§7j #12). An improved position of the same poster is no boundary:
   *  every visit saw that one poster. */
  const movedInVisit = new Map<string, number>();
  /** The latest "Yes, it moved", undoable while its visit runs - the settle
   *  at the visit's end applies it, and nothing before that has changed. */
  let undoable: { prompt: MovePrompt; visit: number } | null = null;
  /** What each settle since the last Finish decided for the code in hand:
   *  the result screen's line (`codePositionSentence`). */
  let codePositionOutcomes: CodePositionOutcome[] = [];
  /** The visit whose settle CHANGED the code's saved position, and the
   *  plan it applied - re-applied when a failed Finish settles it again. */
  let appliedCode: { visit: number; plan: CodePositionPlan } | null = null;

  /** The store's GPS fix count and the latest fix's own time. */
  function fixClock(): { count: number; lastMs: number | null } {
    const positions = selectGpsPositions(arStore.getState());
    const last = positions.at(-1) as { timestamp?: unknown } | undefined;
    const t = last?.timestamp;
    return {
      count: positions.length,
      lastMs: typeof t === "number" && Number.isFinite(t) ? t : null,
    };
  }

  /**
   * Re-run the tracker on the latest sighting's offset (its own trigger,
   * D26), re-judge the refusal for the panel line when a fix landed since
   * the last look, and log a new ask once.
   */
  function updateMovePrompt(): void {
    const level = ctx.mintedLevel;
    const clock = fixClock();
    if (sessionLive() && clock.count !== moveFixCount) {
      moveFixCount = clock.count;
      judgeRefusal();
    }
    const live = sessionLive() && !ctx.finishing && levelInHandIsStored();
    // Its own trigger (D26): the sighting's offset, whether or not the
    // settle refuses the correction.
    const offset =
      !live || level === null
        ? null
        : (() => {
            const state = arStore.getState();
            return sightedCodeOffset({
              visit: ctx.arSessionGeneration,
              alignment: selectAlignmentMatrix(state),
              zero: selectZeroReference(state),
              mintedLevel: level,
              measurement: ctx.codeMeasurement,
              sighting: ctx.visitCodeSighting,
            });
          })();
    const alignment = authorAlignmentInfo();
    const tracked = trackMovePrompt(moveOnset, {
      levelId: level?.id ?? null,
      offset,
      gateOpen:
        alignment.hasMatrix && alignment.sampleCount >= MIN_ALIGNMENT_SAMPLES,
      fixCount: clock.count,
      lastFixMs: clock.lastMs,
      savedKey: level === null ? null : savedPoseKey(level.json),
      answers: moveAnswers,
    });
    moveOnset = tracked.onset;
    movePrompt = tracked.prompt;
    if (movePrompt !== null && movePromptLogged !== moveOnset) {
      movePromptLogged = moveOnset;
      arStore.dispatch(
        codeMovePrompted({
          levelId: movePrompt.levelId,
          arVisitIndex: ctx.arSessionGeneration,
          atMs: Date.now(),
          horizontalM: movePrompt.horizontalM,
          northM: movePrompt.northM,
          eastM: movePrompt.eastM,
          yawDeg: movePrompt.yawDeg,
          maxHorizontalM: movePrompt.triggerM,
          fixes: movePrompt.fixes,
          seconds: movePrompt.seconds,
        }),
      );
    }
  }

  /** The prompt and the undo on screen. */
  function renderMovePrompt(): void {
    updateMovePrompt();
    dom.movePrompt.hidden = movePrompt === null;
    if (movePrompt !== null) {
      dom.movePromptText.textContent = movePromptText(movePrompt.horizontalM);
    }
    dom.movePromptUse.textContent = MOVE_PROMPT_LABELS.use;
    dom.movePromptCopy.textContent = MOVE_PROMPT_LABELS.secondCopy;
    dom.movePromptLater.textContent = MOVE_PROMPT_LABELS.notNow;
    dom.movePromptUse.disabled = false;
    // Only while the answer's visit runs and has not settled: the settle
    // applies it, and after that there is nothing left to take back.
    const live =
      undoable !== null &&
      undoable.visit === ctx.arSessionGeneration &&
      !visitSettles.has(undoable.visit) &&
      sessionLive();
    dom.moveUndo.hidden = !live || ctx.finishing;
    dom.moveUndoText.textContent = MOVE_PROMPT_LABELS.movedHint;
    dom.moveUndoButton.textContent = MOVE_PROMPT_LABELS.undo;
  }

  function logMoveAnswer(prompt: MovePrompt, answer: MoveAnswer): void {
    arStore.dispatch(
      codeMoveAnswered({
        levelId: prompt.levelId,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        answer,
        horizontalM: prompt.horizontalM,
        northM: prompt.northM,
        eastM: prompt.eastM,
        // Nothing is replaced at an answer since U3: the settle decides.
        replaced: false,
        error: null,
      }),
    );
  }

  /** Remember an answer for the prompt's spot, in memory and in the
   *  draft's meta (a refused write is the one backup notice). */
  function rememberAnswer(prompt: MovePrompt, answer: MoveAnswer): void {
    moveAnswers = rememberMoveAnswer(moveAnswers, {
      levelId: prompt.levelId,
      northM: prompt.northM,
      eastM: prompt.eastM,
      answer,
      savedKey: prompt.savedKey,
    });
    if (draftTourUrl === null) return;
    void recordMeta(draftTourUrl).then((ok) => {
      if (!ok) noteNoPersistence();
    });
  }

  for (const [button, answer] of [
    [dom.movePromptUse, "moved"],
    [dom.movePromptCopy, "second-copy"],
    [dom.movePromptLater, "not-now"],
  ] as const) {
    button.addEventListener("click", () => {
      const prompt = movePrompt;
      if (prompt === null) return;
      rememberAnswer(prompt, answer);
      logMoveAnswer(prompt, answer);
      movePrompt = null;
      if (answer === "moved") {
        undoable = { prompt, visit: ctx.arSessionGeneration };
        ctx.placementNote = MOVE_PROMPT_LABELS.moved;
      }
      renderAuthorReadout();
    });
  }

  /** Undo a "Yes, it moved" before its visit settles: the spot is answered
   *  "Not now" instead (the newest answer for a spot is the one that
   *  counts), so the prompt does not ask again at once. */
  dom.moveUndoButton.addEventListener("click", () => {
    const u = undoable;
    if (u === null || ctx.finishing || visitSettles.has(u.visit)) return;
    undoable = null;
    rememberAnswer(u.prompt, "not-now");
    logMoveAnswer(u.prompt, "not-now");
    ctx.placementNote = MOVE_PROMPT_LABELS.undone;
    renderAuthorReadout();
  });

  function renderAuthorReadout(): void {
    renderSizeOffer();
    if (!creator) return;
    // In AR the line is clamped to two lines, the whole of it a tap away
    // (see `statusExpanded`); on the page it is whole.
    dom.status.dataset["clamped"] =
      sessionLive() && !statusExpanded ? "true" : "false";
    renderPlacementButtons();
    renderMovePrompt();
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
    dom.finishButton.disabled = readiness !== "ready" || measuring > 0;
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
      ctx.lastDetectedText === null ? null : codeOutcome(ctx.lastDetectedText);
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
      hadLevel: (ctx.currentLevels?.size ?? 0) > 0,
      keptStored: levelInHandIsStored(),
    });
    const count = newlyPlaced() > 0 ? ` · ${placed(newlyPlaced())}` : "";
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
    maybeMeasure(readout.canMint, view?.measure === true);
    const blocked = finishBlockedHint(readiness);
    if (blocked !== "") dom.status.textContent += ` · ${blocked}`;
    if (readiness === "ready" && ctx.session !== null) {
      dom.status.textContent += ` · ${archiveSizeNote(ctx.session.archive.size)}`;
    }
  }

  /**
   * Where a preview goes. An object placed in THIS visit is RIGID in AR
   * (decision D2): under the world group at its odometry pose, where GPS
   * re-solves move it together with the camera. Anything else has only its
   * geo and is placed from it in `fromGeo` - the earlier visits' frame, or
   * the scene root outside a visit (plan §3.2).
   */
  function previewFrame(
    placement: (typeof ctx.placedObjects)[number]["placement"],
    fromGeo: Object3D,
  ): Pick<TourObjectRendererDeps, "scene" | "poseOf"> {
    const group = seams.getArWorldGroup();
    if (
      placement === undefined ||
      placement.visit !== ctx.arSessionGeneration ||
      group === null
    ) {
      return { scene: fromGeo };
    }
    const { position, rotation } = placement.local;
    return {
      scene: group,
      poseOf: () => ({ positionNue: position, rotationNue: rotation }),
    };
  }

  /**
   * What each preview was rendered from, by object id (authoring plan
   * 2026-09-28-0953 §3.4, M4): its look and where its pose comes from. A
   * preview whose key no longer matches is replaced; one whose object is
   * gone (deleted, or its tour closed) is disposed. Emptied with the
   * previews at each visit's end - the next visit renders everything again.
   */
  const previewKeys = new Map<string, string>();
  /**
   * The bytes of photos a Finish took out of `placedObjects`: the hosted
   * zip does not carry them until the creator uploads the rebuilt one, so
   * their preview reads them from here. Emptied when the tour closes.
   */
  const finishedPhotoBlobs = new Map<string, Blob>();

  function previewKey(entry: AuthoringObject): string {
    const { object } = entry;
    const placement = entry.placed?.placement;
    const rigid =
      placement !== undefined && placement.visit === ctx.arSessionGeneration;
    return JSON.stringify([
      object.kind,
      object.kind === "pin" ? object.label : object.image,
      rigid ? placement.local : object.geo,
    ]);
  }

  /** Dispose every preview and forget what they were made from. */
  function clearPreviews(): void {
    previewKeys.clear();
    for (const preview of ctx.placedPreviews.values()) preview.dispose();
    ctx.placedPreviews.clear();
  }

  /**
   * Bring the previews in line with the tour's objects now - this device's
   * AND the hosted zip's (M4: an author reopening a tour used to see none
   * of what was already there), keyed by id. Incremental: an object whose
   * preview still matches is left alone, so each placement decodes only
   * its own photo and two placements cannot race each other's disposal
   * (M4 review #7 of the guided-setup plan).
   */
  function syncPreviews(): void {
    const scene = seams.getScene();
    if (!creator || scene === null) return;
    const desired = new Map(
      editing.objects().map((entry) => [entry.object.id, entry]),
    );
    dropStalePreviews(desired);
    const zero = selectZeroReference(arStore.getState());
    // Placed from geo, which needs the zero - and on the first visit of a
    // page load (a restored draft) the zero comes with the first GPS fix,
    // after the visit began. Rendered when it lands (M2c review #4).
    previewsWaitForZero = zero === null;
    if (zero === null) return;
    for (const entry of desired.values()) {
      if (!previewKeys.has(entry.object.id)) {
        renderPreview(entry, zero, earlierFrame ?? scene);
      }
    }
  }

  /** Dispose each preview whose object is gone or no longer looks or sits
   *  as it was rendered. */
  function dropStalePreviews(
    desired: ReadonlyMap<string, AuthoringObject>,
  ): void {
    for (const [id, key] of previewKeys) {
      const entry = desired.get(id);
      if (entry !== undefined && previewKey(entry) === key) continue;
      previewKeys.delete(id);
      ctx.placedPreviews.get(id)?.dispose();
      ctx.placedPreviews.delete(id);
    }
  }

  function renderPreview(
    entry: AuthoringObject,
    zero: LatLong,
    fromGeo: Object3D,
  ): void {
    const id = entry.object.id;
    const key = previewKey(entry);
    previewKeys.set(id, key);
    const generation = ctx.arSessionGeneration;
    const blob = entry.placed?.blob ?? finishedPhotoBlobs.get(id);
    const session = ctx.session;
    void renderTourObjects([entry.object], {
      ...previewFrame(entry.placed?.placement, fromGeo),
      zero,
      makeLabel: (text) => seams.createLabel(text),
      loadPhotoTexture: async (image) => {
        // This device's bytes first; a hosted photo's come from the zip,
        // through the session (it knows the folder the manifest sits in).
        if (blob !== undefined) return decodeFrameTexture(blob, 2);
        if (session === null) return null;
        // A tour image is measured before it is decoded (K4 review R2).
        return decodeFrameTexture(await session.loadContentEntry(image), 2, {
          maxPixels: TOUR_MAX_IMAGE_PIXELS,
        });
      },
    }).then(
      (rendered) => {
        // The session may have ended while the photo decoded, or the
        // object changed or went away meanwhile.
        if (
          generation !== ctx.arSessionGeneration ||
          previewKeys.get(id) !== key
        ) {
          rendered.dispose();
          return;
        }
        ctx.placedPreviews.get(id)?.dispose();
        ctx.placedPreviews.set(id, rendered);
      },
      () => {
        // A throwing label or plane: forget it, so a later sync may retry.
        if (previewKeys.get(id) === key) previewKeys.delete(id);
      },
    );
  }

  /** Objects placed on this device that the zip does not carry yet - an
   *  edit or a move of a hosted object is in `placedObjects` too (M4),
   *  but it was not "placed". */
  function newlyPlaced(): number {
    const hosted = new Set((ctx.tourManifest?.objects ?? []).map((o) => o.id));
    return ctx.placedObjects.filter((p) => !hosted.has(p.object.id)).length;
  }

  function placed(count: number): string {
    return count === 1 ? "1 object placed" : `${String(count)} objects placed`;
  }

  function note(text: string): void {
    ctx.placementNote = text;
    renderAuthorReadout();
  }

  /** The code in view as its last fused evaluation stood - read, never
   *  re-evaluated (an evaluation feeds the motion detector). */
  function codeInView() {
    const text = ctx.lastDetectedText;
    const fused = text === null ? null : (ctx.fusedPose?.last(text) ?? null);
    return text === null || fused === null
      ? null
      : { text, status: fused.status, pose: fused.pose };
  }

  /**
   * Record a placement into the troubleshooting recording, with the raw
   * inputs it was computed from (authoring recording plan 2026-09-28-0953,
   * M1a). Dispatched from the tap's own handler, never from inside another
   * dispatch, so its recorded position follows what it depends on. Without
   * a recording the store writes nothing, and no slice reads it.
   */
  function logPlacement(
    object: TourObject,
    raw: {
      reticleWorld?: Vector3;
      cameraOdomPose?: CapturedCameraFrame["cameraPose"];
    },
  ): void {
    const group = seams.getArWorldGroup();
    const reticleOdom =
      raw.reticleWorld === undefined || group === null
        ? null
        : group.worldToLocal(raw.reticleWorld.clone());
    arStore.dispatch(
      objectPlaced({
        object,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        reticleOdomNue:
          reticleOdom === null
            ? null
            : [reticleOdom.x, reticleOdom.y, reticleOdom.z],
        cameraOdomPose: raw.cameraOdomPose ?? null,
        alignmentMatrix: selectAlignmentMatrix(arStore.getState()),
        arWorldGroupMatrix:
          raw.reticleWorld === undefined || group === null
            ? null
            : group.matrixWorld.toArray(),
        code: codeInView(),
        codeSizeM: ctx.activeSizeM,
      }),
    );
  }

  /** Put a restored draft's objects and deletions back into the lists
   *  a live placement fills (see the restore below). */
  function restoreWork(waiting: NonNullable<typeof offered>): void {
    // Live work on the same id is newer than the draft's, and wins.
    const live = new Set([
      ...ctx.placedObjects.map((p) => p.object.id),
      ...ctx.deletedObjectIds,
    ]);
    for (const object of waiting.objects) {
      if (live.has(object.id)) continue;
      const blob = waiting.photos.get(object.id);
      ctx.placedObjects = upsertPlaced(
        ctx.placedObjects,
        blob === undefined ? { object } : { object, blob },
      );
    }
    // The deletions come back as the tombstones they are (plan §3.4).
    for (const id of waiting.deleted) {
      if (!live.has(id)) ctx.deletedObjectIds = [...ctx.deletedObjectIds, id];
    }
  }

  dom.draftRestore.addEventListener("click", () => {
    const waiting = offered;
    dom.draftOffer.hidden = true;
    offered = null;
    if (waiting === null) return;
    // Into the SAME list a live placement fills, so the finish needs no
    // second path: it writes these into the manifest exactly as it writes
    // anything else (an edit of a hosted object replaces it by id), and
    // the photo bytes as content entries. Live work on the same id is
    // newer than the draft's, and wins.
    restoreWork(waiting);
    // And the visits it measured (M3b): the summary after Finish combines
    // them with this page's.
    visitLog.restore(waiting.visits);
    // The measured level comes back too, and it is what unlocks Finish
    // without walking to the poster again. Only when the session has not
    // already measured one: a live measurement is newer than a draft.
    if (ctx.mintedLevel === null && waiting.level !== null) {
      ctx.mintedLevel = waiting.level;
    }
    // And the printed size, which the page rewrites from the framework
    // default on every load - so without this a re-entry would solve
    // against 16 cm for a poster printed at 20.
    if (Number.isFinite(waiting.sizeM) && waiting.sizeM > 0) {
      dom.sizeInput.value = String(waiting.sizeM);
      ctx.activeSizeM = waiting.sizeM;
    }
    // Render them, or the readout says "5 objects placed" over an empty
    // scene and the creator places them again - new ids, real duplicates
    // at the same spot in the published zip. The sync guards against a
    // dead scene, so this is safe outside a session too.
    syncPreviews();
    ctx.placementNote = restoredText(
      waiting.counts.placed,
      waiting.level !== null,
      {
        changed: waiting.counts.changed,
        deleted: waiting.deleted.length,
        visits: waiting.visits.length,
      },
    );
    renderAuthorReadout();
  });

  dom.draftDismiss.addEventListener("click", () => {
    // Declining is NOT deleting: a mis-tap must not become the loss this
    // whole feature exists to prevent. It is offered again next time.
    dom.draftOffer.hidden = true;
    offered = null;
  });

  dom.draftDiscard.addEventListener("click", () => {
    dom.draftOffer.hidden = true;
    // Captured BEFORE the offer is dropped: this is the list of what the
    // creator is rejecting, and it is the only thing that gets deleted.
    // Minus the ids changed live since (`notLive`, M4).
    const rejectedIds = notLive(offered?.storedIds ?? []);
    offered = null;
    const store = draftStore;
    if (store === undefined) return;
    // The one way a creator can throw a draft away deliberately - and the
    // escape hatch for a draft that would otherwise be offered forever.
    //
    // DELETE WHAT WAS REJECTED, and nothing else.
    //
    // This used to empty the whole namespace and then write back the meta
    // and every placement still live. That shape - delete everything, then
    // restore what should have stayed - is what produced FOUR silent
    // data-loss defects in this feature, because `clear` cannot tell the
    // rejected draft's files from ones written seconds earlier by a
    // creator who left the offer on screen and carried on working. Each
    // fix restored a little more, and each left a window in which the
    // survivors existed only in memory: a reload there lost them.
    //
    // There is no window now. The ids come from the offer, which is what
    // `readDraft` returned, so nothing this session wrote is ever a
    // candidate for deletion and nothing has to be put back.
    //
    // The meta is REWRITTEN rather than deleted, which also drops the
    // rejected level: `recordMeta` writes `ctx.mintedLevel`, so a creator
    // who measured before tapping keeps THIS session's measurement. That
    // is deliberate - "Delete it" rejects the OLD draft, not work done
    // afterwards - and it converges, because a later discard runs with no
    // minted level and writes a spent meta.
    //
    // THAT WRITE IS THE COMMIT POINT. It now carries the rejected ids, so
    // the next read refuses them whether or not their files are still
    // there, and the deletes below are housekeeping: they may fail, be
    // interrupted by the tab closing, or never run, and the draft stays
    // gone. Nothing is removed BEFORE the write lands, so the wait costs
    // nothing in the other direction either - a reload during it sees the
    // draft exactly as it was.
    const tourUrl = draftTourUrl;
    // Assigned together with `draftStore` and cleared with it, so this is
    // unreachable in practice. Returning rather than deleting is still the
    // right branch: with no meta write there is no commit point, and
    // deleting without one is the shape that lost work four times.
    if (tourUrl === null) return;
    // Assigned BEFORE the call, not after: a mint or finish issued in the
    // same tick must carry the rejection too, or its write would drop it.
    const wasRejected = draftRejected;
    draftRejected = rejectedIds;
    // ENQUEUED synchronously, with the values captured at the tap. The
    // chain guarantees ordering, not immediacy: the `put` itself is issued
    // from a `then`, so it is a microtask away at best (PR #457 review).
    const committed = recordMeta(tourUrl);
    void (async () => {
      if (!(await committed)) {
        // The rejection is not on disk, so it must not stay in memory: a
        // later mint or finish would write it and commit a discard this
        // branch is about to report as failed. Guarded on the tour still
        // being open, since a tour change has already reset the list from
        // its own read (PR #456 review).
        //
        // The second write is what covers a payload ALREADY queued behind
        // this one: that copied the list at its own call, so restoring the
        // variable cannot unbake it. Queued last, it lands last and puts
        // the old list back. Best-effort by nature - the store that just
        // refused may refuse this too - which is why the note below is not
        // conditional on it (PR #457 review).
        if (draftStore === store && draftTourUrl === tourUrl) {
          draftRejected = wasRejected;
          void recordMeta(tourUrl);
        }
        // ITS OWN NOTE, AND UNGATED. The first version of this branch
        // called `noteNoPersistence`, which is wrong twice over
        // (PR #456 review):
        //
        // - it fires ONCE per wiring. A quota wall is rarely a one-off, so
        //   an earlier failed placement burns the flag, the next pin tap
        //   clears the note from screen, and this branch then says
        //   NOTHING - which is exactly the silence it was added to close.
        // - its wording is about backups, not about the thing the creator
        //   just asked for. "Not saving a backup copy" does not tell them
        //   the draft they tapped Delete on is still there.
        //
        // A tap the creator made deserves an answer about that tap, every
        // time it fails.
        ctx.placementNote =
          "Could not delete the saved draft - it is still there, and will be offered again next time.";
        renderAuthorReadout();
        return;
      }
      for (const id of rejectedIds) sweepRejected(store, tourUrl, id);
    })();
  });

  dom.pinButton.addEventListener("click", () => {
    ctx.placementNote = null;
    if (!placementAllowed()) {
      renderAuthorReadout();
      return;
    }
    const reticle = ctx.reticle;
    if (reticle === null || !reticle.isVisible()) {
      note(
        "Point the phone at a surface until the ring appears, then tap again.",
      );
      return;
    }
    // The label input: an overlay input, not window.prompt (unavailable in
    // an XR session). The position is read at SAVE, not now - the creator
    // may still move the phone while typing.
    dom.pinLabel.hidden = false;
    dom.pinSave.hidden = false;
    dom.pinCancel.hidden = false;
    dom.pinLabel.focus();
    renderAuthorReadout();
  });

  dom.pinCancel.addEventListener("click", () => {
    dom.pinLabel.value = "";
    hideLabelInput();
    ctx.placementNote = null;
    renderAuthorReadout();
  });

  dom.pinSave.addEventListener("click", () => {
    const label = dom.pinLabel.value.trim();
    const reticle = ctx.reticle;
    if (!placementAllowed()) {
      hideLabelInput();
      renderAuthorReadout();
      return;
    }
    if (label === "") {
      note("Type the pin's text first.");
      return;
    }
    if (reticle === null || !reticle.isVisible()) {
      note(
        "No surface under the ring - point the phone at the spot and tap Save again.",
      );
      return;
    }
    const position = reticle.getWorldPosition(new Vector3());
    // The reticle's place in the world group's own frame (odometry-NUE):
    // what the rigid preview and the settle work from (plan §3.2, M2c).
    const group = seams.getArWorldGroup();
    const local = group === null ? null : group.worldToLocal(position.clone());
    const pin = mintPin({
      id: newObjectId(),
      label,
      worldNuePosition: { x: position.x, y: position.y, z: position.z },
      zero: selectZeroReference(arStore.getState()),
      nowIso: new Date().toISOString(),
    });
    if (pin === null) {
      note("No GPS fix yet - the pin cannot be placed.");
      return;
    }
    ctx.placedObjects.push(
      local === null
        ? { object: pin }
        : {
            object: pin,
            placement: {
              visit: ctx.arSessionGeneration,
              local: {
                position: [local.x, local.y, local.z],
                rotation: [0, 0, 0, 1],
              },
            },
          },
    );
    if (local !== null) notePlaced(pin.id);
    recordPlacement(pin);
    logPlacement(pin, { reticleWorld: position });
    dom.pinLabel.value = "";
    hideLabelInput();
    syncPreviews();
    note(`Pin "${label}" placed · ${placed(newlyPlaced())}.`);
  });

  dom.photoButton.addEventListener("click", () => {
    ctx.placementNote = null;
    const frame = usablePhotoFrame(
      ctx.latestFrame,
      performance.timeOrigin + performance.now(),
    );
    if (!placementAllowed() || frame === null) {
      note("No camera frame yet - try again in a moment.");
      return;
    }
    dom.photoButton.disabled = true;
    note("Capturing…");
    // The pose of the frame being encoded, not the pose at tap time; the
    // frame is at most PHOTO_FRAME_MAX_AGE_MS old (QR perf plan M4).
    const { cameraPose } = frame;
    // The visit the frame's odometry belongs to, taken at the tap: the
    // encode is async and the session may end meanwhile.
    const visit = ctx.arSessionGeneration;
    // Its id now, so its pick opens at the capture (D33), not when the
    // encode lands.
    const photoId = newObjectId();
    notePlaced(photoId);
    seams.encodeFrameJpeg(frame.image).then(
      (jpeg) => {
        // A visit that settled while this encoded (its session ended, or a
        // Finish ran) has its alignment on record: minted through that, the
        // photo IS settled - and the store's alignment may already belong
        // to no visit at all (the teardown resets it).
        const settled = visitSettles.get(visit);
        const photo = mintPhoto({
          id: photoId,
          cameraPose,
          alignmentMatrix:
            settled === undefined
              ? selectAlignmentMatrix(arStore.getState())
              : // 16 finite numbers: `settleAlignment` checked them.
                (settled.alignment as unknown as Matrix4),
          zero: settled?.zero ?? selectZeroReference(arStore.getState()),
          imageWidth: jpeg.width,
          imageHeight: jpeg.height,
          nowIso: new Date().toISOString(),
        });
        if (photo === null) {
          note("No usable GPS alignment yet - the photo cannot be placed.");
          return;
        }
        ctx.placedObjects.push({
          object: photo,
          blob: jpeg.blob,
          // The capture pose is RAW WebXR: through the one conversion into
          // the world group's frame, never composed by hand (plan §3.2).
          placement: { visit, local: odomNueFromWebXr(cameraPose) },
        });
        recordPlacement(photo, jpeg.blob);
        logPlacement(photo, { cameraOdomPose: cameraPose });
        if (settled !== undefined) {
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
        }
        syncPreviews();
        // The plane sits at the capture spot, facing back at it: the
        // creator is standing on it and sees it once they step back.
        note(
          `Photo placed - step back a metre to see it · ${placed(newlyPlaced())}.`,
        );
      },
      (err: unknown) => {
        note(
          `Capturing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  });

  function startAuthorPipeline(): boolean {
    ctx.authorErrorText = null;
    // Validate BEFORE starting anything: a cleared number input yields 0, the
    // min attribute never fires outside a form, and the resulting RangeError
    // used to unwind into the generic error box - the surface the creator is
    // not looking at (PR #360 review).
    const parsedSize = Number(dom.sizeInput.value);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      ctx.authorErrorText = MISSING_SIZE_MESSAGE;
      // REVEAL, not open (M3 milestone review #2): the message lands in
      // step 4's status line, and openStep would collapse step 4 a task
      // later - taking the explanation with it and leaving a Start button
      // that does nothing. Both steps stay open: the reason in one, the
      // field that fixes it in the other.
      wizard.revealStep("print");
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
    // The code's FUSED pose (QR near-frontal pose plan §60), one source per
    // pipeline start (per AR session), at the size the author entered.
    // Its counts feed the ?debug=1 readout (plan §66).
    const sizeM = ctx.activeSizeM;
    const tallies: FusedTallies = new Map();
    const fusedPose = createFusedQrPoseSource({
      entriesOf: (text) => selectQrFusedEntries(arStore.getState(), text),
      optionsFor: () => ({ sizeM }),
      onEvaluated: (result, _ms, text) => {
        tallyEvaluation(tallies, text, result);
      },
    });
    ctx.fusedPose = fusedPose;
    ctx.fusedTallies = tallies;
    ctx.qrController = createQrTrackingController(
      buildAuthorControllerConfig(ctx.activeSizeM, {
        frontEnd,
        solvePose: (input) => seams.solveQrPose(input),
        getIntrinsics: (image) => seams.getIntrinsics(image),
        recordDetection: (event) => {
          ctx.authorErrorText = null; // a live detection supersedes a stale error
          ctx.lastDetectedText = event.text;
          arStore.dispatch(recordQrDetection(event));
          // Step 4's scan-to-open: the code names its tour (plan §9).
          codeTour.onDetection(event.text);
          // Evaluated after EVERY detection, not on render: the motion
          // detector counts detections, and the render path returns early
          // in several states (plan §61 #7). The readout and the mint read
          // this result.
          fusedPose.evaluate(event.text);
          const fused = fusedPose.last(event.text);
          noteSighting(event.text, fused);
          ctx.printSizeCheck?.onDetection(event.text, fused, ctx.activeSizeM);
          if (fused?.status === "stable") adoptedNote = null;
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

  /**
   * Adopt the measured print size (QR size consensus plan §11-§12): the size
   * field takes it, a position saved at the old size stops counting (a mint
   * hash still in flight lands on nothing), and measuring starts over at the
   * new size - the old detections were solved at the old one.
   */
  function adoptMeasuredSize(): void {
    const offer = ctx.printSizeCheck?.offer() ?? null;
    if (offer === null || !sessionLive()) return;
    const sizeM = Math.round(offer.sizeM * 1000) / 1000;
    ctx.printSizeCheck?.answer(offer.text, "adopted");
    dom.sizeInput.value = String(sizeM);
    ctx.mintGeneration += 1;
    ctx.mintedLevel = null;
    ctx.codeMeasurement = null;
    // The code is measured again at the new size.
    autoMeasured.clear();
    endQrPipeline(ctx);
    arStore.dispatch(clearQrMarker({ text: offer.text }));
    startAuthorPipeline();
    adoptedNote = adoptedSizeNote(sizeM);
    if (draftTourUrl !== null) void recordMeta(draftTourUrl);
    renderAuthorReadout();
  }
  dom.sizeOfferUse.addEventListener("click", adoptMeasuredSize);
  dom.sizeOfferKeep.addEventListener("click", () => {
    const offer = ctx.printSizeCheck?.offer() ?? null;
    if (offer === null) return;
    ctx.printSizeCheck?.answer(offer.text, "kept");
    renderAuthorReadout();
  });

  /**
   * The frame the earlier visits' objects are shown in during this AR visit
   * (plan §3.2 "Earlier visits' objects on re-entry"): at the scene root
   * with the identity while they can only be placed from geo, under the AR
   * world group with the corrected alignment's inverse once the code has
   * been seen - which puts each where the code says, rigid in AR, because
   * the corrected alignment does not depend on the visit's GPS alignment
   * (`visit-anchoring.ts`). Null outside a visit.
   */
  let earlierFrame: Group | null = null;
  /** The code correction this visit's latest sighting would make, when
   *  the plausibility bound refused it (M2c review #2): the panel says so
   *  until the visit ends or a sighting is accepted. */
  let liveRefusal: CorrectionRefusal | null = null;
  /** Where `earlierFrame` is attached. Tracked, not read from `parent`:
   *  the e2e fakes' scene nodes do not set it. */
  let earlierFrameUnderGroup = false;

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
    if (earlierFrame === null || seams.getScene() === null) return null;
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
   *  code puts it (see `earlierFrame`). Cheap: one matrix. */
  function placeEarlierObjects(): void {
    const choice = judgeRefusal();
    const frame = earlierFrame;
    const scene = seams.getScene();
    if (frame === null || scene === null) return;
    const group = seams.getArWorldGroup();
    if (choice?.basis === "code-corrected" && group !== null) {
      frame.matrix.fromArray(choice.alignment).invert();
      frame.matrixWorldNeedsUpdate = true;
      if (!earlierFrameUnderGroup) {
        scene.remove(frame);
        group.add(frame);
        earlierFrameUnderGroup = true;
      }
      return;
    }
    frame.matrix.identity();
    frame.matrixWorldNeedsUpdate = true;
    if (earlierFrameUnderGroup) {
      group?.remove(frame);
      scene.add(frame);
      earlierFrameUnderGroup = false;
    }
  }

  /** Texts whose level id is being derived (`qrCodeId` is async). */
  const identifying = new Set<string>();

  /**
   * The latest stable sighting in the running visit of EVERY code with a
   * stored pose - the level in hand or any level of the open tour - by
   * level id (M3a/M3b review #6). Only the visit log reads it: each becomes
   * that code's visit record, through the visit's plain alignment, so the
   * tour's other codes gather visits too. It never makes a code the one in
   * hand, and never corrects anything. Tagged with its visit, so a visit
   * that ended without a settle cannot leak into the next one's log.
   */
  const storedCodeSightings = new Map<
    string,
    { readonly visit: number; readonly sighting: CodeSighting }
  >();

  /** Whether `levelId` has a stored pose: in hand, or in the open tour. */
  function hasStoredPose(levelId: string): boolean {
    if (ctx.mintedLevel?.id === levelId) return true;
    const level = ctx.currentLevels?.get(levelId);
    return level?.qr.geo !== undefined;
  }

  /**
   * Keep the anchor code's latest STABLE pose in this visit (plan §3.2,
   * D10b; the entry hint §3.2a): the code whose level is in hand, or - with
   * none measured yet - any code, since that is the one about to be
   * measured. "Seen" is the fused pose's own `stable`, the gate the mint
   * uses: a merely detected code gives a single-frame pose whose yaw error
   * (several degrees) would swing every corrected note by a metre at 20 m.
   * Any code with a stored pose is also kept for the visit log
   * (`storedCodeSightings`), whichever code is in hand.
   */
  function noteSighting(
    text: string,
    fused: ReturnType<NonNullable<typeof ctx.fusedPose>["last"]>,
  ): void {
    if (fused?.status !== "stable" || fused.pose === null) return;
    const id = codeIds.get(text);
    if (id === undefined) {
      identify(text);
      return;
    }
    const sighting = { text, levelId: id, odomPose: fused.pose };
    if (hasStoredPose(id)) {
      storedCodeSightings.set(id, {
        visit: ctx.arSessionGeneration,
        sighting,
      });
    }
    if (ctx.mintedLevel !== null && ctx.mintedLevel.id !== id) return;
    setVisitSighting(sighting);
    placeEarlierObjects();
  }

  /** Derive a text's level id once, then take the sighting it waited for. */
  function identify(text: string): void {
    if (identifying.has(text)) return;
    identifying.add(text);
    const visit = ctx.arSessionGeneration;
    qrCodeId(text).then(
      (id) => {
        identifying.delete(text);
        codeIds.set(text, id);
        if (visit !== ctx.arSessionGeneration) return;
        noteSighting(text, ctx.fusedPose?.last(text) ?? null);
        renderAuthorReadout();
      },
      () => {
        // No Web Crypto (an insecure context): no sighting, no correction -
        // the plain visit alignment, as without a code in view.
        identifying.delete(text);
      },
    );
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
    if (undoable?.visit === visit) undoable = null;
    // The picks see the alignment as it stands at the end (the fallback).
    syncAlignmentPicks();
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const picks = alignmentPicks.picks();
    // The end alignment's extent: the D31 marker of a code re-minted
    // through it (R7 of D33).
    const alignmentGpsExtentM = gpsExtent.update(selectGpsPositions(state));
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
            : answerAtSpot(moveAnswers, {
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
    if (level !== null && moveAnswers.some((a) => a.answer === "moved")) {
      moveAnswers = moveAnswers.filter(
        (a) => !(a.answer === "moved" && a.levelId === level.id),
      );
      if (draftTourUrl !== null) void recordMeta(draftTourUrl);
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
      recordPlacement(object);
    }
    if (plan.level !== null) {
      ctx.mintedLevel = plan.level;
      if (draftTourUrl !== null) void recordMeta(draftTourUrl);
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
      recordPlacement(object);
      moved.push({ id: object.id, before, after });
    }
    if (moved.length > 0) syncPreviews();
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
    for (const seen of storedCodeSightings.values()) {
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
    recordVisit(entry);
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
      isSecondCopySpot(moveAnswers, {
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

  /**
   * The hosted zip's level file for `levelId`, when nothing of this code
   * is in hand (then the hand's level is the candidate); null too when
   * another tour was opened since the tap - that is not the tour the code
   * was read from.
   */
  async function hostedCandidate(
    levelId: string,
    inHand: { id: string } | null,
    openAtTap: number,
  ): Promise<string | null> {
    if (inHand?.id === levelId) return null;
    const json = await hostedLevelJson(levelId);
    return ctx.openGeneration === openAtTap ? json : null;
  }

  /**
   * Install what a measurement became (`measurementRole`, D10b): the new
   * level with its raw inputs, or the stored reference kept - the
   * measurement is then only this visit's sighting, and the panel says so.
   */
  function adoptMeasurement(
    role: ReturnType<typeof measurementRole>,
    priorMeasurement: CodeMeasurement | null,
    fresh: {
      level: { id: string; json: string };
      measurement: CodeMeasurement;
    },
  ): void {
    if (role.kept === "measurement") {
      ctx.mintedLevel = fresh.level;
      ctx.codeMeasurement = fresh.measurement;
      return;
    }
    ctx.mintedLevel = role.reference;
    ctx.codeMeasurement =
      priorMeasurement?.levelId === fresh.level.id ? priorMeasurement : null;
  }

  /**
   * Measure the code in view (on its own since U3: `maybeMeasure`). A measurement
   * of a code whose pose is already stored is a correction sighting for
   * this visit (`measurementRole`, D10b); whether this visit's view then
   * REPLACES the stored pose is decided at the visit's settle (UI round 1,
   * U3, `code-position-settle.ts`), never by a tap.
   *
   * Resolves with what it became: a no-op is `failed` with the reason.
   */
  function measureCode(): Promise<MeasureOutcome> {
    if (ctx.lastDetectedText === null) {
      return Promise.resolve({ kind: "failed", reason: "no code in view" });
    }
    const state = arStore.getState();
    // The readout's result, re-read so a tracking restart since then counts
    // (a cache hit otherwise; milestone review of b4b #1).
    const fused = ctx.fusedPose?.evaluate(ctx.lastDetectedText) ?? null;
    const stablePose = fused?.status === "stable" ? fused.pose : null;
    if (stablePose === null) {
      // The gate lost stability since render.
      return Promise.resolve({ kind: "failed", reason: STEADY_LOST });
    }
    const result = mintQrLevel({
      odomPose: stablePose,
      alignmentMatrix: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      alignment: authorAlignmentInfo(),
      sizeM: ctx.activeSizeM,
      nowIso: new Date().toISOString(),
    });
    if (!result.ok) {
      // In the panel (errorBox is a sibling of #ar-root and therefore
      // INVISIBLE during the AR session, milestone review #4), as a note
      // that stands until the next one.
      ctx.placementNote = result.error;
      return Promise.resolve({ kind: "failed", reason: result.error });
    }
    // Automatic since U3, so it changes no note and no failed Finish's
    // line (plan review #1): nothing the creator did asked for it.
    // The file name IS the code's identity, derived from the exact text this
    // poster carries - so the creator never matches a number by hand. The
    // hash is async; until it lands the finish button stays off (the level
    // is not addressable yet), and a second mint before it lands is
    // superseded by the newest.
    const mintedText = ctx.lastDetectedText;
    const mintGeneration = ++ctx.mintGeneration;
    // The raw inputs, captured at the tap: the level's id lands later.
    const measured = {
      text: mintedText,
      fusedOdomPose: stablePose,
      sizeM: ctx.activeSizeM,
      alignmentMatrix: selectAlignmentMatrix(state),
      alignment: authorAlignmentInfo(),
      levelJson: result.json,
      arVisitIndex: ctx.arSessionGeneration,
      atMs: Date.now(),
    };
    // The level in hand before this tap. When it - or the open tour's zip
    // - already stores THIS code's pose, that pose stays the reference and
    // the new measurement only corrects this visit (D10b, M2c review #5).
    const prior = { level: ctx.mintedLevel, measurement: ctx.codeMeasurement };
    const openAtTap = ctx.openGeneration;
    // The level in hand STAYS while the identity is derived (UI round 1,
    // U3): the measurement is automatic, and an emptied hand refused every
    // placement in that window. Finish waits for it instead (`measuring`).
    measuring += 1;
    dom.finishButton.disabled = true;
    return (async (): Promise<MeasureOutcome> => {
      let id: string;
      try {
        id = await qrCodeId(mintedText);
      } catch {
        if (mintGeneration !== ctx.mintGeneration) {
          return { kind: "superseded" };
        }
        // A failed identity must not lose the reference in hand.
        ctx.mintedLevel = prior.level;
        ctx.codeMeasurement = prior.measurement;
        ctx.placementNote =
          "Could not derive the code's identity on this device, so it was not measured.";
        return { kind: "failed", reason: "no code identity" };
      }
      if (mintGeneration !== ctx.mintGeneration) return { kind: "superseded" };
      const hostedJson = await hostedCandidate(id, prior.level, openAtTap);
      if (mintGeneration !== ctx.mintGeneration) return { kind: "superseded" };
      const role = measurementRole({
        levelId: id,
        visit: measured.arVisitIndex,
        inHand: prior.level,
        inHandMeasurement: prior.measurement,
        hostedJson,
      });
      adoptMeasurement(role, prior.measurement, {
        level: { id, json: result.json },
        // What the settle re-mints the code from at the visit's end, and
        // a sighting of it in this visit (plan §3.2, M2c).
        measurement: {
          levelId: id,
          text: mintedText,
          odomPose: stablePose,
          sizeM: measured.sizeM,
          visit: measured.arVisitIndex,
        },
      });
      codeIds.set(mintedText, id);
      if (measured.arVisitIndex === ctx.arSessionGeneration) {
        setVisitSighting({
          text: mintedText,
          levelId: id,
          odomPose: stablePose,
        });
        // The code measured in this visit: its pick opens NOW, when the
        // level's identity has resolved (milliseconds, at most seconds after
        // the tap), at the alignment current now; `atMs` stays the tap's.
        if (role.kept === "measurement") {
          syncAlignmentPicks();
          alignmentPicks.noteMeasurement(measured.atMs);
        }
        placeEarlierObjects();
      }
      ctx.mintedLevelTour = {
        levelId: id,
        tourUrl: codeTour.tourOf(mintedText),
      };
      arStore.dispatch(
        codeMeasured({
          levelId: id,
          ...measured,
          kept: role.kept,
        }),
      );
      if (draftTourUrl !== null) {
        void recordMeta(draftTourUrl).catch(() => false);
      }
      return { kind: role.kept === "measurement" ? "measured" : "kept" };
    })().finally(() => {
      measuring -= 1;
      renderAuthorReadout();
    });
  }

  /**
   * What becomes of the code in view once the gate is open (UI round 1,
   * U3: no "Save the measured position" button), and whether to measure it
   * now - one classification for the panel's line and the measurement, so
   * the line never claims a measurement that does not happen:
   * - the code in hand: `measured`;
   * - a measurement in flight, or a code still being read: `measuring`;
   * - with a code in hand, another STORED code (or one not identified
   *   yet): `seen` - it stays a sighting for the visit log (M3a/M3b review
   *   #6); taking it in hand would change the code this visit's objects
   *   are corrected through. Only a code with no saved position yet (a new
   *   code for the tour) is measured then;
   * - no tour open: `seen` (scan-to-open opens the code's tour first);
   * - a code the open tour may not take (`autoMeasureAllowed`: only its
   *   own, or the first code of a tour with none): `not-measured`;
   * - otherwise `measuring`, measured now unless this visit already tried
   *   (once per visit and code, plan review #1).
   */
  function codeOutcome(text: string): {
    ready: CodeReadyState;
    measure: boolean;
  } {
    const id = codeIds.get(text);
    const inHand = ctx.mintedLevel;
    if (id !== undefined && id === inHand?.id) {
      return { ready: "measured", measure: false };
    }
    if (measuring > 0) return { ready: "measuring", measure: false };
    if (inHand !== null && (id === undefined || hasStoredPose(id))) {
      return { ready: "seen", measure: false };
    }
    // A new code takes the hand only once the code in hand is saved in the
    // tour (hosted, or written by a Finish): each Finish writes the ONE code
    // in hand, so measuring past an unsaved one would silently drop it (U3
    // milestone review #7; before U3 that took a deliberate tap).
    if (
      inHand !== null &&
      !(ctx.currentLevels?.has(inHand.id) ?? false) &&
      !finishedLevelIds.has(inHand.id)
    ) {
      return { ready: "finish-first", measure: false };
    }
    const relation = codeTour.relation(text);
    if (relation === "resolving") return { ready: "measuring", measure: false };
    if (relation === "no-tour-open") return { ready: "seen", measure: false };
    const tourHasCodes = (ctx.currentLevels?.size ?? 0) > 0 || inHand !== null;
    if (!autoMeasureAllowed(relation, tourHasCodes)) {
      return { ready: "not-measured", measure: false };
    }
    const tried = autoMeasured.has(visitKeyOf(text));
    return { ready: tried ? "seen" : "measuring", measure: !tried };
  }

  /** `autoMeasured`'s key: the visit and the code's text. */
  function visitKeyOf(text: string): string {
    return `${String(ctx.arSessionGeneration)}|${text}`;
  }

  /**
   * Measure the code in view on its own when `codeOutcome` says so and the
   * gate is open: never during a Finish. A measurement that lost the gate
   * before it ran is tried again; one the mint or the identity refused is
   * not, until the next visit (its reason stands as the panel's note).
   */
  function maybeMeasure(canMint: boolean, measure: boolean): void {
    const text = ctx.lastDetectedText;
    if (!canMint || !measure || text === null) return;
    if (ctx.finishing || !sessionLive()) return;
    const key = visitKeyOf(text);
    autoMeasured.add(key);
    void measureCode().then((outcome) => {
      if (outcome.kind === "failed" && outcome.reason === STEADY_LOST) {
        autoMeasured.delete(key);
      }
    });
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
      draftPersists: !warnedAboutPersistence,
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
      measuring > 0 ||
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
        // A zip in the tolerated wrapped shape (`mytour/qr/<id>.json`,
        // `mytour/tour.json`) keeps its files where they are; adding a
        // second copy at the root would leave a stale duplicate on every
        // finish.
        const existingLevelPath = entryNames.find(
          (name) => qrLevelIdFromEntryName(name) === minted.id,
        );
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
        const entries = [
          {
            // A listed tour's new level goes inside the tour's folder, where
            // its list can name it (R7); others keep the root, as before.
            path:
              existingLevelPath ??
              `${listed === null ? "" : wrap}${qrLevelEntryName(minted.id)}`,
            data: minted.json,
          },
          { path: manifestPath, data: serializeTourManifest(written) },
          ...ctx.placedObjects.flatMap((p) =>
            p.object.kind === "photo" && p.blob !== undefined
              ? [{ path: `${wrap}${p.object.image}`, data: p.blob }]
              : [],
          ),
        ];
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
          drive()
            ? FINISH_LABELS.readyDrive(blob.size, ctx.rebuiltZip.filename)
            : FINISH_LABELS.ready(blob.size, route() === "share"),
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
        dom.downloadButton.textContent = idleLabel();
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
            finishedPhotoBlobs.set(p.object.id, p.blob);
          }
        }
        ctx.placedObjects = kept;
        // The deletions are applied: the manifest no longer carries them.
        // (Their tombstones stay in the draft until the hosted zip lacks
        // them too - the same proof the objects wait for.)
        ctx.deletedObjectIds = ctx.deletedObjectIds.filter(
          (id) => !deleted.includes(id),
        );
        syncPreviews();
        wroteZip = true;
        finishedLevelIds.add(minted.id);
        undoable = null;
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
        if (draftTourUrl !== null) void recordMeta(draftTourUrl);
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

  // The capability, asked ONCE at wire time. A button that says "Share"
  // where nothing can be shared is a lie, and one that says "Download" on
  // a phone that can share describes the wrong action. The ROUTE, though,
  // is per open tour (Drive replace plan §5 #3): a Drive tour saves even
  // where the device could share, so the labels are derived when shown.
  const canShare = seams.canShareZip();
  function drive(): boolean {
    return ctx.session !== null && isDriveUrl(ctx.session.archive.url);
  }
  function route(): FinishRoute {
    return finishRoute({ canShare, drive: drive() });
  }
  function idleLabel(): string {
    return finishIdleLabel(route() === "share", drive());
  }
  /** The replace instructions for the open tour's host: a Drive tour gets
   *  its own numbered steps with the zip's name (plan §2 decision 1). */
  function presentReplaceSteps(filename: string): void {
    const onDrive = drive();
    dom.replaceHelpGeneric.hidden = onDrive;
    dom.replaceHelpDrive.hidden = !onDrive;
    if (!onDrive) return;
    const hosted = ctx.session?.hostedFileName() ?? null;
    const { steps } = driveReplaceSteps(hosted ?? filename, hosted !== null);
    dom.replaceHelpDrive.textContent = steps
      .map((step, i) => `${String(i + 1)}. ${step}`)
      .join("\n");
  }
  dom.downloadButton.textContent = idleLabel();
  dom.downloadButton.addEventListener("click", () => {
    const rebuilt = ctx.rebuiltZip;
    if (rebuilt === null) return;
    // Async-UI rule: in-progress before the await, the durable end state
    // after; nothing delivered (a dismissed save picker, an abandoned
    // share sheet) keeps the button live.
    dom.downloadButton.disabled = true;
    dom.downloadButton.textContent = finishBusyLabel(route() === "share");
    // The share sheet can stay up for as long as the creator wants, and a
    // tour can be closed underneath it. Every other post-await path in this
    // module re-checks its generation; this one resolved straight into the
    // DOM, so a hand-off that settled after a close revealed the step-6
    // instructions on the CLOSED tour's panel - invisible at the time,
    // because the block that holds them is hidden, and then already on
    // screen the moment the next tour reached its finish (PR #440 review).
    const openGeneration = ctx.openGeneration;
    // A Drive tour SAVES, through its own seam - the share-or-download one
    // would open the share sheet on a phone (plan §2 decision 4, §5 #3).
    const handoff: Promise<HandoffOutcome> = drive()
      ? seams
          .downloadZip(rebuilt.blob, rebuilt.filename)
          .then((delivered) => ({ route: "download" as const, delivered }))
      : seams.shareOrDownloadZip(rebuilt.blob, rebuilt.filename);
    handoff.then(
      (outcome) => {
        const { delivered } = outcome;
        if (openGeneration !== ctx.openGeneration) return;
        // Saved: the guard stops asking, and Finish comes back (U2).
        if (delivered && ctx.rebuiltZip === rebuilt) {
          ctx.rebuiltZip = { ...rebuilt, delivered: true };
          renderAuthorReadout();
        }
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = idleLabel();
        dom.finishStatus.textContent = finishHandoffStatus(
          outcome,
          rebuilt.filename,
          drive(),
        );
        // The replace instructions were step 6; they are the last thing to
        // do and only once the file exists, so they appear once the zip has
        // actually gone somewhere (F10). The share route reveals one extra
        // sentence, because on that route the file is inside another app
        // rather than on this device, and the instruction above assumes it
        // can be found. The branch itself is `finishHelpVisibility`, a pure
        // function, because this one is otherwise reachable only by walking
        // an AR setup on a phone (M2 review #4).
        // REVEAL-ONLY. `finishHelpVisibility` says what this outcome
        // EARNS, not what the panel should look like: a creator who saved
        // the zip and then tapped again and dismissed the picker has still
        // saved it, and hiding the step-6 instructions they had already
        // earned would take the flow's last instruction off the screen at
        // the moment they most need it (PR #439 review #3). Only
        // `resetFinishStep`, on a tour close, hides them again.
        const help = finishHelpVisibility(outcome);
        if (help.replaceHelp) {
          presentReplaceSteps(rebuilt.filename);
          dom.replaceHelp.hidden = false;
        }
        // `shareNote` is a claim about WHICH hand-off happened, so unlike
        // `replaceHelp` it is not earned-and-kept: a share followed by a
        // save would otherwise leave "you shared it rather than saving it"
        // on screen beside a file that is now on disk, sending the creator
        // to look for it in an app. Only a hand-off that DELIVERED gets to
        // change it - a dismissed picker changed nothing (PR #440 review).
        if (delivered) dom.replaceHelpShare.hidden = !help.shareNote;
      },
      (err: unknown) => {
        if (openGeneration !== ctx.openGeneration) return;
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = idleLabel();
        dom.finishStatus.textContent = FINISH_LABELS.failed(
          err instanceof Error ? err.message : String(err),
        );
      },
    );
  });

  return {
    renderAuthorReadout,
    leaveNeedsConfirm: () => leaveNeedsConfirm(guardInput()),
    leaveQuestion: () => leaveQuestion(guardInput()),
    startAuthorPipeline,
    beginAuthorVisit: () => {
      if (!creator) return;
      const scene = seams.getScene();
      if (scene === null) return;
      // Earlier visits' objects (plan §3.2): each keeps only its geo in this
      // visit, so they go into one frame that starts at the scene root -
      // placed from geo, like the viewer's content - and moves under the
      // world group once the code is seen (`placeEarlierObjects`).
      resetAlignmentPicks();
      earlierFrame = new Group();
      earlierFrame.name = "earlier-visits";
      earlierFrame.matrixAutoUpdate = false;
      earlierFrameUnderGroup = false;
      scene.add(earlierFrame);
      // Everything is rendered afresh into this visit's frames - the
      // hosted zip's objects too (M4) - keyed by id.
      clearPreviews();
      syncPreviews();
      placeEarlierObjects();
      editing.render();
      // The summary describes the visits up to the last Finish; this visit
      // makes it stale, and the next Finish shows it again (M3b).
      deps.summary?.hide();
    },
    endAuthorVisit: () => {
      if (!creator) return;
      settleVisit("visit-end");
      autoMeasured.clear();
      resetAlignmentPicks();
      ctx.visitCodeSighting = null;
      storedCodeSightings.clear();
      liveRefusal = null;
      moveOnset = null;
      movePrompt = null;
      moveFixCount = -1;
      previewsWaitForZero = false;
      statusExpanded = false;
      // The previews are disposed by the entry's teardown right after this
      // (`placedPreviews`); what they were made from goes now, so the next
      // visit renders everything again. The frame itself is this module's.
      previewKeys.clear();
      earlierFrame?.removeFromParent();
      earlierFrame = null;
      // An AR selection means nothing on the page.
      editing.reset();
    },
    resetFinishStep: () => {
      dom.downloadButton.disabled = true;
      // A "keep the walk" given for the closing tour is not given for the
      // next one (S1 milestone review #9).
      dom.keepScanInput.checked = false;
      // The LABEL too, because the hand-off continuation is generation-
      // guarded and returns without restoring it for a tour that closed
      // underneath an open share sheet. Without this the next tour's
      // finish enables a button that still reads "Sharing…" (PR #441
      // review) - the guard moved the leak here rather than removing it.
      dom.downloadButton.textContent = idleLabel();
      dom.finishStatus.textContent = "";
      // The rebuilt zip belonged to the tour that just closed, so the block
      // offering it goes away with it (M3 review #6) - otherwise a newly
      // opened tour shows a dead download button from the previous one.
      dom.finishBlock.hidden = true;
      dom.replaceHelp.hidden = true;
      dom.replaceHelpShare.hidden = true;
      // The Drive steps belonged to the closing tour's host (plan §5 #13).
      dom.replaceHelpDrive.hidden = true;
      dom.replaceHelpGeneric.hidden = false;
      // The offer belonged to the tour that just closed.
      dom.draftOffer.hidden = true;
      offered = null;
      draftStore = undefined;
      draftTourUrl = null;
      draftRejected = [];
      // The closing tour's previews, photo bytes and list (M4).
      clearPreviews();
      finishedPhotoBlobs.clear();
      editing.reset();
      // The summary and the visits belonged to the closing tour (M3b).
      deps.summary?.hide();
      visitLog.clear();
      // And the move prompt's answers, boundaries and undo (M5b).
      moveAnswers = [];
      movedInVisit.clear();
      undoable = null;
      codePositionOutcomes = [];
      appliedCode = null;
      finishedLevelIds.clear();
      moveOnset = null;
      movePrompt = null;
    },
    presentDraftForTour: (tourUrl) => {
      if (!creator) return; // a visitor authors nothing
      // EVERY continuation below re-checks this. Without it, tour A's draft
      // resumes after the creator has opened tour B and then: writes B's
      // placements into A's namespace, offers A's objects for B's zip, and
      // deletes whichever namespace `draftStore` happens to point at. All
      // three are the data loss this milestone exists to prevent, and the
      // open path already guards every other continuation this way.
      const generation = ctx.openGeneration;
      const stale = (): boolean => generation !== ctx.openGeneration;
      // The manifest just settled: its objects join the previews and the
      // list (M4 - an author reopening a tour sees what is already there).
      syncPreviews();
      editing.render();
      void (async () => {
        const store = await openDraftStore(draftKeyForTour(tourUrl));
        if (stale()) return;
        draftStore = store;
        draftTourUrl = tourUrl;
        if (store === undefined) {
          // No persistence at all - a browser without OPFS, blocked site
          // data, a quota wall. The creator must hear it ONCE, here: this
          // is the path where they are least protected and least likely to
          // notice, because no write ever fails to tell them so.
          noteNoPersistence();
          return;
        }
        const stored = await readDraft(store);
        if (stale()) return;
        // Per-tour state: never carry the previous tour's rejections into
        // this one's meta.
        draftRejected = stored?.rejectedIds ?? [];
        // The move prompt's answers (M5b): read whether or not the draft
        // is restored - they describe the codes, not the draft's work - and
        // merged with any given before the draft opened.
        moveAnswers = [...(stored?.moveAnswers ?? []), ...moveAnswers].reduce<
          RememberedMoveAnswer[]
        >((list, answer) => rememberMoveAnswer(list, answer), []);
        // Deletes that did not finish last time. `rejectedIds` is exactly
        // the ids the meta rejects whose files are still on disk, so this
        // is the only thing that reclaims them - and it is safe to repeat,
        // because removing a key that is not there is not a failure.
        for (const id of draftRejected) sweepRejected(store, tourUrl, id);
        // Work made before this draft opened - with no tour open, or while
        // the manifest settled - was never written (scan-to-open plan §9
        // #5). AFTER the read on purpose: every branch below deletes only
        // what the read returned, so these cannot be swept as a spent or
        // rejected draft's.
        //
        // ALL of it, not only ids the draft has no file for: an edit or a
        // deletion of a hosted object keeps its id, so the draft may hold an
        // OLDER change of it, and skipping the id left that older change on
        // disk for a crash to bring back (M4 review #2). The live change is
        // newer than anything the read saw, and each write is queued behind
        // the sweep above for its id and claims it from the rejected list
        // first (`writeForObject`).
        for (const entry of ctx.placedObjects) {
          recordPlacement(entry.object, entry.blob);
        }
        // And this page's visits (M3b), for the same reason.
        for (const entry of visitLog.entries()) {
          writeVisit(store, tourUrl, entry);
        }
        for (const id of ctx.deletedObjectIds) {
          void writeForObject(store, tourUrl, id, (s) =>
            writeDraftDeletion(s, id),
          ).then((ok) => {
            if (!ok) noteNoPersistence();
          });
        }
        if (stored === undefined) {
          // No draft yet, but there will be: record what is already known,
          // so a crash before the first placement still leaves the tour and
          // the printed size behind.
          void recordMeta(tourUrl);
          return;
        }
        const waiting = draftObjectsNotYetHosted(
          stored.draft,
          ctx.tourManifest,
        );
        const waitingDeletions = draftDeletionsNotYetHosted(
          stored.draft,
          ctx.tourManifest,
        );
        const hostedLevel =
          stored.draft.level === null
            ? null
            : await hostedLevelJson(stored.draft.level.id);
        if (stale()) return;
        if (
          draftIsSpent(
            stored.draft,
            ctx.tourManifest,
            hostedLevel,
            stored.visits.length,
          )
        ) {
          // SPENT: the hosted zip carries every object AND the measurement,
          // and the draft holds no AR visit (the zip never carries those,
          // M3a/M3b review #5). That is the only proof the content reached
          // the file the world sees, and the only thing that deletes a
          // draft.
          // No re-open. It existed only because `clear` used to remove the
          // namespace directory and invalidate this handle; the store now
          // empties in place and stays usable. Re-opening would carry the
          // same failure forward: `openDraftStore` returns undefined on any
          // transient refusal, and assigning that over a WORKING store turns
          // persistence off for the rest of the tour, silently (PR #443
          // review).
          // Same rule as the discard: delete exactly what `readDraft`
          // returned. A spent draft is one the hosted zip already carries
          // in full, so every id here is safe to drop - and anything this
          // session placed during the awaits above is not in that list and
          // is therefore never touched. That reachability is not
          // hypothetical: `draftStore` is assigned BEFORE those awaits and
          // `hostedLevelJson` reads a zip entry, which is a network round
          // trip for a remote archive, while neither the mint button nor
          // `placementAllowed()` waits for the chain to settle.
          // `storedIds`, not `draft.objects`: the latter is what parsed,
          // and a record this read refused still has files. Nothing
          // reclaims those since `clear` lost its last caller.
          // Minus what the creator changed or deleted during the awaits
          // above (M4): an edit of a hosted object keeps its id, so unlike a
          // new placement it CAN be in this list, and its file is now the
          // live change's.
          const sweep = notLive(stored.storedIds);
          draftRejected = sweep;
          // Same commit point as the discard, for the same reason: an
          // interrupted sweep must not bring a spent draft back - and the
          // same notice when it does not land.
          if (!(await recordMeta(tourUrl))) {
            noteNoPersistence();
            return;
          }
          if (stale()) return;
          for (const id of sweep) sweepRejected(store, tourUrl, id);
          return;
        }
        const hasLevel = draftHasUnhostedLevel(stored.draft, hostedLevel);
        // New placements, and changes of objects the hosted zip carries.
        const hostedIds = new Set(
          (ctx.tourManifest?.objects ?? []).map((o) => o.id),
        );
        const changed = waiting.filter((o) => hostedIds.has(o.id)).length;
        const counts = { placed: waiting.length - changed, changed };
        // A level measured before this open is newer than the offered
        // draft's and would otherwise live only in memory; a mint after the
        // open would write it the same way.
        if (ctx.mintedLevel !== null) void recordMeta(tourUrl);
        offered = {
          objects: waiting,
          storedIds: stored.storedIds,
          photos: stored.photos,
          // ALWAYS handed back when the draft has one, even if the hosted
          // zip already stores the same measurement: the finish refuses to
          // run without `mintedLevel`, so withholding it would leave a
          // creator with restorable objects and no way to publish them.
          // `hasLevel` only decides the WORDS and whether the draft counts
          // as spent.
          level: stored.draft.level,
          sizeM: stored.draft.sizeM,
          deleted: waitingDeletions,
          counts,
          visits: stored.visits,
        };
        dom.draftOfferText.textContent = restoreOfferText(
          counts.placed,
          hasLevel,
          {
            changed: counts.changed,
            deleted: waitingDeletions.length,
            visits: stored.visits.length,
          },
        );
        dom.draftOffer.hidden = false;
        // The offer is outside the AR overlay, so a creator whose scan
        // opened the tour mid-session would not see it and would place the
        // same content again (milestone review #4).
        if (sessionLive()) {
          ctx.placementNote =
            "Unsaved work for this tour is on this device - restore it after leaving AR.";
          renderAuthorReadout();
        }
        // The offer lives inside step 4, which is usually COLLAPSED when a
        // tour opens (the wizard lands on the remembered step, or step 2).
        // Un-hiding an element inside a closed disclosure is zero pixels
        // and no signal, so the step is revealed - without collapsing
        // whatever the creator was reading.
        wizard.revealStep("measure");
      })();
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
