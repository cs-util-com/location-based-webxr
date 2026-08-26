/**
 * App shell: wires the `?qr=` launch dispatch, the paste-a-link form, the
 * streaming session, the live stats panel and the progressive gallery
 * together. All policy lives in the framework (`openRemoteArchive`) and the
 * colocated view-model modules; this file is the thin DOM layer the e2e
 * suite drives.
 */

import {
  createEnableGpsArController,
  getCurrentArPose,
  type EnableGpsArState,
} from "gps-plus-slam-app-framework/ar";
import {
  clearAllQrMarkers,
  createGpsPositionHandler,
  createSlamAppStore,
  qrDetectedReducer,
  recordGpsEvent,
  recordQrDetection,
  replayActions,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectQrPoseStability,
  selectStableQrPose,
  selectZeroReference,
  updateDeviceOrientation,
} from "gps-plus-slam-app-framework/state";
import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  BoundedLocalCacheStore,
  CacheApiStore,
  NullStorageBackend,
  OpenRemoteArchiveError,
  type LocalCacheStore,
} from "gps-plus-slam-app-framework/storage";

import { authorModeEnabledFromSearch } from "./author-mode-flag.js";
import {
  arButtonView,
  buildArEnableConfig,
  endTourArRuntime,
  startTourArRuntime,
} from "./ar-mode.js";
import {
  AUTHOR_DEFAULT_SIZE_M,
  authorStatusLine,
  buildAuthorControllerConfig,
  mintAuthorLevel,
  type AuthorAlignmentInfo,
} from "./qr-author-mode.js";
import {
  buildViewerControllerConfig,
  imagePlaneRingNue,
  viewerStatusLine,
} from "./qr-viewer-mode.js";
import QRCode from "qrcode";
import { homePrintWarning, planPrintCode, printedSideCss } from "./qr-print.js";
import { codeFromDetectedText, codeFromSearch } from "./code-param.js";
import {
  placeCapturedImagePlanes,
  placeImagePlanes,
  type PlacedImagePlanes,
} from "./image-planes.js";
import {
  assessReplayedJoin,
  computeCaptureGeoJoin,
  preflightCaptureJoin,
  type ReplayedJoinState,
} from "./capture-geo-join.js";
import type { Texture } from "three";
import type { QrTrackingStatus } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { getSeams } from "./seams.js";
import { resolveQrPayload } from "./qr-launch-dispatch.js";
import { toStatsView } from "./stats-view.js";
import { openTourSession, type TourSession } from "./tour-session.js";

/** Bare-name `?qr=` payloads resolve under this prefix — the convention the
 *  QR builder's `defaultAssetPrefix` example documents. */
const DEFAULT_ASSET_PREFIX =
  "https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/";

/** Keep at most this many archives cached (LRU) — see BoundedLocalCacheStore. */
const MAX_CACHED_ARCHIVES = 5;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
}

const linkInput = element<HTMLInputElement>("link");
const openButton = element<HTMLButtonElement>("open");
const clearCacheButton = element<HTMLButtonElement>("clear-cache");
const statsPanel = element<HTMLDivElement>("stats");
const statsHeadline = element<HTMLDivElement>("stats-headline");
const statsDetail = element<HTMLDivElement>("stats-detail");
const errorBox = element<HTMLDivElement>("error");
const gallery = element<HTMLUListElement>("gallery");
const arRoot = element<HTMLElement>("ar-root");
const arStatus = element<HTMLDivElement>("ar-status");
const enterArButton = element<HTMLButtonElement>("enter-ar");

/** The site worker's Drive CORS proxy (drive-proxy plan, 2026-08-26):
 *  keyless Drive links 403 real browser fetches, so they rewrite to this
 *  route. Absolute on purpose — production is same-origin with it, and dev
 *  servers (localhost, LAN, ngrok) are on the worker's CORS allowlist, so
 *  one value serves both. */
const DRIVE_PROXY_BASE_URL = "https://gps.csutil.com/api/drive-proxy";

// `?nocache=1` disables the local copy entirely — the pure-streaming mode the
// e2e suite uses to prove range reads alone can render the gallery, and a
// handy demo mode for showing the raw transport.
const cacheDisabled =
  new URLSearchParams(location.search).get("nocache") === "1";
const cacheStore: LocalCacheStore | undefined =
  cacheDisabled || typeof caches === "undefined"
    ? undefined
    : new BoundedLocalCacheStore(new CacheApiStore(), MAX_CACHED_ARCHIVES);

let session: TourSession | null = null;
/** The open tour's authored QR levels — the viewer pipeline's level source. */
let currentLevels: ReadonlyMap<string, QrLevel> | null = null;
let objectUrls: string[] = [];
/** Bumped per open; a slower open that finishes after a newer one started
 *  must close itself instead of clobbering the newer session. */
let openGeneration = 0;

/** True for the URLs whose open failures are Drive's to explain: the share
 *  page, the raw download host, and the site worker's proxy route. */
function isDriveUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.href);
    return (
      parsed.hostname === "drive.google.com" ||
      parsed.hostname === "drive.usercontent.google.com" ||
      parsed.pathname.endsWith("/api/drive-proxy")
    );
  } catch {
    return false;
  }
}

