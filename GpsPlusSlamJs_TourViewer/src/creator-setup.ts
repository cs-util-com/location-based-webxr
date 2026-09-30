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
  objectPlaced,
  visitSettled,
} from "./tour-authoring-actions.js";
import {
  planVisitSettle,
  settleAlignment,
  type CodeSighting,
  type SettleBasis,
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
  createEmptyTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  clearQrMarker,
  recordQrDetection,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrFusedEntries,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
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

import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";

import {
  appendWithoutDuplicateIds,
  draftHasUnhostedLevel,
  draftIsSpent,
  draftKeyForTour,
  draftObjectsNotYetHosted,
  restoredText,
  restoreOfferText,
} from "./authoring-draft.js";
import {
  readDraft,
  removeDraftObject,
  writeDraftMeta,
  writeDraftObject,
} from "./draft-persistence.js";
import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
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
import { archiveFileName } from "./tour-session.js";
import {
  endQrPipeline,
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
  mintButton: HTMLButtonElement;
  finishButton: HTMLButtonElement;
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
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface CreatorSetup {
  renderAuthorReadout: () => void;
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
  codeTour?: Pick<ScanOpen, "onDetection" | "status" | "tourOf">;
}): CreatorSetup {
  const { ctx, mode, arStore, arController, seams, wizard, dom } = deps;
  const codeTour: Pick<ScanOpen, "onDetection" | "status" | "tourOf"> =
    deps.codeTour ?? {
      onDetection: () => undefined,
      status: () => ({ kind: "quiet" }),
      tourOf: () => null,
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
   * The last meta write per tour, so the next one for that tour queues
   * behind it.
   *
   * Every write for a tour targets one key in one directory, and the mint
   * and finish ones are unawaited - so an earlier write landing later would
   * overwrite a newer one, including a rejection or a measured level
   * (PR #456 review).
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
   * One entry per tour opened in this page's life: a handful of short-lived
   * promises, dropped with the page.
   */
  const metaWrites = new Map<string, Promise<boolean>>();
  /** Each decoded code text's level id (`qrCodeId`, a hash - async), so a
   *  detection can be matched to the level in hand synchronously. */
  const codeIds = new Map<string, string>();
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
    if (store === undefined) {
      // No draft namespace YET - no tour open, or its draft still opening -
      // is not a storage failure: the draft writes these when it opens
      // (scan-to-open plan §9 #5). Only an opened namespace without a store
      // is one.
      if (draftTourUrl !== null) noteNoPersistence();
      return;
    }
    void writeDraftObject(store, object, blob).then((ok) => {
      if (!ok) noteNoPersistence();
    });
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
      return await (await session.loadEntry(entry.filename)).text();
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
    };
    // Values captured NOW, write ordered by call within this tour.
    // `catch` keeps one refused write from breaking the chain behind it.
    const namespace = draftKeyForTour(tourUrl);
    const next = (metaWrites.get(namespace) ?? Promise.resolve(true))
      .catch(() => false)
      .then(() => writeDraftMeta(store, meta));
    metaWrites.set(namespace, next);
    return next;
  }

  dom.panel.hidden = !creator;
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
  /** Ids of placed objects whose preview waits for the zero (see
   *  `previewObject`); emptied when a visit ends - the next one renders
   *  everything again. */
  const previewsAwaitingZero = new Set<string>();

  /** Render what waited for the zero, once the store has one. */
  function renderPreviewsAwaitingZero(): void {
    if (previewsAwaitingZero.size === 0) return;
    if (selectZeroReference(arStore.getState()) === null) return;
    const waiting = new Set(previewsAwaitingZero);
    previewsAwaitingZero.clear();
    ctx.placedObjects.forEach((entry, index) => {
      if (waiting.has(entry.object.id)) previewObject(index);
    });
  }

  if (creator) {
    // Alignment arrives via GPS dispatches, not via controller state - the
    // readout must follow the store, or "waiting for GPS alignment" sticks.
    // So does the zero, which the previews from geo wait for.
    arStore.subscribe(() => {
      renderPreviewsAwaitingZero();
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

  function renderAuthorReadout(): void {
    renderSizeOffer();
    if (!creator) return;
    renderPlacementButtons();
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
    const readiness = finishReadiness({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      manifest: ctx.tourManifestStatus,
    });
    dom.finishButton.disabled = readiness !== "ready";
    // Everything above this line is a message about something that
    // happened - an error, a rebuild - and is shown whenever it is true.
    // Below is the LIVE measuring readout, which describes a camera: "hold
    // the phone on the printed code so it fills the screen" on a desktop
    // page with no session running is an instruction for a situation the
    // creator is not in.
    if (!sessionLive()) {
      dom.status.textContent = ctx.placementNote ?? "";
      dom.mintButton.disabled = true;
      return;
    }
    // A placement's outcome (or a draft notice) stands until the next tap
    // (M4 review #3) AHEAD of the readout, never instead of it: in its
    // place it also locked Save, and on a device without OPFS the backup
    // notice fires at tour open, before any measuring - so Save never
    // unlocked (scan-to-open plan §5 #13).
    const lead =
      entryLead() +
      (ctx.placementNote === null ? "" : `${ctx.placementNote} · `);
    // evaluate, not last: a cache hit unless the detections changed - and
    // after a tracking restart the old frame's result must not stand
    // (milestone review of b4b #1).
    const fused =
      ctx.lastDetectedText === null
        ? null
        : (ctx.fusedPose?.evaluate(ctx.lastDetectedText) ?? null);
    const readout = authorStatusLine(
      ctx.lastDetectedText,
      fused,
      authorAlignmentInfo(),
      ctx.lastDetectedText !== null &&
        (ctx.printSizeCheck?.pending(ctx.lastDetectedText) ?? false),
    );
    // Once measured, the setup hint (what to do next) joins the live
    // measuring readout - re-measuring stays possible, and the readout's
    // gate wording (the fix count) stays visible on a re-entry.
    const hint = setupHint({
      measured: ctx.mintedLevel !== null,
      tourOpen: ctx.session !== null,
      hadLevel: (ctx.currentLevels?.size ?? 0) > 0,
    });
    const count =
      ctx.placedObjects.length > 0
        ? ` · ${placed(ctx.placedObjects.length)}`
        : "";
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
    // No status locks Save: in authoring there is no wrong code (plan §13).
    dom.mintButton.disabled = !readout.canMint;
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

  /** Render ONE newly placed object into the live preview (incremental:
   *  each placement decodes only its own photo, and two placements cannot
   *  race each other's disposal - M4 review #7). */
  function previewObject(placedIndex: number): void {
    const entry = ctx.placedObjects[placedIndex];
    const scene = seams.getScene();
    const zero = selectZeroReference(arStore.getState());
    if (entry === undefined || scene === null) return;
    if (zero === null) {
      // Placed from geo, which needs the zero - and on the first visit of a
      // page load (a restored draft) the zero comes with the first GPS fix,
      // after the visit began. Rendered when it lands (M2c review #4).
      previewsAwaitingZero.add(entry.object.id);
      return;
    }
    const generation = ctx.arSessionGeneration;
    void renderTourObjects([entry.object], {
      ...previewFrame(entry.placement, earlierFrame ?? scene),
      zero,
      makeLabel: (text) => seams.createLabel(text),
      loadPhotoTexture: () =>
        entry.blob === undefined
          ? Promise.resolve(null)
          : decodeFrameTexture(entry.blob, 2),
    }).then((rendered) => {
      // The session may have ended while the photo decoded.
      if (generation !== ctx.arSessionGeneration) {
        rendered.dispose();
        return;
      }
      ctx.placedPreviews.push(rendered);
    });
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

  dom.draftRestore.addEventListener("click", () => {
    const waiting = offered;
    dom.draftOffer.hidden = true;
    offered = null;
    if (waiting === null) return;
    // Into the SAME list a live placement fills, so the finish needs no
    // second path: it appends these to the manifest exactly as it appends
    // anything else, and writes the photo bytes as content entries.
    for (const object of waiting.objects) {
      const blob = waiting.photos.get(object.id);
      ctx.placedObjects.push(
        blob === undefined ? { object } : { object, blob },
      );
    }
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
    // at the same spot in the published zip. previewObject already guards
    // against a dead scene, so this is safe outside a session too.
    for (
      let i = ctx.placedObjects.length - waiting.objects.length;
      i < ctx.placedObjects.length;
      i += 1
    ) {
      previewObject(i);
    }
    ctx.placementNote = restoredText(
      waiting.objects.length,
      waiting.level !== null,
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
    const rejectedIds = offered?.storedIds ?? [];
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
      for (const id of rejectedIds) void removeDraftObject(store, id);
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
    recordPlacement(pin);
    logPlacement(pin, { reticleWorld: position });
    dom.pinLabel.value = "";
    hideLabelInput();
    previewObject(ctx.placedObjects.length - 1);
    note(`Pin "${label}" placed · ${placed(ctx.placedObjects.length)}.`);
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
    seams.encodeFrameJpeg(frame.image).then(
      (jpeg) => {
        // A visit that settled while this encoded (its session ended, or a
        // Finish ran) has its alignment on record: minted through that, the
        // photo IS settled - and the store's alignment may already belong
        // to no visit at all (the teardown resets it).
        const settled = visitSettles.get(visit);
        const photo = mintPhoto({
          id: newObjectId(),
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
          logSettle(visit, "late-arrival", settled, [photo], null);
        }
        previewObject(ctx.placedObjects.length - 1);
        // The plane sits at the capture spot, facing back at it: the
        // creator is standing on it and sees it once they step back.
        note(
          `Photo placed - step back a metre to see it · ${placed(ctx.placedObjects.length)}.`,
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
  /** Where `earlierFrame` is attached. Tracked, not read from `parent`:
   *  the e2e fakes' scene nodes do not set it. */
  let earlierFrameUnderGroup = false;

  /** Move the earlier visits' frame to where this visit's knowledge of the
   *  code puts it (see `earlierFrame`). Cheap: one matrix. */
  function placeEarlierObjects(): void {
    // Nothing to place outside a visit - and nothing to read either.
    const frame = earlierFrame;
    if (frame === null) return;
    const scene = seams.getScene();
    const group = seams.getArWorldGroup();
    if (scene === null) return;
    const state = arStore.getState();
    const choice = settleAlignment({
      visit: ctx.arSessionGeneration,
      alignment: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      mintedLevel: ctx.mintedLevel,
      measurement: ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
    });
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
   * Keep the anchor code's latest STABLE pose in this visit (plan §3.2,
   * D10b; the entry hint §3.2a): the code whose level is in hand, or - with
   * none measured yet - any code, since that is the one about to be
   * measured. "Seen" is the fused pose's own `stable`, the gate the mint
   * uses: a merely detected code gives a single-frame pose whose yaw error
   * (several degrees) would swing every corrected note by a metre at 20 m.
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
    if (ctx.mintedLevel !== null && ctx.mintedLevel.id !== id) return;
    ctx.visitCodeSighting = { text, levelId: id, odomPose: fused.pose };
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
   *   async) is minted through the same record when it lands, so every
   *   object of a visit goes through one alignment.
   *
   * Recorded even for a visit with nothing to settle yet, for that photo.
   */
  const visitSettles = new Map<number, VisitSettleRecord>();

  /**
   * Settle the running AR visit (authoring plan 2026-09-28-0953 §3.2, M2c):
   * the code measured in it and every object placed in it get their geo
   * recomputed through ONE alignment (`visit-settle.ts` decides which), the
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
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const input = {
      visit,
      placed: ctx.placedObjects,
      alignment: visitAlignment,
      zero,
      mintedLevel: ctx.mintedLevel,
      measurement: ctx.codeMeasurement,
      sighting: ctx.visitCodeSighting,
      alignmentInfo: authorAlignmentInfo(),
      nowIso: new Date().toISOString(),
    };
    const choice = settleAlignment(input);
    if (choice === null || zero === null) return;
    const record: VisitSettleRecord = {
      basis: choice.basis,
      alignment: choice.alignment,
      visitAlignment,
      zero,
      sighting:
        choice.basis === "code-corrected" ? ctx.visitCodeSighting : null,
      referenceLevel: ctx.mintedLevel,
    };
    visitSettles.set(visit, record);
    const plan = planVisitSettle(input);
    if (plan === null) return;
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
    logSettle(
      visit,
      trigger,
      record,
      plan.objects.map(({ object }) => object),
      plan.level,
    );
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
    objects: readonly TourObject[],
    level: { id: string; json: string } | null,
  ): void {
    arStore.dispatch(
      visitSettled({
        arVisitIndex: visit,
        atMs: Date.now(),
        trigger,
        basis: record.basis,
        visitAlignment: record.visitAlignment,
        usedAlignment: record.alignment,
        sighting: record.sighting,
        objects: objects.map((object) => ({ id: object.id, geo: object.geo })),
        level,
        referenceLevel: record.referenceLevel,
        zero: record.zero,
      }),
    );
  }

  dom.mintButton.addEventListener("click", () => {
    if (ctx.lastDetectedText === null) return;
    const state = arStore.getState();
    // The readout's result, re-read so a tracking restart since then counts
    // (a cache hit otherwise; milestone review of b4b #1).
    const fused = ctx.fusedPose?.evaluate(ctx.lastDetectedText) ?? null;
    const stablePose = fused?.status === "stable" ? fused.pose : null;
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
    ctx.placementNote = null;
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
    ctx.mintedLevel = null;
    ctx.codeMeasurement = null;
    dom.status.textContent = "Saving the measured position…";
    dom.finishButton.disabled = true;
    qrCodeId(mintedText).then(
      (id) => {
        if (mintGeneration !== ctx.mintGeneration) return;
        ctx.mintedLevel = { id, json: result.json };
        // What the settle re-mints the code from at the visit's end, and
        // a sighting of it in this visit (plan §3.2, M2c).
        ctx.codeMeasurement = {
          levelId: id,
          text: mintedText,
          odomPose: stablePose,
          sizeM: measured.sizeM,
          visit: measured.arVisitIndex,
        };
        codeIds.set(mintedText, id);
        if (measured.arVisitIndex === ctx.arSessionGeneration) {
          ctx.visitCodeSighting = {
            text: mintedText,
            levelId: id,
            odomPose: stablePose,
          };
        }
        ctx.mintedLevelTour = {
          levelId: id,
          tourUrl: codeTour.tourOf(mintedText),
        };
        arStore.dispatch(codeMeasured({ levelId: id, ...measured }));
        if (draftTourUrl !== null) void recordMeta(draftTourUrl);
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
    if (
      current === null ||
      ctx.mintedLevel === null ||
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
        // The manifest: what the zip carried plus what this session placed;
        // the photos' bytes become content entries next to it.
        const manifest = ctx.tourManifest ?? createEmptyTourManifest();
        const written: TourManifest = {
          ...manifest,
          // De-duplicating by id, and not for tidiness: the serializer
          // REJECTS duplicates, so one restored object that is already in
          // the manifest would make every finish throw - for as long as the
          // draft is restored, with no escape inside the app (M5 review #4).
          objects: appendWithoutDuplicateIds(
            manifest.objects,
            ctx.placedObjects.map((p) => p.object),
          ),
        };
        const entries = [
          {
            path: existingLevelPath ?? qrLevelEntryName(minted.id),
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
        const input =
          ctx.rebuiltZip?.blob ?? (await current.readWholeArchive());
        if (ctx.session !== current) return; // re-opened meanwhile
        const blob = await rebuildZipWithEntries(input, entries, {
          onProgress: (done, total) => {
            ctx.finishProgress = FINISH_LABELS.rebuilding(done, total);
            renderAuthorReadout();
          },
        });
        if (ctx.session !== current) return;
        const hosted = current.hostedFileName();
        ctx.rebuiltZip = {
          blob,
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
        dom.finishStatus.textContent = drive()
          ? FINISH_LABELS.readyDrive(blob.size, ctx.rebuiltZip.filename)
          : FINISH_LABELS.ready(blob.size, route() === "share");
        dom.downloadButton.textContent = idleLabel();
        dom.downloadButton.disabled = false;
        // The placed objects are in the zip now; the next finish (a
        // re-measure, a re-opened tour) must not append them again - and
        // the in-memory manifest has to ADVANCE to what was just written,
        // or a second finish in the same open tour would rebuild from the
        // pre-finish manifest and silently drop this batch (PR #435
        // review). `tourManifest` is otherwise only written at tour open.
        ctx.tourManifest = written;
        // Only what this zip carries leaves the list: a photo that landed
        // while the zip was rebuilt is in neither, and waits for the next
        // Finish (M2c review #6).
        const inZip = new Set(written.objects.map((o) => o.id));
        ctx.placedObjects = ctx.placedObjects.filter(
          (p) => !inZip.has(p.object.id),
        );
        wroteZip = true;
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
      } catch (err) {
        if (ctx.session === current) {
          ctx.finishError = FINISH_LABELS.failed(
            err instanceof Error ? err.message : String(err),
          );
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
    startAuthorPipeline,
    beginAuthorVisit: () => {
      if (!creator) return;
      const scene = seams.getScene();
      if (scene === null) return;
      // Earlier visits' objects (plan §3.2): each keeps only its geo in this
      // visit, so they go into one frame that starts at the scene root -
      // placed from geo, like the viewer's content - and moves under the
      // world group once the code is seen (`placeEarlierObjects`).
      earlierFrame = new Group();
      earlierFrame.name = "earlier-visits";
      earlierFrame.matrixAutoUpdate = false;
      earlierFrameUnderGroup = false;
      scene.add(earlierFrame);
      for (let i = 0; i < ctx.placedObjects.length; i += 1) previewObject(i);
      placeEarlierObjects();
    },
    endAuthorVisit: () => {
      if (!creator) return;
      settleVisit("visit-end");
      ctx.visitCodeSighting = null;
      previewsAwaitingZero.clear();
      // The previews inside are disposed with `placedPreviews`; the frame
      // itself is this module's.
      earlierFrame?.removeFromParent();
      earlierFrame = null;
    },
    resetFinishStep: () => {
      dom.downloadButton.disabled = true;
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
        // Deletes that did not finish last time. `rejectedIds` is exactly
        // the ids the meta rejects whose files are still on disk, so this
        // is the only thing that reclaims them - and it is safe to repeat,
        // because removing a key that is not there is not a failure.
        for (const id of draftRejected) void removeDraftObject(store, id);
        // Work made before this draft opened - with no tour open, or while
        // the manifest settled - was never written (scan-to-open plan §9
        // #5). AFTER the read on purpose: every branch below deletes only
        // what the read returned, so these cannot be swept as a spent or
        // rejected draft's.
        const storedIds = new Set(stored?.storedIds ?? []);
        for (const entry of ctx.placedObjects) {
          if (!storedIds.has(entry.object.id)) {
            recordPlacement(entry.object, entry.blob);
          }
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
        const hostedLevel =
          stored.draft.level === null
            ? null
            : await hostedLevelJson(stored.draft.level.id);
        if (stale()) return;
        if (draftIsSpent(stored.draft, ctx.tourManifest, hostedLevel)) {
          // SPENT: the hosted zip carries every object AND the measurement.
          // That is the only proof the content reached the file the world
          // sees, and the only thing that deletes a draft.
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
          draftRejected = stored.storedIds;
          // Same commit point as the discard, for the same reason: an
          // interrupted sweep must not bring a spent draft back - and the
          // same notice when it does not land.
          if (!(await recordMeta(tourUrl))) {
            noteNoPersistence();
            return;
          }
          if (stale()) return;
          for (const id of stored.storedIds) void removeDraftObject(store, id);
          return;
        }
        const hasLevel = draftHasUnhostedLevel(stored.draft, hostedLevel);
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
        };
        dom.draftOfferText.textContent = restoreOfferText(
          waiting.length,
          hasLevel,
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
  };
}
