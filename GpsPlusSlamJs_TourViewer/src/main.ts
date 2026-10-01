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
import {
  createGpsPositionHandler,
  selectAlignmentMatrix,
} from "gps-plus-slam-app-framework/state";
import { debugUiEnabledFromSearch } from "gps-plus-slam-app-framework/utils/debug-flag";
import {
  BoundedLocalCacheStore,
  CacheApiStore,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";

import { openDraftNamespace } from "gps-plus-slam-app-framework/storage";
import { sanitizedPageUrl } from "gps-plus-slam-app-framework/storage/session-metadata-record";
import { getBuildInfo } from "gps-plus-slam-app-framework/utils/build-info";

import { wireArchiveOpen } from "./archive-open.js";
import { wireArEntry } from "./ar-entry.js";
import { createAuthoringRecording } from "./authoring-recording.js";
import { arSessionLive, wireCreatorSetup } from "./creator-setup.js";
import { createObjectListView } from "./object-list.js";
import type { ScanOpen } from "./scan-open.js";
import { viewerModeFromSearch } from "./mode.js";
import { describeOpenError } from "./open-errors.js";
import { wirePrintPanel } from "./print-panel.js";
import {
  AUTHORING_CONTEXT_TAG,
  holdRecordingFolder,
  VIEWING_CONTEXT_TAG,
} from "./recording-folders.js";
import { wireRecordingHousekeeping as wireHousekeeping } from "./recording-housekeeping.js";
import { createSaveGuard, wireRecordingPanel } from "./recording-panel.js";
import { createSummaryPanel } from "./summary-panel.js";
import { getSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { createViewingLog } from "./viewing-log.js";
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
// `?debug=1` (the apps' shared reader): the QR readout in the AR overlay
// (plan §66), the visitor's troubleshooting recording (M1b); the visitor
// link carries it on.
const debug = debugUiEnabledFromSearch(location.search);
// The troubleshooting recording (authoring recording plan 2026-09-28-0953,
// M1a; a visitor's with `?debug=1` since M1b): the store is built with its
// backend and gate, and both stay silent until someone opts in and enters
// AR. Its controls show for a creator, and for a visitor only with
// `?debug=1` - without it nothing about a visitor's page changes.
const recordingControls = mode === "creator" || debug;
const recordingTag =
  mode === "creator" ? AUTHORING_CONTEXT_TAG : VIEWING_CONTEXT_TAG;
const recording = createAuthoringRecording({
  contextTag: recordingTag,
  openRoot: async () => {
    const root = await navigator.storage?.getDirectory?.();
    if (root === undefined) {
      throw new Error("this browser has no private file storage");
    }
    return root;
  },
  // Held for the page's life, taken before the folder exists: the next
  // page's offer and cleanup skip it.
  holdFolder: (name) => holdRecordingFolder(navigator.locks, name),
});
const arStore = createTourViewerStore(recording);
const gpsHandler = createGpsPositionHandler({
  store: arStore,
  getArPose: getCurrentArPose,
});
const arController = createEnableGpsArController(seams.controllerDeps);
const ctx = createTourViewerSession();
ctx.debug = debug;
element<HTMLPreElement>("ar-debug").hidden = !ctx.debug;
element("recording-block").hidden = !recordingControls;
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

const print = wirePrintPanel({
  mode,
  dom: {
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
    countInput: element("print-count"),
    paperSelect: element("print-paper"),
    pdfButton: element("print-pdf"),
  },
  onLaunchUrl: (launchUrl) => {
    wizard.presentLaunchUrl(launchUrl);
  },
  // Through the seam like every other download, so the e2e fake captures
  // the bytes instead of the browser writing a file.
  downloadPdf: (blob, filename) => seams.downloadPdf(blob, filename),
  // The open tour's measured codes, so the panel can say when printing
  // this one would strand them. Read at print time rather than captured:
  // the levels arrive asynchronously after an open, and a tour can be
  // swapped without the panel being rewired.
  measuredCodeIds: () => [...(ctx.currentLevels?.keys() ?? [])],
});

const stepStore = stepStoreOrUndefined();
const wizard = wireWizard({
  mode,
  debug: ctx.debug,
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
  download: (blob, filename) => seams.shareOrDownloadZip(blob, filename),
  canShare: () => seams.canShareZip(),
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

// Step 4's scan-to-open lives in archive-open, which is wired below the
// setup panel that feeds it; bound once both exist.
let scanOpen: ScanOpen | null = null;
// The summary after Finish (authoring plan 2026-09-28-0953 M3b). Its map is
// a DYNAMIC import - the only way the page reaches Leaflet - so a visitor's
// page never downloads it (summary-map-lazy.test.ts). Its way back into AR
// is the page's own Start AR setup, tapped for the creator.
const summary = createSummaryPanel({
  dom: {
    root: element("summary"),
    codes: element("summary-codes"),
    map: element("summary-map"),
    mapStatus: element("summary-map-status"),
    startAr: element("summary-start-ar"),
  },
  doc: document,
  loadMap: () => import("./summary-map-view.js"),
  startAr: () => {
    element("enter-ar").click();
  },
});
const setup = wireCreatorSetup({
  ctx,
  mode,
  codeTour: {
    onDetection: (text) => {
      scanOpen?.onDetection(text);
    },
    status: (text) => scanOpen?.status(text) ?? { kind: "quiet" },
    tourOf: (text) => scanOpen?.tourOf(text) ?? null,
  },
  arStore,
  arController,
  seams,
  wizard,
  summary,
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
    replaceHelpShare: element("replace-help-share"),
    replaceHelpGeneric: element("replace-help-generic"),
    replaceHelpDrive: element("replace-help-drive"),
    pinButton: element("setup-pin"),
    pinLabel: element("pin-label"),
    pinSave: element("pin-save"),
    pinCancel: element("pin-cancel"),
    photoButton: element("setup-photo"),
    draftOffer: element("draft-offer"),
    draftOfferText: element("draft-offer-text"),
    draftRestore: element("draft-restore"),
    draftDismiss: element("draft-dismiss"),
    draftDiscard: element("draft-discard"),
    sizeOffer: element("size-offer"),
    sizeOfferText: element("size-offer-text"),
    sizeOfferUse: element("size-offer-use"),
    sizeOfferKeep: element("size-offer-keep"),
    // Editing placed objects (authoring plan 2026-09-28-0953 M4).
    objectList: createObjectListView(element("object-list"), document),
    replaceCodeButton: element("replace-code"),
    replaceCodeConfirm: element("replace-code-confirm"),
    replaceCodeConfirmText: element("replace-code-confirm-text"),
    replaceCodeYes: element("replace-code-yes"),
    replaceCodeNo: element("replace-code-no"),
  },
  // Crash-safe authoring (F13). OPFS, not a file handle: the File System
  // Access pickers do not exist on Chrome for Android, which is the only
  // device the creator's AR session runs on.
  openDraftStore: async (key) => {
    try {
      // `getDirectory()` can REJECT rather than simply be absent - a
      // private window, an embedded WebView, a non-secure origin.
      // `openDraftNamespace` carries its own try/catch precisely so a
      // caller never sees a throw, but this call sits outside it, and the
      // rejection landed in a `void`-ed continuation with no handler.
      const root = await navigator.storage?.getDirectory?.();
      return root === undefined
        ? undefined
        : await openDraftNamespace(root, key);
    } catch {
      return undefined;
    }
  },
});
hooks.renderAuthorReadout = setup.renderAuthorReadout;
hooks.startAuthorPipeline = setup.startAuthorPipeline;
hooks.resetFinishStep = setup.resetFinishStep;
hooks.beginAuthorVisit = setup.beginAuthorVisit;
hooks.endAuthorVisit = setup.endAuthorVisit;
hooks.selectInView = setup.selectInView;
hooks.presentNoTour = () => {
  print.presentNoTour();
};
hooks.presentDraftForTour = setup.presentDraftForTour;

// The recording's controls: a creator's, and a `?debug=1` visitor's (M1b);
// wired before the AR entry that asks them at each entry. One save at a
// time across the block: "Save the recording" and the offer share a guard.
const recordingSaveGuard = createSaveGuard();
const recordingPanel = recordingControls
  ? wireRecordingPanel({
      recording,
      dom: {
        optIn: element("record-session"),
        marker: element("recording-marker"),
        saveButton: element("recording-save"),
        status: element("recording-status"),
        notice: element("recording-notice"),
      },
      save: () =>
        recording.save({
          flush: () => arStore.flushPendingActionWrites(),
          nowMs: Date.now(),
          userAgent: navigator.userAgent,
          pageUrl: sanitizedPageUrl(location.href),
          getBuildInfo,
        }),
      // Through the seam like the tour zip, so the e2e fake captures it.
      handOff: (blob, filename) => seams.shareOrDownloadZip(blob, filename),
      sessionLive: () => arSessionLive(arController.getState().status),
      // A session ended (the counter) or one running now: either way the
      // store's zero reference is no longer the recording's to write.
      arHasRun: () =>
        ctx.arSessionGeneration > 0 ||
        arSessionLive(arController.getState().status),
      estimateStorage: () =>
        navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
      now: () => new Date(),
      saveGuard: recordingSaveGuard,
    })
  : null;
if (recordingPanel !== null) {
  arController.subscribe(() => {
    recordingPanel.render();
  });
  // Failed writes are counted as they happen, after a dispatch.
  arStore.subscribe(() => {
    recordingPanel.render();
  });
  wireRecordingHousekeeping();
}

/**
 * A recording a killed tab left unsaved is offered, and old saved ones are
 * cleaned up (M1b, `recording-housekeeping.ts`), wherever the recording's
 * controls show. Best effort: without OPFS there is nothing to offer.
 */
function wireRecordingHousekeeping(): void {
  void wireHousekeeping({
    dom: {
      offer: element("recording-offer"),
      text: element("recording-offer-text"),
      saveButton: element("recording-offer-save"),
      dismissButton: element("recording-offer-dismiss"),
      discardButton: element("recording-offer-discard"),
      status: element("recording-status"),
      block: element("recording-block"),
    },
    openRoot: async () => navigator.storage?.getDirectory?.(),
    locks: navigator.locks,
    // The saving page's own tag: an orphan with no log action of either
    // kind is labelled by the page that saves it (M1b review #7).
    contextTag: recordingTag,
    environment: () => ({
      userAgent: navigator.userAgent,
      pageUrl: sanitizedPageUrl(location.href),
      getBuildInfo,
    }),
    // Through the seam like every other zip, so the e2e fake captures it.
    handOff: (blob, filename) => seams.shareOrDownloadZip(blob, filename),
    canShare: () => seams.canShareZip(),
    now: () => new Date(),
    describeTime: (ms) =>
      new Date(ms).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    reveal: () => {
      wizard.revealStep("measure");
    },
    saveGuard: recordingSaveGuard,
  });
}

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
  // The `tourViewing/*` log (M1b): only where a recording can run, and
  // silent until it does.
  ...(recordingPanel === null
    ? {}
    : {
        viewingLog: createViewingLog({
          enabled: () => recording.persistWhile(),
          dispatch: (action) => arStore.dispatch(action),
          alignmentMatrix: () => selectAlignmentMatrix(arStore.getState()),
          scanGate: () => ctx.scanGate.kind,
          arVisitIndex: () => ctx.arSessionGeneration,
          now: () => Date.now(),
        }),
      }),
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
    arDebug: element("ar-debug"),
  },
  hooks,
  ...(recordingPanel === null ? {} : { recording: recordingPanel }),
});
hooks.renderArStatus = arEntry.renderArStatus;
hooks.renderArEntry = arEntry.renderArEntry;

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
scanOpen = archive.scanOpen;

// The QR launch is the one flow with no retry (a printed code) — an
// unexpected boot failure must reach the error box, not vanish in an
// unhandled rejection.
archive.boot().catch((err: unknown) => {
  errorBox.textContent = describeOpenError(err);
});
