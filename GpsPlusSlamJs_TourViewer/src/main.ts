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
  createGpsPositionHandler,
  createSlamAppStore,
  updateDeviceOrientation,
} from "gps-plus-slam-app-framework/state";
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
  startTourArRuntime,
} from "./ar-mode.js";
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
});
const gpsHandler = createGpsPositionHandler({
  store: arStore,
  getArPose: getCurrentArPose,
});
const arController = createEnableGpsArController(seams.controllerDeps);
/** Foundation observable until M3 points the frames at the QR pipeline. */
let cameraFrameCount = 0;

function renderArStatus(): void {
  const mode = authorMode ? "Author mode" : "Viewer mode";
  const status = arController.getState().status;
  arStatus.textContent =
    status === "running"
      ? `${mode} — AR running · ${String(cameraFrameCount)} camera frames`
      : `${mode} — ${status}`;
}

function renderArState(state: EnableGpsArState): void {
  const view = arButtonView(state, authorMode);
  enterArButton.disabled = view.disabled;
  enterArButton.textContent = view.label;
  renderArStatus();
}

async function enterAr(): Promise<void> {
  cameraFrameCount = 0;
  const result = await arController.enable(
    buildArEnableConfig({
      container: arRoot,
      onFrame: () => {
        cameraFrameCount += 1;
        renderArStatus();
      },
      onSessionEnd: () => {
        seams.stopCameraFrameCapture();
        renderArStatus();
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
  }
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