function describeOpenError(err: unknown, url?: string): string {
  if (err instanceof OpenRemoteArchiveError) {
    switch (err.rejectCause) {
      case "missing":
        return "That file does not exist (the link may have expired or been deleted).";
      case "corrupt":
        return "The file exists but is empty or not a readable archive.";
      case "cors":
        return (
          "The host refused the browser access (network down, or the host blocks cross-site reads).\n" +
          "Note: Google Drive links go through the site's proxy automatically — for other hosts the file must allow cross-site reads."
        );
      default:
        // A Drive link refused with a non-404 (e.g. the proxy's 400 for a
        // malformed id, or Drive refusing a non-public file) would
        // otherwise read as the generic archive error and hide the actual
        // cause (drive-proxy plan Rev 2, review finding 12).
        if (url !== undefined && isDriveUrl(url)) {
          return "Google Drive refused that file — check that the file is shared publicly (“Anyone with the link”) and the link carries a valid file id.";
        }
        return "That link cannot be opened as an archive.";
    }
  }
  return err instanceof Error ? err.message : String(err);
}

async function teardownSession(): Promise<void> {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  gallery.replaceChildren();
  // The viewer pipeline's level source and the placed planes belong to the
  // closing tour — a newly opened tour must not relocalize against them.
  currentLevels = null;
  // Same cache: the closed tour's levels must stop voting (M4 review #1).
  qrController?.reset();
  imagePlanes?.dispose();
  imagePlanes = null;
  // Clear the latch HERE too (PR #367 review): the stale run's finally is
  // generation-guarded and cannot clear it any more, and a latched
  // imagePlanesLoading blocks every later placement in the session.
  imagePlanesLoading = false;
  planesRunGeneration += 1; // invalidate any in-flight placement run
  if (session !== null) {
    const closing = session;
    session = null;
    await closing.close().catch(() => undefined);
  }
}

function renderStats(): void {
  if (session === null) return;
  // stats().origin tracks the LATEST read, so the label flips to "serving
  // from cache" once the warm download swaps the session over —
  // archive.origin is only the initial state (PR #357 review).
  const stats = session.stats();
  const view = toStatsView(stats, session.archive.size, stats.origin);
  statsPanel.hidden = false;
  statsHeadline.textContent = view.headline;
  statsDetail.textContent = view.detail;
}

/** Sequentially stream image entries into the gallery — each image pops in
 *  as its bytes arrive, which is the visible proof of range streaming. */
async function fillGallery(current: TourSession): Promise<void> {
  for (const entry of current.entries) {
    if (session !== current) return; // a newer open superseded this one
    const item = document.createElement("li");
    const caption = document.createElement("figcaption");
    caption.textContent = `${entry.filename} (${String(entry.size)} B)`;
    if (entry.isImage) {
      try {
        const blob = await current.loadEntry(entry.filename);
        if (session !== current) return;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const img = document.createElement("img");
        img.src = url;
        img.alt = entry.filename;
        item.append(img);
      } catch {
        // A rejection landing after a newer open replaced the gallery must
        // not append an old archive's caption to it (PR #357 review).
        if (session !== current) return;
        caption.textContent = `${entry.filename} — failed to load`;
      }
    }
    item.append(caption);
    gallery.append(item);
    renderStats();
  }
}

async function openUrl(url: string): Promise<void> {
  const generation = ++openGeneration;
  errorBox.textContent = "";
  // Async-UI rule: the in-progress state engages BEFORE the first await —
  // teardown of a previous session is async, and a second submission landing
  // in that window used to race the button state (PR #357 review).
  openButton.disabled = true;
  openButton.textContent = "Opening…";
  try {
    // INSIDE the try (PR #365 review): a throw from the previous session's
    // teardown (controller reset, three.js disposals) otherwise rejected
    // openUrl before the catch/finally existed — the button stayed
    // "Opening…" forever and the error surfaced nowhere.
    await teardownSession();
    const opened = await openTourSession(url, {
      ...(cacheStore !== undefined ? { cacheStore } : {}),
      corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
      onStats: () => {
        renderStats();
      },
    });
    if (generation !== openGeneration) {
      // A newer open superseded this one while it was in flight (e.g. a
      // click racing the ?qr= boot) — the loser cleans itself up.
      await opened.close().catch(() => undefined);
      return;
    }
    session = opened;
    renderStats();
    void fillGallery(opened);
    // The open tour's hosting URL is what a creator prints — prefill the
    // panel without clobbering something they typed.
    if (authorMode && printUrlInput.value.trim() === "") {
      printUrlInput.value = url;
    }
    // The authored levels ride the same zip; a newer open's guard keeps a
    // slow load from installing a closed tour's levels.
    void opened.loadQrLevels().then((levels) => {
      if (session !== opened) return;
      currentLevels = levels;
      // The controller caches a level (or the negative-cache placeholder)
      // per decoded text; levels arriving AFTER a scan would otherwise be
      // invisible until AR re-entry (M4 milestone review #1).
      qrController?.reset();
      viewerUnknownCode = null;
      viewerUnusableCode = null;
      viewerPlanesError = null;
      viewerPlanesInfo = null;
      renderArStatus();
    });
  } catch (err) {
    if (generation === openGeneration) {
      errorBox.textContent = describeOpenError(err, url);
    }
  } finally {
    // Guarded like every other effect in this function: a superseded open's
    // finally must not undo the newer open's in-progress state (PR #357
    // review).
    if (generation === openGeneration) {
      openButton.disabled = false;
      openButton.textContent = "Open";
    }
  }
}

