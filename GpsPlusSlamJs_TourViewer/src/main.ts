/**
 * Composition root (flows plan M6, executing the simplification plan's
 * M-1): looks the DOM up once, creates the store, the AR controller and the
 * seams, creates the ONE explicit session object (DEC-T6) and the late-bound
 * hooks, and wires the five concerns in dependency order:
 * print panel → author mode → viewer placement → AR entry → archive open.
 * No behaviour lives here; the e2e suite drives the composed page.
 */

import {
  createEnableGpsArController,
  getCurrentArPose,
} from "gps-plus-slam-app-framework/ar";
import { createGpsPositionHandler } from "gps-plus-slam-app-framework/state";
import {
  BoundedLocalCacheStore,
  CacheApiStore,
} from "gps-plus-slam-app-framework/storage";

import { wireArchiveOpen } from "./archive-open.js";
import { wireArEntry } from "./ar-entry.js";
import { wireAuthorMode } from "./author-mode.js";
import { authorModeEnabledFromSearch } from "./author-mode-flag.js";
import { describeOpenError } from "./open-errors.js";
import { wirePrintPanel } from "./print-panel.js";
import { getSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

/** Keep at most this many archives cached (LRU) — see BoundedLocalCacheStore. */
const MAX_CACHED_ARCHIVES = 5;

/** The site worker's Drive CORS proxy (drive-proxy plan, 2026-08-26):
 *  keyless Drive links 403 real browser fetches, so they rewrite to this
 *  route. Absolute on purpose — production is same-origin with it, and dev
 *  servers (localhost, LAN, ngrok) are on the worker's CORS allowlist, so
 *  one value serves both. */
const DRIVE_PROXY_BASE_URL = "https://gps.csutil.com/api/drive-proxy";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
}

const errorBox = element<HTMLDivElement>("error");

// `?nocache=1` disables the local copy entirely — the pure-streaming mode the
// e2e suite uses to prove range reads alone can render the gallery, and a
// handy demo mode for showing the raw transport.
const cacheDisabled =
  new URLSearchParams(location.search).get("nocache") === "1";
const cacheStore =
  cacheDisabled || typeof caches === "undefined"
    ? undefined
    : new BoundedLocalCacheStore(new CacheApiStore(), MAX_CACHED_ARCHIVES);

// Author mode (`?author=1`) is read once at boot; switching is a page reload
// (the controller refuses enable() while a session runs). The seams resolve
// to the real framework device wiring in production and to the e2e fakes in
// a DEV Playwright run.
const authorMode = authorModeEnabledFromSearch(location.search);
const seams = getSeams();
const arStore = createTourViewerStore();
const gpsHandler = createGpsPositionHandler({
  store: arStore,
  getArPose: getCurrentArPose,
});
const arController = createEnableGpsArController(seams.controllerDeps);
const ctx = createTourViewerSession();
const hooks = createUnwiredHooks();

const printPanel = element<HTMLDetailsElement>("print-panel");
const sizeInput = element<HTMLInputElement>("author-size");

const print = wirePrintPanel({
  panel: printPanel,
  urlInput: element("print-url"),
  sizeInput,
  codeInput: element("author-c"),
  generateButton: element("print-generate"),
  info: element("print-info"),
  area: element("print-area"),
  canvas: element("print-canvas"),
  printButton: element("print-button"),
  urlOut: element("print-url-out"),
});
hooks.presentTourForPrint = print.presentTour;

const author = wireAuthorMode({
  ctx,
  authorMode,
  arStore,
  seams,
  dom: {
    panel: element("author-panel"),
    sizeInput,
    printPanel,
    status: element("author-status"),
    mintButton: element("mint-export"),
    jsonBox: element("author-json"),
    copyButton: element("author-copy"),
    downloadButton: element("author-download"),
    hint: element("author-hint"),
  },
});
hooks.renderAuthorReadout = author.renderAuthorReadout;
hooks.startAuthorPipeline = author.startAuthorPipeline;

const viewer = createViewerPlacement({
  ctx,
  authorMode,
  arStore,
  arController,
  seams,
  errorBox,
  hooks,
});
hooks.startViewerPipeline = viewer.startViewerPipeline;
hooks.tryPlaceTour = viewer.tryPlaceTour;

const arEntry = wireArEntry({
  ctx,
  authorMode,
  arStore,
  arController,
  gpsHandler,
  seams,
  dom: {
    arRoot: element("ar-root"),
    arStatus: element("ar-status"),
    arHint: element("ar-hint"),
    enterArButton: element("enter-ar"),
    sizeInput,
    errorBox,
  },
  hooks,
});
hooks.renderArStatus = arEntry.renderArStatus;

const archive = wireArchiveOpen({
  ctx,
  dom: {
    form: element("open-form"),
    linkInput: element("link"),
    openButton: element("open"),
    statsPanel: element("stats"),
    statsHeadline: element("stats-headline"),
    statsDetail: element("stats-detail"),
    errorBox,
    gallery: element("gallery"),
    storagePanel: element("storage-panel"),
    clearCacheButton: element("clear-cache"),
  },
  cacheStore,
  corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
  hooks,
});

// The QR launch is the one flow with no retry (a printed code) — an
// unexpected boot failure must reach the error box, not vanish in an
// unhandled rejection.
archive.boot().catch((err: unknown) => {
  errorBox.textContent = describeOpenError(err);
});
