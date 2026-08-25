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
import { codeFromDetectedText } from "./code-param.js";
import { placeImagePlanes, type PlacedImagePlanes } from "./image-planes.js";
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

function describeOpenError(err: unknown): string {
  if (err instanceof OpenRemoteArchiveError) {
    switch (err.rejectCause) {
      case "missing":
        return "That file does not exist (the link may have expired or been deleted).";
      case "corrupt":
        return "The file exists but is empty or not a readable archive.";
      case "cors":
        return (
          "The host refused the browser access (network down, or the host blocks cross-site reads).\n" +
          "Note: key-less Google Drive links block browser fetches — Drive needs an API key or a CORS proxy."
        );
      default:
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
  imagePlanes?.dispose();
  imagePlanes = null;
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
  await teardownSession();
  try {
    const opened = await openTourSession(url, {
      ...(cacheStore !== undefined ? { cacheStore } : {}),
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
    // The authored levels ride the same zip; a newer open's guard keeps a
    // slow load from installing a closed tour's levels.
    void opened.loadQrLevels().then((levels) => {
      if (session === opened) currentLevels = levels;
    });
  } catch (err) {
    if (generation === openGeneration) {
      errorBox.textContent = describeOpenError(err);
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
let viewerVotedLocks = 0;
let viewerLockedText: string | null = null;
let imagePlanes: PlacedImagePlanes | null = null;

function viewerQrLine(): string {
  if (authorMode) return "";
  return viewerStatusLine({
    status: viewerQrStatus,
    unknownCode: viewerUnknownCode,
    votedLocks: viewerVotedLocks,
    lockedText: viewerLockedText,
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
      frontEnd,
      solvePose: (input) => seams.solveQrPose(input),
      getCameraPose: () => seams.getCameraPose(),
      getIntrinsics: (image) => seams.getIntrinsics(image),
      getLevels: () => currentLevels,
      dispatchVote: (payload) => {
        arStore.dispatch(recordGpsEvent(payload));
      },
      recordDetection: (event) => {
        viewerUnknownCode = null; // a level-carrying detection supersedes it
        arStore.dispatch(recordQrDetection(event));
        const level = currentLevels?.get(codeFromDetectedText(event.text));
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
      onVotedLock: (text, votedLocks) => {
        viewerLockedText = text;
        viewerVotedLocks = votedLocks;
        if (imagePlanes === null) void placeTourImagePlanes(text);
        renderArStatus();
      },
    }),
  );
  return true;
}

/** QD-3's payoff, once per session: a ring of the tour's images around the
 *  relocalized code, at the SCENE ROOT in raw GPS-world NUE. */
async function placeTourImagePlanes(lockedText: string): Promise<void> {
  const current = session;
  const scene = seams.getScene();
  const zero = selectZeroReference(arStore.getState());
  const geo = currentLevels?.get(codeFromDetectedText(lockedText))?.qr.geo;
  if (current === null || scene === null || zero === null || geo === undefined)
    return;
  const centerNue = calcRelativeCoordsInMeters(
    zero,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  const textures = await decodeTourTextures(current);
  if (textures.length === 0 || imagePlanes !== null || session !== current)
    return;
  imagePlanes = placeImagePlanes({
    scene,
    positionsNue: imagePlaneRingNue(
      [centerNue[0], centerNue[1], centerNue[2]],
      textures.length,
    ),
    textures,
    centerNue: [centerNue[0], centerNue[1], centerNue[2]],
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
    (qrLine === "" ? "" : ` · ${qrLine}`);
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
        viewerVotedLocks = 0;
        viewerLockedText = null;
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