element<HTMLFormElement>("open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = linkInput.value.trim();
  if (url !== "") void openUrl(url);
});

// Without a cache there is nothing to clear — a dead button would just
// confuse; hide it (e.g. ?nocache=1, or a browser without the Cache API).
if (!(cacheStore instanceof BoundedLocalCacheStore)) {
  clearCacheButton.hidden = true;
}
clearCacheButton.addEventListener("click", () => {
  if (!(cacheStore instanceof BoundedLocalCacheStore)) return;
  clearCacheButton.disabled = true;
  clearCacheButton.textContent = "Clearing…";
  // The open session's warm (or range-ignore recovery) download persists on
  // completion, so clearing around it would report "Cache cleared" and then
  // watch the store silently repopulate in the background (PR #358 review
  // #1). `evict()` is self-sufficient — it awaits both in-flight writers
  // before deleting — so evict-then-clear settles only once the store is
  // durably empty.
  const settleSessionWriters =
    session !== null ? session.archive.evict() : Promise.resolve();
  void settleSessionWriters
    .then(() => cacheStore.clear())
    .then(
      () => {
        clearCacheButton.disabled = false;
        clearCacheButton.textContent = "Cache cleared";
      },
      (err: unknown) => {
        // Async-UI rule: a failure must surface and the in-progress state must
        // revert — the old version reported "Cache cleared" either way.
        clearCacheButton.disabled = false;
        clearCacheButton.textContent = "Clear cache";
        errorBox.textContent = `Clearing the cache failed: ${err instanceof Error ? err.message : String(err)}`;
      },
    );
});

// --- AR foundation (QR-pose plan M2): both modes share one AR entry -------
// Author mode (`?author=1`) is read once at boot; switching is a page reload
// (the controller refuses enable() while a session runs). The seams resolve
// to the real framework device wiring in production and to the e2e fakes in
// a DEV Playwright run.
const authorMode = authorModeEnabledFromSearch(location.search);
/** The page's own &c= launch code — the ONE fallback every code lookup
 *  shares (PR #361 review: three sites resolving with different fallbacks
 *  meant votes flowed under "7" while the marker and the image ring
 *  looked up "1" and never appeared). */
const pageCode = codeFromSearch(location.search);
const seams = getSeams();
const arStore = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
  // The qrDetected slice is opt-in; both modes need it (author: stability
  // gate for minting; viewer M4: relocalization votes read the same window).
  extraReducers: { qrDetected: qrDetectedReducer },
});
const gpsHandler = createGpsPositionHandler({
  store: arStore,
  getArPose: getCurrentArPose,
});
const arController = createEnableGpsArController(seams.controllerDeps);
let cameraFrameCount = 0;

// --- Author mode (QR-pose plan M3) ---------------------------------------
// The author panel exists only under ?author=1; its tracking controller is
// (re)created per AR entry so the printed-size input is captured once at
// start (changing it means exit + re-enter — cheap, and honest about what
// the synthetic level actually carried).
const authorPanel = element<HTMLElement>("author-panel");
const authorSizeInput = element<HTMLInputElement>("author-size");
const authorCInput = element<HTMLInputElement>("author-c");
const authorStatus = element<HTMLDivElement>("author-status");
const mintButton = element<HTMLButtonElement>("mint-export");
const authorJsonBox = element<HTMLTextAreaElement>("author-json");
const authorCopyButton = element<HTMLButtonElement>("author-copy");
const authorDownloadButton = element<HTMLButtonElement>("author-download");
const authorHint = element<HTMLParagraphElement>("author-hint");

authorPanel.hidden = !authorMode;
authorSizeInput.value = String(AUTHOR_DEFAULT_SIZE_M);
if (authorMode) {
  // Alignment arrives via GPS dispatches, not via controller state — the
  // readout must follow the store, or "waiting for GPS alignment" sticks.
  arStore.subscribe(() => {
    renderAuthorReadout();
  });
}

let qrController: ReturnType<typeof createQrTrackingController> | null = null;
/** The most recently detected code — the one the stability gate tracks. */
let lastDetectedText: string | null = null;
/** The printed size CAPTURED at AR entry — the size the solves actually
 *  used; the input is disabled while running (milestone review #3). */
let activeSizeM = AUTHOR_DEFAULT_SIZE_M;
/** A persistent pipeline error (no detector, controller failure) — shown
 *  with priority so store updates cannot clobber it (milestone review #5). */
let authorErrorText: string | null = null;
/** The in-scene glue check (axis+cube on the code) — the one check a human
 *  at the poster can perform; spread alone is precision, not accuracy
 *  (milestone review #8). */
let qrDebugView: ReturnType<typeof seams.createQrDebugView> | null = null;

/** GPS-fix count snapshot taken when THIS session's runtime started: the
 *  gpsData slice has no reset, so the lifetime count would re-open the mint
 *  gate instantly on a re-entry over an alignment blended across two odom
 *  origins (PR #360 review). Only fixes since the snapshot count. */
