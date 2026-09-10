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
  recordQrDetection,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrPoseStability,
  selectStableQrPose,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { Vector3 } from "three";

import {
  mintPhoto,
  mintPin,
  newObjectId,
  renderTourObjects,
} from "./content-placement.js";

import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

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
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface CreatorSetup {
  renderAuthorReadout: () => void;
  /** Creates the author tracking controller for THIS AR entry; false (with
   *  the reason in the panel) keeps AR unstarted. */
  startAuthorPipeline: () => boolean;
  /** A tour closed: step 5's download and status are stale (M3 review #6). */
  resetFinishStep: () => void;
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
}): CreatorSetup {
  const { ctx, mode, arStore, arController, seams, wizard, dom } = deps;
  const creator = mode === "creator";
  const openDraftStore =
    deps.openDraftStore ?? (() => Promise.resolve(undefined));

  /** This tour's draft store, once a tour is open. */
  let draftStore: DraftFileStore | undefined;
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
      noteNoPersistence();
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
  function recordMeta(tourUrl: string): void {
    const store = draftStore;
    if (store === undefined) return;
    // The size comes from the FIELD, not from `ctx.activeSizeM`: that is
    // only assigned at AR entry, so before the first session it still holds
    // the previous tour's value.
    const sizeM = Number(dom.sizeInput.value);
    void writeDraftMeta(store, {
      tourUrl,
      sizeM:
        Number.isFinite(sizeM) && sizeM > 0 ? sizeM : AUTHOR_DEFAULT_SIZE_M,
      level: ctx.mintedLevel,
    });
  }

  dom.panel.hidden = !creator;
  dom.sizeInput.value = String(AUTHOR_DEFAULT_SIZE_M);

  /** True while the AR session is up: what gates the controls and the live
   *  measuring readout. Read from the controller rather than tracked, so
   *  it cannot drift out of step with the session it describes. */
  function sessionLive(): boolean {
    return arSessionLive(arController.getState().status);
  }
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

  function renderAuthorReadout(): void {
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
    // A placement's outcome stands until the next tap (M4 review #3).
    if (ctx.placementNote !== null) {
      dom.status.textContent = ctx.placementNote;
      dom.mintButton.disabled = true;
      dom.finishButton.disabled =
        finishReadiness({
          measured: ctx.mintedLevel !== null,
          tourOpen: ctx.session !== null,
          manifest: ctx.tourManifestStatus,
        }) !== "ready";
      return;
    }
    // Everything above this line is a message about something that
    // happened - an error, a rebuild, a placement - and is shown whenever
    // it is true. Below is the LIVE measuring readout, which describes a
    // camera: "hold the phone on the printed code so it fills the screen"
    // on a desktop page with no session running is an instruction for a
    // situation the creator is not in.
    if (!sessionLive()) {
      dom.status.textContent = "";
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
    dom.status.textContent =
      (hint === "" ? readout.text : `${readout.text} · ${hint}`) + count;
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

  /** Render ONE newly placed object into the live preview (incremental:
   *  each placement decodes only its own photo, and two placements cannot
   *  race each other's disposal - M4 review #7). */
  function previewObject(placedIndex: number): void {
    const entry = ctx.placedObjects[placedIndex];
    const scene = seams.getScene();
    const zero = selectZeroReference(arStore.getState());
    if (entry === undefined || scene === null || zero === null) return;
    const generation = ctx.arSessionGeneration;
    void renderTourObjects([entry.object], {
      scene,
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
    // Both happen synchronously in the handler, so the generation guard
    // that used to sit here is gone with the await that needed it.
    if (draftTourUrl !== null) recordMeta(draftTourUrl);
    for (const id of rejectedIds) void removeDraftObject(store, id);
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
    ctx.placedObjects.push({ object: pin });
    recordPlacement(pin);
    dom.pinLabel.value = "";
    hideLabelInput();
    previewObject(ctx.placedObjects.length - 1);
    note(`Pin "${label}" placed · ${placed(ctx.placedObjects.length)}.`);
  });

  dom.photoButton.addEventListener("click", () => {
    ctx.placementNote = null;
    const frame = ctx.latestFrame;
    const cameraPose = seams.getCameraPose();
    if (!placementAllowed() || frame === null || cameraPose === null) {
      note("No camera frame yet - try again in a moment.");
      return;
    }
    dom.photoButton.disabled = true;
    note("Capturing…");
    seams.encodeFrameJpeg(frame).then(
      (jpeg) => {
        const photo = mintPhoto({
          id: newObjectId(),
          cameraPose,
          alignmentMatrix: selectAlignmentMatrix(arStore.getState()),
          zero: selectZeroReference(arStore.getState()),
          imageWidth: jpeg.width,
          imageHeight: jpeg.height,
          nowIso: new Date().toISOString(),
        });
        if (photo === null) {
          note("No usable GPS alignment yet - the photo cannot be placed.");
          return;
        }
        ctx.placedObjects.push({ object: photo, blob: jpeg.blob });
        recordPlacement(photo, jpeg.blob);
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
    ctx.placementNote = null;
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
        if (draftTourUrl !== null) recordMeta(draftTourUrl);
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
    ctx.placementNote = null;
    ctx.finishProgress = FINISH_LABELS.reading(current.archive.size);
    renderAuthorReadout();
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
        ctx.rebuiltZip = {
          blob,
          filename: archiveFileName(current.archive.url),
        };
        dom.finishStatus.textContent = FINISH_LABELS.ready(blob.size, canShare);
        dom.downloadButton.disabled = false;
        // The placed objects are in the zip now; the next finish (a
        // re-measure, a re-opened tour) must not append them again - and
        // the in-memory manifest has to ADVANCE to what was just written,
        // or a second finish in the same open tour would rebuild from the
        // pre-finish manifest and silently drop this batch (PR #435
        // review). `tourManifest` is otherwise only written at tour open.
        ctx.tourManifest = written;
        ctx.placedObjects = [];
        // NOT cleared here, and not on the download tap either: the zip is
        // only in the creator's hands, not yet in the file the world sees.
        // It is cleared when a re-opened tour turns out to carry these ids
        // (see presentDraftForTour) - the one signal that is proof.
        if (draftTourUrl !== null) recordMeta(draftTourUrl);
        // The session ends so the creator lands on the page, where the
        // download button is a fresh tap (a download needs its own user
        // gesture, plan §2.4) - unless it already ended and another one
        // started, which is then not ours to end.
        if (sessionGeneration === ctx.arSessionGeneration) {
          await arController.disable();
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
        ctx.finishing = false;
        ctx.finishProgress = "";
        renderAuthorReadout();
      }
    })();
  });

  // The capability, asked ONCE at wire time. A button that says "Share"
  // where nothing can be shared is a lie, and one that says "Download" on
  // a phone that can share describes the wrong action - and the answer
  // cannot change between wiring and the click.
  const canShare = seams.canShareZip();
  const idleLabel = finishIdleLabel(canShare);
  const busyLabel = finishBusyLabel(canShare);
  dom.downloadButton.textContent = idleLabel;
  dom.downloadButton.addEventListener("click", () => {
    const rebuilt = ctx.rebuiltZip;
    if (rebuilt === null) return;
    // Async-UI rule: in-progress before the await, the durable end state
    // after; nothing delivered (a dismissed save picker, an abandoned
    // share sheet) keeps the button live.
    dom.downloadButton.disabled = true;
    dom.downloadButton.textContent = busyLabel;
    // The share sheet can stay up for as long as the creator wants, and a
    // tour can be closed underneath it. Every other post-await path in this
    // module re-checks its generation; this one resolved straight into the
    // DOM, so a hand-off that settled after a close revealed the step-6
    // instructions on the CLOSED tour's panel - invisible at the time,
    // because the block that holds them is hidden, and then already on
    // screen the moment the next tour reached its finish (PR #440 review).
    const openGeneration = ctx.openGeneration;
    seams.shareOrDownloadZip(rebuilt.blob, rebuilt.filename).then(
      ({ route, delivered }) => {
        if (openGeneration !== ctx.openGeneration) return;
        dom.downloadButton.disabled = false;
        dom.downloadButton.textContent = idleLabel;
        dom.finishStatus.textContent = finishHandoffStatus(
          { route, delivered },
          rebuilt.filename,
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
        const help = finishHelpVisibility({ route, delivered });
        if (help.replaceHelp) dom.replaceHelp.hidden = false;
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
        dom.downloadButton.textContent = idleLabel;
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
      // The LABEL too, because the hand-off continuation is generation-
      // guarded and returns without restoring it for a tour that closed
      // underneath an open share sheet. Without this the next tour's
      // finish enables a button that still reads "Sharing…" (PR #441
      // review) - the guard moved the leak here rather than removing it.
      dom.downloadButton.textContent = idleLabel;
      dom.finishStatus.textContent = "";
      // The rebuilt zip belonged to the tour that just closed, so the block
      // offering it goes away with it (M3 review #6) - otherwise a newly
      // opened tour shows a dead download button from the previous one.
      dom.finishBlock.hidden = true;
      dom.replaceHelp.hidden = true;
      dom.replaceHelpShare.hidden = true;
      // The offer belonged to the tour that just closed.
      dom.draftOffer.hidden = true;
      offered = null;
      draftStore = undefined;
      draftTourUrl = null;
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
        if (stored === undefined) {
          // No draft yet, but there will be: record what is already known,
          // so a crash before the first placement still leaves the tour and
          // the printed size behind.
          recordMeta(tourUrl);
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
          recordMeta(tourUrl);
          // `storedIds`, not `draft.objects`: the latter is what parsed,
          // and a record this read refused still has files. Nothing
          // reclaims those since `clear` lost its last caller.
          for (const id of stored.storedIds) void removeDraftObject(store, id);
          return;
        }
        const hasLevel = draftHasUnhostedLevel(stored.draft, hostedLevel);
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
