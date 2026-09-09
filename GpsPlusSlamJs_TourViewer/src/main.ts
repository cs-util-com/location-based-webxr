/**
 * Composition root (flows plan M6, executing the simplification plan's
 * M-1; the guided-setup plan M2 added the mode split): looks the DOM up
 * once, creates the store, the AR controller and the seams, creates the ONE
 * explicit session object (DEC-T6) and the late-bound hooks, and wires the
 * concerns in dependency order: print panel → wizard → visitor screen →
 * creator setup → viewer placement → AR entry → archive open. No behaviour
 * lives here; the e2e suite drives the composed page.
 */

import {
  createEnableGpsArController,
  getCurrentArPose,
} from "gps-plus-slam-app-framework/ar";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import { createGpsPositionHandler } from "gps-plus-slam-app-framework/state";
import {
  BoundedLocalCacheStore,
  CacheApiStore,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";

import { wireArchiveOpen } from "./archive-open.js";
import { wireArEntry } from "./ar-entry.js";
import { arSessionLive, wireCreatorSetup } from "./creator-setup.js";
import { viewerModeFromSearch } from "./mode.js";
import { describeOpenError } from "./open-errors.js";
import { wirePrintPanel } from "./print-panel.js";
import { getSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { wireVisitorScreen } from "./visitor-screen.js";
import { driveProxyBaseUrl } from "./drive-proxy-url.js";
import { stepStoreOrUndefined, wireWizard } from "./wizard.js";

/** Keep at most this many archives cached (LRU) — see BoundedLocalCacheStore. */
const MAX_CACHED_ARCHIVES = 5;

/** The site worker's Drive CORS proxy (drive-proxy plan, 2026-08-26):
 *  keyless Drive links 403 real browser fetches, so they rewrite to this
 *  route. Resolved per host rather than hard-coded: a branch preview is
 *  neither production nor a dev server, so the old single absolute URL
 *  made every preview call production cross-origin and be refused (F3,
 *  second testing session). See drive-proxy-url.ts. */
const DRIVE_PROXY_BASE_URL = driveProxyBaseUrl(location.hostname);

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

// The mode (DEC-N1) is read once at boot; switching is a page reload (the
// controller refuses enable() while a session runs). The seams resolve to
// the real framework device wiring in production and to the e2e fakes in a
// DEV Playwright run.
const mode = viewerModeFromSearch(location.search);
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
// Step 4. A <details> since the flow rework (F4), and the one whose body
// is the WebXR DOM-overlay root - three modules need it, so it is looked
// up once here.
const measureStep = element<HTMLDetailsElement>("step-measure");

// The mode on the body: the page's CSS reads it (the visitor's AR section
// loses the step card's frame).
document.body.dataset["mode"] = mode;

const print = wirePrintPanel(
  {
    panel: printPanel,
    urlInput: element("print-url"),
    urlAsk: element("print-url-ask"),
    urlShown: element("print-url-shown"),
    sizeInput,
    codeInput: element("author-c"),
    generateButton: element("print-generate"),
    info: element("print-info"),
    area: element("print-area"),
    canvas: element("print-canvas"),
    printButton: element("print-button"),
    urlOut: element("print-url-out"),
  },
  (launchUrl) => {
    wizard.presentLaunchUrl(launchUrl);
  },
);

const stepStore = stepStoreOrUndefined();
const wizard = wireWizard({
  mode,
  dom: {
    steps: {
      host: element<HTMLDetailsElement>("step-host"),
      print: printPanel,
      hang: element<HTMLDetailsElement>("step-hang"),
      measure: measureStep,
    },
    hangDone: element<HTMLButtonElement>("hang-done"),
    starterButton: element<HTMLButtonElement>("starter-zip"),
    visitorLink: element<HTMLAnchorElement>("visitor-link"),
    measureSection: measureStep,
  },
  // The starter zip (DEC-N5): an empty manifest, so a creator without a
  // recording has something to host before printing the code.
  packStarter: () =>
    packFilesAsZip([
      {
        path: TOUR_MANIFEST_ENTRY,
        data: serializeTourManifest(createEmptyTourManifest()),
      },
    ]),
  // Through the seam like the finish step's download, so the e2e fake
  // captures it (M3 review #10).
  download: (blob, filename) => seams.downloadZip(blob, filename),
  // Step 4 holds the overlay root, so the wizard must never collapse it
  // while a session is live (M3 review #2). The controller is the only
  // thing that knows, so it is asked rather than mirrored.
  arSessionActive: () => arSessionLive(arController.getState().status),
  // The reached step per hosted url (M6); absent where reaching for the
  // store throws (blocked site data), so the page still boots.
  ...(stepStore === undefined ? {} : { stepStore }),
});
// The link a creator last opened, prefilled so a reload is one tap from
// the remembered step (M6 review #2); never over a link already typed.
{
  const linkInput = element<HTMLInputElement>("link");
  const last = wizard.rememberedTourUrl();
  if (mode === "creator" && last !== null && linkInput.value === "")
    linkInput.value = last;
}
hooks.presentTourForPrint = (url, origin) => {
  print.presentTour(url);
  // An open started from step 4 keeps the creator there (M3 review #1):
  // the default would collapse step 4, whose content is the AR overlay.
  wizard.presentTour(
    url,
    origin === "measure-step" ? { prefer: "measure" } : {},
  );
};

const visitor = wireVisitorScreen({
  mode,
  seams,
  dom: {
    screen: element("visitor-screen"),
    measureStep,
    creatorOnly: Array.from(
      document.querySelectorAll<HTMLElement>(".creator-only"),
    ),
    arHint: element("ar-hint"),
    errorBox,
  },
  renderArEntry: () => {
    hooks.renderArEntry();
  },
});

const setup = wireCreatorSetup({
  ctx,
  mode,
  arStore,
  arController,
  seams,
  wizard,
  dom: {
    panel: element("setup-panel"),
    controls: element("setup-controls"),
    finishBlock: element("finish-block"),
    replaceHelp: element("replace-help"),
    sizeInput,
    printPanel,
    status: element("setup-status"),
    mintButton: element("setup-mint"),
    finishButton: element("setup-finish"),
    finishStatus: element("finish-status"),
    downloadButton: element("finish-download"),
    pinButton: element("setup-pin"),
    pinLabel: element("pin-label"),
    pinSave: element("pin-save"),
    pinCancel: element("pin-cancel"),
    photoButton: element("setup-photo"),
  },
});
hooks.renderAuthorReadout = setup.renderAuthorReadout;
hooks.startAuthorPipeline = setup.startAuthorPipeline;
hooks.resetFinishStep = setup.resetFinishStep;

const escapeButton = element<HTMLButtonElement>("scan-escape");
const viewer = createViewerPlacement({
  ctx,
  mode,
  arStore,
  arController,
  seams,
  errorBox,
  escapeButton,
  hooks,
});
hooks.startViewerPipeline = viewer.startViewerPipeline;
hooks.tryPlaceTour = viewer.tryPlaceTour;
hooks.startScanGate = viewer.startScanGate;
hooks.resetScanGate = viewer.resetScanGate;
hooks.reconsiderScanGate = viewer.reconsiderScanGate;

const arEntry = wireArEntry({
  ctx,
  mode,
  arStore,
  arController,
  gpsHandler,
  seams,
  locationGate: visitor.locationGate,
  dom: {
    arRoot: element("ar-root"),
    arStatus: element("ar-status"),
    arHint: element("ar-hint"),
    enterArButton: element("enter-ar"),
    sizeInput,
    errorBox,
    escapeButton,
  },
  hooks,
});
hooks.renderArStatus = arEntry.renderArStatus;
hooks.renderArEntry = arEntry.renderArEntry;

const archive = wireArchiveOpen({
  ctx,
  dom: {
    form: element("open-form"),
    linkInput: element("link"),
    openButton: element("open"),
    missingForm: element("tour-missing"),
    missingInput: element("tour-missing-link"),
    missingButton: element("tour-missing-open"),
    missingBlock: element("tour-missing"),
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