let gpsSamplesAtSessionStart = 0;

function authorAlignmentInfo(): AuthorAlignmentInfo {
  const state = arStore.getState();
  const accuracy = state.gpsData?.gpsEvents?.gpsAccuracyMedian;
  const sinceSessionStart = Math.max(
    0,
    selectGpsPositions(state).length - gpsSamplesAtSessionStart,
  );
  return {
    hasMatrix: selectAlignmentMatrix(state) !== null,
    sampleCount: sinceSessionStart,
    ...(typeof accuracy === "number" ? { gpsAccuracyM: accuracy } : {}),
  };
}

function renderAuthorReadout(): void {
  if (!authorMode) return;
  if (authorErrorText !== null) {
    authorStatus.textContent = authorErrorText;
    mintButton.disabled = true;
    return;
  }
  const state = arStore.getState();
  const stability =
    lastDetectedText === null
      ? null
      : selectQrPoseStability(state, lastDetectedText);
  const readout = authorStatusLine(
    lastDetectedText,
    stability,
    authorAlignmentInfo(),
  );
  authorStatus.textContent = readout.text;
  mintButton.disabled = !readout.canMint;
}

function startAuthorPipeline(): boolean {
  authorErrorText = null;
  // Validate BEFORE starting anything: a cleared number input yields 0, the
  // min attribute never fires outside a form, and the resulting RangeError
  // used to unwind into the generic error box — the surface the author is
  // not looking at (PR #360 review).
  const parsedSize = Number(authorSizeInput.value);
  if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
    authorErrorText =
      "Enter the printed code's side length in metres (e.g. 0.2) before starting.";
    renderAuthorReadout();
    return false;
  }
  activeSizeM = parsedSize;
  const frontEnd = seams.createQrFrontEnd();
  if (frontEnd === null) {
    authorErrorText =
      "This browser has no QR detector (BarcodeDetector) — use Android Chrome to author.";
    renderAuthorReadout();
    return false;
  }
  qrController = createQrTrackingController(
    buildAuthorControllerConfig(activeSizeM, {
      frontEnd,
      solvePose: (input) => seams.solveQrPose(input),
      getCameraPose: () => seams.getCameraPose(),
      getIntrinsics: (image) => seams.getIntrinsics(image),
      recordDetection: (event) => {
        authorErrorText = null; // a live detection supersedes a stale error
        lastDetectedText = event.text;
        arStore.dispatch(recordQrDetection(event));
        qrDebugView?.update(event.qrPoseWorld, activeSizeM);
        renderAuthorReadout();
      },
      onError: (message) => {
        authorErrorText = `QR tracking failed: ${message}`;
        renderAuthorReadout();
      },
    }),
  );
  renderAuthorReadout();
  return true;
}

// --- Viewer mode (QR-pose plan M4) ----------------------------------------
// The default passerby flow: scanned codes relocalize the session via
// budgeted synthetic GPS votes, the glue marker rides the detections, and
// the first voted lock places a ring of the tour's images around the code.
let viewerQrStatus: QrTrackingStatus | null = null;
let viewerUnknownCode: string | null = null;
let viewerUnusableCode: string | null = null;
let viewerVotedLocks = 0;
let viewerLockedText: string | null = null;
let viewerReprojectionPx: number | null = null;
/** A failed image-plane placement, surfaced in the AR status line —
 *  `#error-box` is a sibling of `#ar-root` and invisible during the
 *  session (the milestone-review-#4 trap; PR #366 review). */
let viewerPlanesError: string | null = null;
/** What the photo placement actually did — capture spots with quality, or
 *  the ring with the join's plain-words decline reason. A silent decline
 *  is the failure mode; this line is its visibility. */
let viewerPlanesInfo: string | null = null;
/** Last detection's RMS reprojection error — the on-device quality number. */
let latestReprojectionPx: number | null = null;
/** In-flight guard: without it every voted lock during the decode window
 *  started ANOTHER placement run (M4 milestone review #4). */
let imagePlanesLoading = false;
let imagePlanes: PlacedImagePlanes | null = null;
/** Bumped on session end and tour teardown: an in-flight placement run
 *  captures the value and every post-await step re-checks it — a run its
 *  session outlived frees its textures instead of planting planes into a
 *  dead scene (milestone review, finding 6). */
let planesRunGeneration = 0;

function viewerQrLine(): string {
  if (authorMode) return "";
  return viewerStatusLine({
    status: viewerQrStatus,
    unknownCode: viewerUnknownCode,
    unusableCode: viewerUnusableCode,
    votedLocks: viewerVotedLocks,
    lockedText: viewerLockedText,
    reprojectionErrorPx: viewerReprojectionPx,
  });
}

/** Levels are only useful with an open tour; the viewer pipeline reads them
 *  live so a tour opened AFTER entering AR still resolves. */
