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
  draftKeyForTour,
  draftObjectsNotYetHosted,
  restoredText,
  restoreOfferText,
} from "./authoring-draft.js";
import {
  readDraft,
  writeDraftMeta,
  writeDraftObject,
} from "./draft-persistence.js";
import type { ViewerMode } from "./mode.js";
import {
  archiveSizeNote,
  authorStatusLine,
  buildAuthorControllerConfig,
  FINISH_LABELS,
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
  /** What a draft is offering, until the creator answers. */
  let offered: {
    objects: readonly TourObject[];
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
  function recordPlacement(object: TourObject, blob?: Blob): void {
    const store = draftStore;
    if (store === undefined) return;
    void writeDraftObject(store, object, blob).then((ok) => {
      if (ok || warnedAboutPersistence) return;
      warnedAboutPersistence = true;
      ctx.placementNote =
        "Placed. (This device is not saving a backup copy - finish and download before closing the page.)";
      renderAuthorReadout();
    });
  }

  /** Record the measured code and the size it was measured at. */
  function recordMeta(): void {
    const store = draftStore;
    if (store === undefined || ctx.session === null) return;
    void writeDraftMeta(store, {
      tourUrl: ctx.session.archive.url,
      sizeM: ctx.activeSizeM,
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
    ctx.placementNote = restoredText(waiting.objects.length);
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
    offered = null;
    const store = draftStore;
    if (store === undefined) return;
    // The one way a creator can throw a draft away deliberately - and the
    // escape hatch for a draft that would otherwise be offered forever.
    void store.clear();
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
        recordMeta();
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
        dom.finishStatus.textContent = FINISH_LABELS.ready(blob.size);
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
        recordMeta();
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
        // The replace instructions were step 6; they are the last thing to
        // do and only once there is a file to do it with, so they appear
        // when the zip is actually on the device (F10).
        if (saved) dom.replaceHelp.hidden = false;
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
      // The rebuilt zip belonged to the tour that just closed, so the block
      // offering it goes away with it (M3 review #6) - otherwise a newly
      // opened tour shows a dead download button from the previous one.
      dom.finishBlock.hidden = true;
      dom.replaceHelp.hidden = true;
      // The offer belonged to the tour that just closed.
      dom.draftOffer.hidden = true;
      offered = null;
      draftStore = undefined;
    },
    presentDraftForTour: (tourUrl) => {
      if (!creator) return; // a visitor authors nothing
      void (async () => {
        const store = await openDraftStore(draftKeyForTour(tourUrl));
        draftStore = store;
        if (store === undefined) return;
        const stored = await readDraft(store);
        if (stored === undefined) {
          // No draft yet, but there will be: record what is already known,
          // so a crash before the first placement still leaves the tour and
          // the printed size behind.
          recordMeta();
          return;
        }
        const waiting = draftObjectsNotYetHosted(
          stored.draft,
          ctx.tourManifest,
        );
        if (waiting.length === 0) {
          // SPENT: the hosted zip already carries everything this draft
          // held. That is the only proof the content reached the file the
          // world sees, and the only thing that deletes a draft.
          await store.clear();
          draftStore = await openDraftStore(draftKeyForTour(tourUrl));
          recordMeta();
          return;
        }
        offered = {
          objects: waiting,
          photos: stored.photos,
          level: stored.draft.level,
          sizeM: stored.draft.sizeM,
        };
        dom.draftOfferText.textContent = restoreOfferText(waiting.length);
        dom.draftOffer.hidden = false;
      })();
    },
  };
}
