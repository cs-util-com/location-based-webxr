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
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  createSlamAppStore,
  qrDetectedReducer,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import type { PlacedImagePlanes } from "./image-planes.js";
import type { TourViewerSeams } from "./seams.js";
import type { PlacementState } from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";

// Reached through the session object's fields; standalone exports count as
// dead (knip).
type QrController = ReturnType<typeof createQrTrackingController>;
type QrDebugView = ReturnType<TourViewerSeams["createQrDebugView"]>;

/** The page's store: the framework store with the opt-in `qrDetected` slice
 *  both modes need (author: stability gate for minting; viewer: the
 *  relocalization votes read the same window). One factory so every module
 *  types the store the same way. */
export function createTourViewerStore() {
  return createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    extraReducers: { qrDetected: qrDetectedReducer },
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
  /** Present the open tour's link in the print panel (M3's prefill). */
  presentTourForPrint(url: string): void;
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
  };
}

export interface TourViewerSession {
  // --- the open tour (archive-open.ts) ------------------------------------
  session: TourSession | null;
  /** The open tour's authored QR levels — the viewer pipeline's level source. */
  currentLevels: ReadonlyMap<string, QrLevel> | null;
  /** Bumped per open; a slower open that finishes after a newer one started
   *  must close itself instead of clobbering the newer session. */
  openGeneration: number;

  // --- shared AR session state (ar-entry.ts) ------------------------------
  qrController: QrController | null;
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

  // --- author mode (author-mode.ts) ---------------------------------------
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
  /** The id of the most recently minted code — the download file name. */
  mintedCodeId: string | null;

  // --- viewer QR line (viewer-placement.ts) -------------------------------
  viewerQrStatus: QrTrackingStatus | null;
  viewerUnknownCode: string | null;
  viewerUnusableCode: string | null;
  viewerVotedLocks: number;
  viewerLockedText: string | null;
  viewerReprojectionPx: number | null;
  /** Last detection's RMS reprojection error — the on-device quality number. */
  latestReprojectionPx: number | null;

  // --- placement (viewer-placement.ts) ------------------------------------
  /** What the photo placement did — rendered by tour-flow. */
  placement: PlacementState;
  /** A failed image-plane placement, surfaced in the AR status line —
   *  `#error` is a sibling of `#ar-root` and invisible during the session
   *  (the milestone-review-#4 trap; PR #366 review). */
  viewerPlanesError: string | null;
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
}

export function createTourViewerSession(): TourViewerSession {
  return {
    session: null,
    currentLevels: null,
    openGeneration: 0,
    qrController: null,
    qrDebugView: null,
    cameraFrameCount: 0,
    levelByText: new Map(),
    lastDetectedText: null,
    activeSizeM: AUTHOR_DEFAULT_SIZE_M,
    authorErrorText: null,
    gpsSamplesAtSessionStart: 0,
    mintedCodeId: null,
    viewerQrStatus: null,
    viewerUnknownCode: null,
    viewerUnusableCode: null,
    viewerVotedLocks: 0,
    viewerLockedText: null,
    viewerReprojectionPx: null,
    latestReprojectionPx: null,
    placement: { kind: "idle" },
    viewerPlanesError: null,
    imagePlanes: null,
    imagePlanesLoading: false,
    planesRunGeneration: 0,
    placementUnsubscribe: null,
    placementAttempted: false,
    joinDeclined: false,
  };
}