function startViewerPipeline(): boolean {
  const frontEnd = seams.createQrFrontEnd();
  if (frontEnd === null) {
    // Viewing without a detector still works as plain AR — no error state,
    // the QR line just never appears.
    return false;
  }
  qrController = createQrTrackingController(
    buildViewerControllerConfig({
      pageCode,
      frontEnd,
      solvePose: (input) => seams.solveQrPose(input),
      getCameraPose: () => seams.getCameraPose(),
      getIntrinsics: (image) => seams.getIntrinsics(image),
      getLevels: () => currentLevels,
      dispatchVote: (payload) => {
        arStore.dispatch(recordGpsEvent(payload));
      },
      // recordGpsEvent silently no-ops until the session zero exists — the
      // budget must not be charged for dropped votes (M4 review #2).
      canAcceptVotes: () => arStore.getState().gpsData !== null,
      // The same convergence gate minting uses (M4 review #3): the
      // controller skips the vote — budget untouched — while null.
      resolveStablePose: (text) => selectStableQrPose(arStore.getState(), text),
      recordDetection: (event) => {
        viewerUnknownCode = null; // a level-carrying detection supersedes it
        viewerUnusableCode = null;
        latestReprojectionPx = event.reprojectionErrorPx;
        arStore.dispatch(recordQrDetection(event));
        const level = currentLevels?.get(
          codeFromDetectedText(event.text, pageCode),
        );
        qrDebugView?.update(event.qrPoseWorld, level?.qr.physicalSizeM ?? null);
      },
      onError: (message) => {
        errorBox.textContent = `QR tracking failed: ${message}`;
      },
      onStatus: (status) => {
        viewerQrStatus = status;
        renderArStatus();
      },
      onUnknownCode: (code) => {
        viewerUnknownCode = code;
        renderArStatus();
      },
      onUnusableLevel: (code) => {
        viewerUnusableCode = code;
        renderArStatus();
      },
      onVotedLock: (text, votedLocks) => {
        viewerLockedText = text;
        viewerVotedLocks = votedLocks;
        viewerReprojectionPx = latestReprojectionPx;
        if (imagePlanes === null && !imagePlanesLoading) {
          // The one fire-and-forget that had no .catch (PR #366 review): a
          // throw below the loader's try/finally rejected unhandled inside
          // an ~8 Hz detection callback — the visitor saw "Relocalized"
          // with no ring and no error.
          void placeTourImagePlanes(text).catch((err: unknown) => {
            // The archive URL is known here — a Drive failure during plane
            // loading deserves the Drive-specific message too (milestone
            // review, finding 7).
            viewerPlanesError = describeOpenError(err, session?.archive.url);
            renderArStatus();
          });
        }
        renderArStatus();
      },
    }),
  );
  return true;
}

/** QD-3's payoff, once per session — now capture-first (geo-join plan
 *  Rev 2): photos at their CAPTURE positions when the recording supports
 *  it, the ring around the code otherwise. Either way at the SCENE ROOT
 *  in raw GPS-world NUE. */
