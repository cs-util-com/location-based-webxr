/**
 * The page's mutable session state as ONE explicit object (flows plan M6,
 * DEC-T6 of the simplification plan): every wiring module receives it and
 * mutates the fields it owns, instead of `main.ts` carrying 28 module-scope
 * variables that four concerns wrote to. No behaviour lives here - the
 * fields' invariants are documented where they are used (see each module's
 * sidecar) and summarised in `tour-viewer-session.ts.md`.
 */

import type { createEnableGpsArController } from "gps-plus-slam-app-framework/ar";
import type {
  createQrTrackingController,
  QrTrackingStatus,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";
import type { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  createSlamAppStore,
  qrDetectedReducer,
  recordQrDetection,
  slicePrefixOf,
} from "gps-plus-slam-app-framework/state";
import {
  NullStorageBackend,
  type StorageBackend,
} from "gps-plus-slam-app-framework/storage";

import { objectPlaced } from "./tour-authoring-actions.js";
import { codeLocked } from "./tour-viewing-actions.js";

import type {
  HitTestReticleHandle,
  SelectTargetRay,
} from "gps-plus-slam-app-framework/ar";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { RenderedTourObjects } from "./content-placement.js";
import type { FusedTallies, LastEvaluation } from "./qr-debug-readout.js";
import type { PrintSizeCheck } from "./print-size-check.js";
import type { MovedCodeChecks } from "./moved-code-check.js";
import type { QrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import type { ViewerVoteSink } from "./viewer-vote-sink.js";
import type { ScanGate } from "./scan-gate.js";
import type { PlacedImagePlanes } from "./image-planes.js";
import type { TourViewerSeams } from "./seams.js";
import type { NuePose } from "./visit-anchoring.js";
import type { CodeMeasurement, CodeSighting } from "./visit-settle.js";
import type { PlacementState } from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";

// Reached through the session object's fields; standalone exports count as
// dead (knip).
type QrController = ReturnType<typeof createQrTrackingController>;
type FusedPoseSource = ReturnType<typeof createFusedQrPoseSource>;
type QrDebugView = ReturnType<TourViewerSeams["createQrDebugView"]>;

/**
 * Where an object was placed in AR, kept for the settle (authoring plan
 * 2026-09-28-0953 §3.2, M2c): its pose in the world group's frame
 * (odometry-NUE, `visit-anchoring.ts`) and the AR visit that frame belongs
 * to - odometry from another visit is meaningless. Absent for an object
 * that came back from a draft: it has only its geo.
 */
interface VisitPlacement {
  /** `arSessionGeneration` at the tap. */
  readonly visit: number;
  readonly local: NuePose;
}

/**
 * The page's store: the framework store with the opt-in `qrDetected` slice
 * both modes need (author: stability gate for minting; viewer: the
 * relocalization votes read the same window). One factory so every module
 * types the store the same way.
 *
 * `recording` is the creator's troubleshooting recording
 * (`authoring-recording.ts`): its backend, and its gate REPLACING the
 * `isRecording` one - this app starts and ends a session on every AR entry
 * and exit, so under the default gate the per-exit reset and everything
 * done on the page outside AR would never be written. The numbering runs
 * across those sessions for the same reason. Without it (tests) the store
 * writes into a `NullStorageBackend` as before.
 */
export function createTourViewerStore(recording?: {
  storageBackend: StorageBackend;
  persistWhile: () => boolean;
}) {
  return createSlamAppStore({
    storageBackend: recording?.storageBackend ?? new NullStorageBackend(),
    ...(recording === undefined
      ? {}
      : { persistWhile: recording.persistWhile, continuousActionIndex: true }),
    extraReducers: { qrDetected: qrDetectedReducer },
    // Beyond the framework's built-ins (GPS with its paired poses, the
    // recording lifecycle, diagnostics): the QR detections the votes and
    // the mint were computed from, the creator's own log actions, and a
    // debugging visitor's (M1b).
    persistedExtraPrefixes: [
      slicePrefixOf(recordQrDetection.type),
      // Every `tourAuthoring/*` action: placed, measured, settled, finished.
      slicePrefixOf(objectPlaced.type),
      slicePrefixOf(codeLocked.type),
    ],
  });
}
export type TourViewerStore = ReturnType<typeof createTourViewerStore>;
export type ArController = ReturnType<typeof createEnableGpsArController>;

/**
 * Cross-module calls, late-bound: the modules are wired in an order that
 * cannot satisfy every dependency at construction (the archive open needs
 * the AR status renderer, which needs the viewer pipeline, which needs the
 * status renderer). `main.ts` creates this object with no-op members and
 * fills each in as its owner module is wired; callers read it at call time.
 * This is what keeps the modules free of import cycles (`check:cycles`).
 */
export interface TourViewerHooks {
  renderArStatus(): void;
  /** Re-render the AR button (its label depends on the visitor screen's
   *  location gate, which resolves asynchronously). */
  renderArEntry(): void;
  renderAuthorReadout(): void;
  tryPlaceTour(): void;
  startAuthorPipeline(): boolean;
  startViewerPipeline(): boolean;
  /** Present the open tour's link in the print panel (M3's prefill), and
   *  advance the wizard. `origin` says which form the creator submitted
   *  from: an open started in step 4 must not answer by jumping to step 2
   *  and collapsing step 4, whose content is the AR overlay root. */
  presentTourForPrint(url: string, origin?: "host-step" | "measure-step"): void;
  /** A tour closed: the finish step's page-side state is stale. */
  resetFinishStep(): void;
  /** A creator's AR visit is running (its world group exists): show the
   *  earlier visits' objects (authoring plan 2026-09-28-0953 §3.2, M2c). */
  beginAuthorVisit(): void;
  /** A creator's AR visit ends: settle it. Called BEFORE the session's
   *  store teardown, which resets the alignment the settle reads. */
  endAuthorVisit(): void;
  /** A creator's tap in AR (an XR select the overlay did not cancel):
   *  select the object under the tap - its target ray from the reticle
   *  driver, or the ring's screen centre when null (authoring plan
   *  2026-09-28-0953 M4; review #4). */
  selectInView(tap: SelectTargetRay | null): void;
  /** No tour is open any more (one closed, or an open failed): the panels
   *  that show a tour's link go back to ASKING for one. Without this, the
   *  print step keeps showing the previous tour's link as immutable text
   *  and step 4 stops offering to open a tour at all - for the rest of the
   *  page's life (M3 milestone review #3). */
  presentNoTour(): void;
  /** A tour opened AND its manifest settled: offer any unsaved work this
   *  device still holds for it, or delete a draft the hosted zip has
   *  already absorbed. It waits for the manifest because "spent" is
   *  defined against it. */
  presentDraftForTour(tourUrl: string): void;
  /** A session reached running, or a tour opened into a running session:
   *  derive the scan gate (idle when no session runs). */
  startScanGate(): void;
  /** A tour closed: the gate belongs to it (idle, clock cancelled). */
  resetScanGate(): void;
  /** The tour's levels arrived (or could not be read): a scanning gate may
   *  be waived. */
  reconsiderScanGate(
    levels: ReadonlyMap<string, QrLevel> | "unavailable",
  ): void;
}

export function createUnwiredHooks(): TourViewerHooks {
  return {
    renderArStatus: () => undefined,
    renderArEntry: () => undefined,
    renderAuthorReadout: () => undefined,
    tryPlaceTour: () => undefined,
    startAuthorPipeline: () => false,
    startViewerPipeline: () => false,
    presentTourForPrint: () => undefined,
    resetFinishStep: () => undefined,
    beginAuthorVisit: () => undefined,
    endAuthorVisit: () => undefined,
    selectInView: () => undefined,
    presentNoTour: () => undefined,
    presentDraftForTour: () => undefined,
    startScanGate: () => undefined,
    resetScanGate: () => undefined,
    reconsiderScanGate: () => undefined,
  };
}

export interface TourViewerSession {
  // --- the open tour (archive-open.ts) ------------------------------------
  session: TourSession | null;
  /** The open tour's authored QR levels — the viewer pipeline's level source. */
  currentLevels: ReadonlyMap<string, QrLevel> | null;
  /** The open tour's `tour.json` (null: none, or not loaded yet). The
   *  finish step writes it back, so content already in the zip survives a
   *  re-measure. */
  tourManifest: TourManifest | null;
  /** Whether the manifest load settled: the finish step refuses while it
   *  is pending or broken, or it would overwrite the creator's placement
   *  with an empty list (M3 review #5). */
  tourManifestStatus: "pending" | "settled" | "broken";
  /** Bumped per open; a slower open that finishes after a newer one started
   *  must close itself instead of clobbering the newer session. */
  openGeneration: number;

  // --- shared AR session state (ar-entry.ts) ------------------------------
  qrController: QrController | null;
  /**
   * The session's fused QR pose per code (QR near-frontal pose plan §60):
   * what the viewer votes with and the creator mints from. Created with the
   * controller, dropped at session end.
   */
  fusedPose: FusedPoseSource | null;
  /**
   * Per code, the lock counts of the fused pose (plan §66): the `?debug=1`
   * readout. Replaced at each pipeline start and KEPT at session end, so the
   * last session's counts outlive it until the next one (plan §67 #10).
   */
  fusedTallies: FusedTallies | null;
  /**
   * The creator's print-size check (QR size consensus plan S3a); null for a
   * visitor. Reset at AR session end and at a tour switch.
   */
  printSizeCheck: PrintSizeCheck | null;
  /** Whether the page was opened with `?debug=1` (read once at boot). */
  debug: boolean;
  /** The in-scene glue check (axis+cube on the code) — the one check a human
   *  at the poster can perform; spread alone is precision, not accuracy
   *  (milestone review #8). */
  qrDebugView: QrDebugView | null;
  cameraFrameCount: number;
  /** Levels resolved per decoded text, filled by the viewer pipeline's async
   *  `fetchLevel`. Deriving a code's identity is a hash and therefore async,
   *  while the debug view and the image planes need the answer synchronously —
   *  so the one place that can await it caches it here for both. */
  levelByText: Map<string, QrLevel | null>;
  /** The level id each decoded text resolved to (the open tour's; cleared
   *  with `levelByText`): what the moved-code veto is looked up by. */
  levelIdByText: Map<string, string>;

  // --- the creator setup (creator-setup.ts) --------------------------------
  /** The most recently detected code — the one the stability gate tracks. */
  lastDetectedText: string | null;
  /** The printed size CAPTURED at AR entry — the size the solves actually
   *  used; the input is disabled while running (milestone review #3). */
  activeSizeM: number;
  /** A persistent pipeline error (no detector, controller failure) — shown
   *  with priority so store updates cannot clobber it (milestone review #5). */
  authorErrorText: string | null;
  /** GPS-fix count snapshot taken when THIS session's runtime started: the
   *  gpsData slice has no reset, so the lifetime count would re-open the mint
   *  gate instantly on a re-entry over an alignment blended across two odom
   *  origins (PR #360 review). Only fixes since the snapshot count. */
  gpsSamplesAtSessionStart: number;
  /** The measured code, ready to be written as `qr/<id>.json`; null until
   *  the mint's async identity hash landed. */
  mintedLevel: { id: string; json: string } | null;
  /** The tour the measured code named (its normalised link; null when it
   *  named none), for the level with id `levelId`. Valid only while that is
   *  `mintedLevel`'s id - so it needs no clearing of its own. A level
   *  measured with no tour open waits for THAT tour (scan-to-open plan §9
   *  #4). */
  mintedLevelTour: { levelId: string; tourUrl: string | null } | null;
  /** Bumped per mint so a stale identity hash cannot install an older
   *  level over a newer one. */
  mintGeneration: number;
  /**
   * The raw inputs of the mint behind `mintedLevel` when it was made in
   * this page (the fused pose, the size, the AR visit): what the settle
   * re-mints the code from (authoring plan 2026-09-28-0953 §3.2, M2c).
   * Null for a level restored from a draft, and cleared with the level.
   */
  codeMeasurement: CodeMeasurement | null;
  /**
   * The anchor code as the RUNNING AR visit last saw it, stable (the
   * latest stable fused pose): what a later visit is corrected through
   * (D10b) and what hides the entry hint (§3.2a). Cleared at each visit's
   * end - odometry does not carry over.
   */
  visitCodeSighting: CodeSighting | null;
  /** The finish step is running (one at a time); the panel shows its
   *  progress with priority over the measuring readout. */
  finishing: boolean;
  /** The finish step's live progress copy while `finishing`. */
  finishProgress: string;
  /** The last finish failure, shown with priority until the next tap
   *  (the readout used to erase it on the next store dispatch, M3 review #1). */
  finishError: string | null;
  /** The rebuilt zip awaiting download in step 5. */
  rebuiltZip: { blob: Blob; filename: string } | null;
  /** What the panel calls the open tour (`tourLabel`); null with none. */
  tourLabel: string | null;
  /** Content placed in THIS setup session (M4): the records the finish
   *  step appends to `tour.json`, with the photo bytes that become
   *  `content/<id>.jpg`. Survives a session end like the level does. */
  placedObjects: {
    object: TourObject;
    blob?: Blob;
    placement?: VisitPlacement;
  }[];
  /** The creator's hit-test reticle for the running session. */
  reticle: HitTestReticleHandle | null;
  /** The most recent camera frame - what "Capture a photo" encodes, with
   *  the pose it was captured at (the photo is placed with THAT pose). */
  latestFrame: CapturedCameraFrame | null;
  /**
   * Ids of objects the open tour's manifest carries that the creator
   * deleted (tombstones, authoring plan 2026-09-28-0953 §3.4): the Finish
   * filters them out and removes a deleted photo's content file. Emptied by
   * a Finish (the manifest no longer carries them) and when the tour
   * closes.
   */
  deletedObjectIds: string[];
  /** The live previews in the running AR visit, one per object id - this
   *  device's and the hosted zip's (rendered as each lands; re-rendering
   *  everything per placement raced itself and re-decoded every photo, M4
   *  review #7). Keyed by id so an edit, a move or a delete finds its
   *  object, and a tap in AR names what it hit. */
  placedPreviews: Map<string, RenderedTourObjects>;
  /** The last placement's outcome (or a draft notice), shown ahead of the
   *  live readout until the next tap; it gates no control (store
   *  dispatches re-render the readout at the frame cadence and erased it
   *  within a frame, M4 review #3). */
  placementNote: string | null;
  /** Bumped on every AR session end: an async continuation captures it
   *  and must not act on a session it did not start in (M3 review #2). */
  arSessionGeneration: number;

  // --- viewer QR line (viewer-placement.ts) -------------------------------
  viewerQrStatus: QrTrackingStatus | null;
  viewerUnknownCode: string | null;
  viewerUnusableCode: string | null;
  viewerVotedLocks: number;
  viewerLockedText: string | null;
  viewerReprojectionPx: number | null;
  /** The viewer's last NEW fused evaluation - the visitor hint's source
   *  (plan §67 #5: read, never re-evaluated, on render). */
  viewerLastEvaluation: LastEvaluation | null;
  /** Last detection's RMS reprojection error — the on-device quality number. */
  latestReprojectionPx: number | null;
  /** The viewer pipeline's code keep-alive (authoring plan M2b): created
   *  per AR entry with the pipeline, stopped at AR exit (`endQrPipeline`)
   *  and when its tour closes; the status line reads its phase. */
  viewerKeepAlive: QrVoteKeepAlive | null;
  /** The viewer pipeline's per-code vote budget: created per AR entry with
   *  the pipeline, dropped at AR exit, and reset when its tour closes
   *  ({@link endTourCodeVotes}) - the pipeline outlives a tour switch. */
  viewerVoteBudget: QrVoteBudget | null;
  /** This visitor AR entry's vote sink (`viewer-vote-sink.ts`, authoring
   *  plan M2e): created at the entry's start (which clears the solver
   *  overrides), the way every vote and every keep-alive tick reaches the
   *  store, kept across a tour switch and dropped at AR exit (the next
   *  entry's start clears the overrides). Null outside a visitor entry: device fixes then
   *  take the plain `recordGpsEvent`. */
  viewerVoteSink: ViewerVoteSink | null;
  /** This visitor AR entry's moved-code checks (authoring plan
   *  2026-09-28-0953 §3.6, D20, M5c): created with the pipeline, cleared at
   *  a tour switch, dropped at AR exit. */
  movedCodeChecks: MovedCodeChecks | null;
  /** The codes the moved-code check judged moved, by level id: ignored for
   *  the rest of the page session for THIS tour (§7j #13) - kept across AR
   *  entries, cleared at a tour switch ({@link endTourCodeVotes}). */
  ignoredCodes: Map<string, { readonly text: string }>;
  /** The ignored code the status line names in this AR entry (vetoed, or
   *  seen again); null when none. */
  viewerIgnoredText: string | null;

  // --- placement (viewer-placement.ts) ------------------------------------
  /** What the photo placement did — rendered by tour-flow. */
  placement: PlacementState;
  /** A failed image-plane placement, surfaced in the AR status line —
   *  `#error` is a sibling of `#ar-root` and invisible during the session
   *  (the milestone-review-#4 trap; PR #366 review). */
  viewerPlanesError: string | null;
  /** A failed `tour.json` content render, on its own channel: the
   *  capture-plane paths write `viewerPlanesError`, and whichever failed
   *  second used to erase the other's message (M5 review #5). */
  contentError: string | null;
  imagePlanes: PlacedImagePlanes | null;
  /** In-flight guard: without it every voted lock during the decode window
   *  started ANOTHER placement run (M4 milestone review #4). */
  imagePlanesLoading: boolean;
  /** Bumped on session end and tour teardown: an in-flight placement run
   *  captures the value and every post-await step re-checks it — a run its
   *  session outlived frees its textures instead of planting planes into a
   *  dead scene (milestone review, finding 6). */
  planesRunGeneration: number;
  /** The store subscription while a viewer session runs (flows plan M4). */
  placementUnsubscribe: (() => void) | null;
  /** Whether this session+tour already attempted the ready-triggered
   *  placement. */
  placementAttempted: boolean;
  /** Whether the join declined - a later lock goes straight to the ring
   *  instead of replaying the walk again. */
  joinDeclined: boolean;

  // --- the scan gate and the placed content (viewer-placement.ts, M5) ------
  scanGate: ScanGate;
  /** Cancels the escape clock while the gate scans. */
  cancelEscapeClock: (() => void) | null;
  /** The tour's `tour.json` objects, rendered after the gate. */
  contentRendered: RenderedTourObjects | null;
  /** Whether this session already attempted the content placement. */
  contentAttempted: boolean;
}

/**
 * End the session's QR pipeline (QR near-frontal pose plan §61): dispose the
 * controller, so a decode or level fetch still in flight reaches no callback
 * - no detection into the next session's window, no status line, no vote -
 * and forget it. Nulling it alone only stopped NEW frames.
 */
export function endQrPipeline(ctx: TourViewerSession): void {
  ctx.qrController?.dispose();
  ctx.qrController = null;
  ctx.fusedPose = null;
  // The code's keep-alive ends with the AR entry (authoring plan M2b): its
  // pose is in this session's odometry frame, which the next entry resets.
  ctx.viewerKeepAlive?.stop();
  ctx.viewerKeepAlive = null;
  ctx.viewerVoteBudget = null;
  ctx.viewerVoteSink = null;
  // The checks' pins are in this entry's odometry frame; the veto memory
  // (`ignoredCodes`) outlives the entry, the line naming it does not.
  ctx.movedCodeChecks = null;
  ctx.viewerIgnoredText = null;
}

/**
 * A tour closed while the AR entry goes on (`archive-open.ts`): its codes'
 * votes end with it. The keep-alive stops holding the closing tour's code,
 * and every code's vote budget starts again - the budget lives in the
 * pipeline, which outlives the switch, and a reopened tour used to find its
 * code already "voted": its gate passed on a lock that cast nothing, and a
 * spent code never voted again (authoring plan 2026-09-28-0953, M2b
 * review #6). The soft trimming stays on (M2e milestone review #1; the seam
 * contract, rule 3): the closed tour's votes stay in the GPS history until
 * AR exit, and the hard trim back on them would jump the alignment. The
 * moved-code checks and the veto memory are the closing tour's too (D20,
 * M5c; §7j #13: per tour, cleared at a tour switch).
 */
export function endTourCodeVotes(ctx: TourViewerSession): void {
  ctx.viewerKeepAlive?.stop();
  ctx.viewerVoteBudget?.reset();
  ctx.movedCodeChecks?.clear();
  ctx.ignoredCodes.clear();
  ctx.viewerIgnoredText = null;
}

export function createTourViewerSession(): TourViewerSession {
  return {
    session: null,
    currentLevels: null,
    tourManifest: null,
    tourManifestStatus: "settled",
    openGeneration: 0,
    qrController: null,
    fusedPose: null,
    fusedTallies: null,
    printSizeCheck: null,
    debug: false,
    qrDebugView: null,
    cameraFrameCount: 0,
    levelByText: new Map(),
    levelIdByText: new Map(),
    lastDetectedText: null,
    activeSizeM: AUTHOR_DEFAULT_SIZE_M,
    authorErrorText: null,
    gpsSamplesAtSessionStart: 0,
    mintedLevel: null,
    mintedLevelTour: null,
    mintGeneration: 0,
    codeMeasurement: null,
    visitCodeSighting: null,
    finishing: false,
    finishProgress: "",
    finishError: null,
    rebuiltZip: null,
    tourLabel: null,
    arSessionGeneration: 0,
    placedObjects: [],
    reticle: null,
    latestFrame: null,
    deletedObjectIds: [],
    placedPreviews: new Map(),
    placementNote: null,
    viewerQrStatus: null,
    viewerUnknownCode: null,
    viewerUnusableCode: null,
    viewerVotedLocks: 0,
    viewerLockedText: null,
    viewerReprojectionPx: null,
    viewerLastEvaluation: null,
    latestReprojectionPx: null,
    viewerKeepAlive: null,
    viewerVoteBudget: null,
    viewerVoteSink: null,
    movedCodeChecks: null,
    ignoredCodes: new Map(),
    viewerIgnoredText: null,
    placement: { kind: "idle" },
    viewerPlanesError: null,
    contentError: null,
    imagePlanes: null,
    imagePlanesLoading: false,
    planesRunGeneration: 0,
    placementUnsubscribe: null,
    placementAttempted: false,
    joinDeclined: false,
    scanGate: { kind: "idle" },
    cancelEscapeClock: null,
    contentRendered: null,
    contentAttempted: false,
  };
}