async function placeTourImagePlanes(lockedText: string): Promise<void> {
  const current = session;
  const scene = seams.getScene();
  const zero = selectZeroReference(arStore.getState());
  const geo = currentLevels?.get(codeFromDetectedText(lockedText, pageCode))?.qr
    .geo;
  if (current === null || scene === null || zero === null || geo === undefined)
    return;
  const centerNue = calcRelativeCoordsInMeters(
    zero,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  const centerTuple: [number, number, number] = [
    centerNue[0],
    centerNue[1],
    centerNue[2],
  ];
  imagePlanesLoading = true;
  const generation = planesRunGeneration;
  try {
    // A join failure is a taxonomy entry, not a dead end (milestone review,
    // finding 2): whatever the replay/compute throws, the visitor still
    // gets the ring, with the failure visible in the status line.
    let joined = false;
    try {
      joined = await placeJoinedCapturePlanes(current, scene, zero, generation);
    } catch (err) {
      viewerPlanesInfo = `photo ring (reading the recording failed: ${
        err instanceof Error ? err.message : String(err)
      })`;
    }
    if (!joined && generation === planesRunGeneration) {
      await placeDecodedPlanes(current, scene, centerTuple);
    }
  } finally {
    // Only the run that still owns the latch may clear it — a stale run's
    // finally must not clobber a successor's in-progress state (milestone
    // review, finding 6).
    if (generation === planesRunGeneration) imagePlanesLoading = false;
  }
}

/**
 * The capture-time geo join's viewer glue (lazy — this runs only once the
 * code relocalized): gates → chunked replay → per-capture placement.
 * Returns false whenever the ring should be placed instead; the reason
 * lands in the AR status line so a decline is visible, never silent.
 */
async function placeJoinedCapturePlanes(
  current: TourSession,
  scene: NonNullable<ReturnType<typeof seams.getScene>>,
  viewerZero: { lat: number; lon: number },
  generation: number,
): Promise<boolean> {
  const [meta, actions] = await Promise.all([
    current.loadSessionMeta(),
    current.loadRecordingActions(),
  ]);
  if (actions === null) {
    viewerPlanesInfo = "photo ring (no recording in this tour)";
    return false;
  }
  const pre = preflightCaptureJoin(
    meta,
    actions.map((a) => a.type),
  );
  if (!pre.ok) {
    viewerPlanesInfo = `photo ring (${pre.reason})`;
    return false;
  }
  const state = (await replayActions(actions, {
    onChunk: (done, total) => {
      if (generation !== planesRunGeneration) return;
      viewerPlanesInfo = `reading the walk ${String(done)}/${String(total)}…`;
      renderArStatus();
    },
  })) as unknown as ReplayedJoinState;
  const verdict = assessReplayedJoin(state);
  if (!verdict.ok) {
    viewerPlanesInfo = `photo ring (${verdict.reason})`;
    return false;
  }
  const paired = await decodeJoinedPoses(
    current,
    computeCaptureGeoJoin(state),
    viewerZero,
    generation,
  );
  // Re-checked AFTER the awaits — same bail contract as the ring path
  // (M4 milestone review #4) plus the GENERATION token (finding 6): every
  // loser frees its textures, and a run the session outlived must not
  // plant planes into a dead scene.
  if (
    paired.length === 0 ||
    generation !== planesRunGeneration ||
    imagePlanes !== null ||
    session !== current ||
    qrController === null
  ) {
    for (const entry of paired) entry.texture.dispose();
    if (paired.length === 0 && generation === planesRunGeneration) {
      viewerPlanesInfo = "photo ring (no readable capture photos)";
    }
    return paired.length === 0 ? false : true;
  }
  imagePlanes = placeCapturedImagePlanes({
    scene,
    poses: paired,
    textures: paired.map((entry) => entry.texture),
  });
  // HONEST label (finding 5): the replayed state exposes no solve-error
  // metric (meanAlignmentError is model-internal), so the line reports
  // what the numbers actually are — fixes and their median GPS accuracy —
  // never a claimed placement error.
  const accuracy =
    verdict.quality.gpsAccuracyMedianM === null
      ? ""
      : `, median GPS ±${verdict.quality.gpsAccuracyMedianM.toFixed(1)}m`;
  viewerPlanesInfo =
    `${String(imagePlanes.count)} photos at capture spots ` +
    `(${String(verdict.quality.pairCount)} fixes${accuracy})`;
  renderArStatus();
  return true;
}

/** The display downscale for capture planes — the framework decoder's
 *  documented OOM mitigation (the recorder defaults to 2 for the same
 *  reason): D4 places ALL captures, and full-res textures for a long walk
 *  are a GPU-memory hazard the owner's decision did not include
 *  (milestone review, finding 4). */
const CAPTURE_PLANE_DECODE_DIVISOR = 2;

/** Decode each joined capture's photo and express its geo in the VIEWER's
 *  NUE frame; a broken image just leaves that capture out. The geo
 *  conversion runs BEFORE the decode so a conversion throw cannot leak an
 *  already-decoded texture (finding 7), and the decode — the slowest
 *  phase — reports progress (finding 4's async-UI half). */
async function decodeJoinedPoses(
  current: TourSession,
  poses: readonly ReturnType<typeof computeCaptureGeoJoin>[number][],
  viewerZero: { lat: number; lon: number },
  generation: number,
): Promise<
  {
    positionNue: readonly [number, number, number];
    rotationNue: readonly [number, number, number, number];
    texture: Texture;
  }[]
> {
  const paired: {
    positionNue: readonly [number, number, number];
    rotationNue: readonly [number, number, number, number];
    texture: Texture;
  }[] = [];
  let index = 0;
  for (const pose of poses) {
    index += 1;
    // A bumped token means the session ended or a newer run won: STOP
    // decoding into a dead scene (PR #367 review — noticing the token
    // only for the status text kept burning tens of seconds of decode +
    // GPU uploads the caller would immediately dispose).
    if (generation !== planesRunGeneration) break;
    viewerPlanesInfo = `loading photos ${String(index)}/${String(poses.length)}…`;
    renderArStatus();
    try {
      const nue = calcRelativeCoordsInMeters(
        viewerZero,
        { lat: pose.geo.lat, lon: pose.geo.lon },
        pose.geo.altitude,
        0,
      );
      const texture = await decodeFrameTexture(
        await current.loadEntry(pose.imageFile),
        CAPTURE_PLANE_DECODE_DIVISOR,
      );
      if (texture === null) continue;
      paired.push({
        positionNue: [nue[0], nue[1], nue[2]],
        rotationNue: pose.rotationNue,
        texture,
      });
    } catch {
      // A broken image (or a degenerate geo) just leaves that capture out.
    }
  }
  return paired;
}

async function placeDecodedPlanes(
  current: TourSession,
  scene: NonNullable<ReturnType<typeof seams.getScene>>,
  centerNue: readonly [number, number, number],
): Promise<void> {
  const textures = await decodeTourTextures(current);
  // Re-checked AFTER the awaits: the tour may have closed, the AR session
  // may have ended (qrController is nulled then), or a sibling run may have
  // won — every bail path must FREE its textures, not leak them (M4
  // milestone review #4).
  if (
    textures.length === 0 ||
    imagePlanes !== null ||
    session !== current ||
    qrController === null
  ) {
    for (const texture of textures) texture.dispose();
    return;
  }
  imagePlanes = placeImagePlanes({
    scene,
    positionsNue: imagePlaneRingNue(centerNue, textures.length),
    textures,
    centerNue,
  });
  renderArStatus();
}

/** First three streamed images → upright textures; a broken image just
 *  leaves a gap in the ring. */
async function decodeTourTextures(current: TourSession): Promise<Texture[]> {
  const textures: Texture[] = [];
  for (const entry of current.entries
    .filter((candidate) => candidate.isImage)
    .slice(0, 3)) {
    try {
      const texture = await decodeFrameTexture(
        await current.loadEntry(entry.filename),
      );
      if (texture !== null) textures.push(texture);
    } catch {
      // A broken image just leaves a gap in the ring.
    }
  }
  return textures;
}

// --- Print a code (creator step zero, owner-requested 2026-08-26) ---------
const printUrlInput = element<HTMLInputElement>("print-url");
const printGenerateButton = element<HTMLButtonElement>("print-generate");
const printInfo = element<HTMLDivElement>("print-info");
const printArea = element<HTMLDivElement>("print-area");
const printCanvas = element<HTMLCanvasElement>("print-canvas");
const printButton = element<HTMLButtonElement>("print-button");
const printUrlOut = element<HTMLDivElement>("print-url-out");

printGenerateButton.addEventListener("click", () => {
  // Async-UI rule: in-progress before the awaits, durable end state after.
  printGenerateButton.disabled = true;
  printGenerateButton.textContent = "Generating…";
  generatePrintCode()
    .catch((err: unknown) => {
      printInfo.textContent = err instanceof Error ? err.message : String(err);
      printArea.hidden = true;
      printButton.hidden = true;
    })
    .finally(() => {
      printGenerateButton.disabled = false;
      printGenerateButton.textContent = "Generate QR";
    });
});

async function generatePrintCode(): Promise<void> {
  const sideCss = printedSideCss(Number(authorSizeInput.value)); // validates
  const c = authorCInput.value.trim() === "" ? "1" : authorCInput.value.trim();
  const plan = await planPrintCode(printUrlInput.value.trim(), c);
  // margin 0: the canvas carries the SYMBOL only — the printed side equals
  // the size the author types when minting; the quiet zone is CSS padding.
  await QRCode.toCanvas(printCanvas, plan.url, {
    errorCorrectionLevel: "Q",
    margin: 0,
    scale: 8,
  });
  document.documentElement.style.setProperty("--print-side", sideCss);
  printArea.hidden = false;
  printButton.hidden = false;
  // The page-fit warning rides IN #print-info, not a separate channel: it
  // must be read in the same glance as the "100% scale" instruction whose
  // combination with an oversized symbol clips the code (PR #364 review).
  const warning = homePrintWarning(Number(authorSizeInput.value));
  printInfo.textContent =
    `QR version ${String(plan.qrVersion)}, code ${c}, prints at ${sideCss} — ` +
    `use 100% scale (no fit-to-page).` +
    (warning === null ? "" : ` ${warning}`);
  printUrlOut.textContent = plan.url;
}

printButton.addEventListener("click", () => {
  window.print();
});

mintButton.addEventListener("click", () => {
  if (lastDetectedText === null) return;
  const state = arStore.getState();
  const stablePose = selectStableQrPose(state, lastDetectedText);
  if (stablePose === null) return; // the gate lost stability since render
  const result = mintAuthorLevel({
    stablePose,
    alignmentMatrix: selectAlignmentMatrix(state),
    zero: selectZeroReference(state),
    alignment: authorAlignmentInfo(),
    sizeM: activeSizeM,
    nowIso: new Date().toISOString(),
  });
  if (!result.ok) {
    // Inside the DOM-overlay root — errorBox is a sibling of #ar-root and
    // therefore INVISIBLE during the AR session (milestone review #4).
    authorStatus.textContent = result.error;
    return;
  }
  authorJsonBox.value = result.json;
  authorJsonBox.hidden = false;
  authorCopyButton.hidden = false;
  authorDownloadButton.hidden = false;
  authorHint.hidden = false;
});

authorCopyButton.addEventListener("click", () => {
  // Async-UI rule + the AnchorStarter label-revert guard: a second click
  // during the transient label must not capture it as the idle label.
  navigator.clipboard.writeText(authorJsonBox.value).then(
    () => {
      authorCopyButton.textContent = "Copied ✓";
      setTimeout(() => (authorCopyButton.textContent = "Copy JSON"), 2000);
    },
    () => {
      authorCopyButton.textContent = "Copy failed — select the text above";
      setTimeout(() => (authorCopyButton.textContent = "Copy JSON"), 2000);
    },
  );
});

authorDownloadButton.addEventListener("click", () => {
  // Hidden-anchor download (the session-summary precedent). Browsers strip
  // path separators from `download`, so the file arrives as `<c>.json`; the
  // panel's hint tells the author to place it under `qr/` in the zip.
  const c = authorCInput.value.trim() === "" ? "1" : authorCInput.value.trim();
  const blob = new Blob([authorJsonBox.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${c}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

function renderArStatus(): void {
  const mode = authorMode ? "Author mode" : "Viewer mode";
  const status = arController.getState().status;
  if (status !== "running") {
    arStatus.textContent = `${mode} — ${status}`;
    return;
  }
  const qrLine = viewerQrLine();
  arStatus.textContent =
    `${mode} — AR running · ${String(cameraFrameCount)} camera frames` +
    (qrLine === "" ? "" : ` · ${qrLine}`) +
    (viewerPlanesInfo === null ? "" : ` · ${viewerPlanesInfo}`) +
    (viewerPlanesError === null
      ? ""
      : ` · images failed: ${viewerPlanesError}`);
}

function renderArState(state: EnableGpsArState): void {
  const view = arButtonView(state, authorMode);
  enterArButton.disabled = view.disabled;
  enterArButton.textContent = view.label;
  // The printed size is CAPTURED at AR entry (the solves use it) — editing
  // it mid-session would stamp a size the pose was never solved with
  // (milestone review #3).
  const sessionActive =
    state.status === "starting" ||
    state.status === "running" ||
    state.status === "stopping";
  authorSizeInput.disabled = sessionActive;
  renderArStatus();
}

async function enterAr(): Promise<void> {
  cameraFrameCount = 0;
  // A refused AUTHOR pipeline (bad size, no detector) keeps AR unstarted —
  // the message is already in the author panel, where the author is
  // looking. The viewer pipeline is best-effort: without a detector the
  // session is plain AR.
  if (authorMode && !startAuthorPipeline()) return;
  if (!authorMode) startViewerPipeline();
  const result = await arController.enable(
    buildArEnableConfig({
      container: arRoot,
      onFrame: (image) => {
        cameraFrameCount += 1;
        qrController?.offerFrame(image);
        renderArStatus();
      },
      onSessionEnd: () => {
        // Full teardown, not just capture stop: the AR entry is
        // re-enterable, and an open recording would blend the dead
        // session's odom frame into the next alignment (PR #359 review).
        // The QR window and its tracked text are session state too — a
        // re-entry must not mint from the dead session's odom-frame poses
        // (milestone review #2).
        qrController = null;
        qrDebugView?.dispose();
        qrDebugView = null;
        lastDetectedText = null;
        authorErrorText = null;
        imagePlanes?.dispose();
        imagePlanes = null;
        viewerQrStatus = null;
        viewerUnknownCode = null;
        viewerUnusableCode = null;
        viewerVotedLocks = 0;
        viewerLockedText = null;
        viewerReprojectionPx = null;
        viewerPlanesInfo = null;
        viewerPlanesError = null;
        imagePlanesLoading = false;
        // Invalidate any join still awaiting: it cannot be cancelled, but
        // every post-await guard checks this token, so a stale run frees
        // its textures instead of planting planes into a dead scene and
        // clobbering the next session's latch (milestone review, finding 6
        // — the join's tens-of-seconds decode turned this race from
        // theoretical into expected).
        planesRunGeneration += 1;
        arStore.dispatch(clearAllQrMarkers());
        endTourArRuntime(arStore, {
          stopCameraFrameCapture: () => {
            seams.stopCameraFrameCapture();
          },
        });
        renderArStatus();
        renderAuthorReadout();
      },
      onGpsPosition: (position) => {
        gpsHandler(position);
      },
      onOrientation: (orientation) => {
        updateDeviceOrientation(orientation);
      },
    }),
  );
  // Failure states surface via the subscribed button view (Retry — <reason>).
  if (!result.ok) return;
  const runtime = startTourArRuntime(arStore, {
    getArWorldGroup: () => seams.getArWorldGroup(),
    enableArWorldGroupAlignment: (options) =>
      seams.enableArWorldGroupAlignment(options),
    startCameraFrameCapture: (config) => {
      seams.startCameraFrameCapture(config);
    },
    now: Date.now,
  });
  if (!runtime.ok) {
    errorBox.textContent = runtime.error;
    await arController.disable();
    return;
  }
  // The world group exists only AFTER initAR built the scene graph —
  // creating the glue check earlier made it dead code in production
  // (PR #360 review). The snapshot for the alignment gate belongs to the
  // same moment: this session's fixes start counting now.
  gpsSamplesAtSessionStart = selectGpsPositions(arStore.getState()).length;
  // BOTH modes glue the marker to detections — the author's accuracy check
  // and the viewer's "it relocalized" proof are the same axis+cube.
  const worldGroup = seams.getArWorldGroup();
  if (worldGroup !== null) {
    qrDebugView = seams.createQrDebugView(worldGroup);
  }
  if (authorMode) renderAuthorReadout();
}

arController.subscribe(renderArState);
renderArState(arController.getState());
void arController.refreshSupport();
enterArButton.addEventListener("click", () => {
  // Defensive: enable() reports failures via its state machine, but a
  // rejection anywhere else (e.g. the rollback disable()) must reach the
  // error box, not die as an unhandled rejection.
  enterAr().catch((err: unknown) => {
    errorBox.textContent = describeOpenError(err);
  });
});

/** `?qr=` launch: the QR-scan entry path — resolve the payload and open. */
async function boot(): Promise<void> {
  const payload = new URLSearchParams(location.search).get("qr");
  if (payload === null) return;
  const url = await resolveQrPayload(payload, DEFAULT_ASSET_PREFIX);
  if (url === null) {
    errorBox.textContent = "This QR launch link carries an unreadable payload.";
    return;
  }
  linkInput.value = url;
  await openUrl(url);
}

// The QR launch is the one flow with no retry (a printed code) — an
// unexpected boot failure must reach the error box, not vanish in an
// unhandled rejection.
boot().catch((err: unknown) => {
  errorBox.textContent = describeOpenError(err);
});
