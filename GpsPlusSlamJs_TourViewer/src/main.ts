/**
 * Composition root (flows plan M6, executing the simplification plan's
 * M-1; the guided-setup plan M2 added the mode split): looks the DOM up
 * once, creates the store, the AR controller and the seams, creates the ONE
 * explicit session object (DEC-T6) and the late-bound hooks, and wires the
 * concerns in dependency order: print panel → wizard → visitor screen →
 * creator setup → viewer placement → AR entry → archive open. No behaviour
 * lives here; the e2e suite drives the composed page.
 */

import { createEnableGpsArController } from "gps-plus-slam-app-framework/ar";
import { requestGeolocationPermission } from "gps-plus-slam-app-framework/sensors";
import { locationPermissionWithoutFix } from "./location-permission.js";
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
  createTapCounter,
  wantsRecording,
  withRecordingFlags,
} from "./recording-switch.js";
import {
  BoundedLocalCacheStore,
  CacheApiStore,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";

import { openRemoteArchive } from "gps-plus-slam-app-framework/storage";
import { openDraftStore } from "./draft-store-root.js";
import { sanitizedPageUrl } from "gps-plus-slam-app-framework/storage/session-metadata-record";
import { getBuildInfo } from "gps-plus-slam-app-framework/utils/build-info";

import { wireArchiveOpen } from "./archive-open.js";
import { wireArEntry } from "./ar-entry.js";
import { createAuthoringRecording } from "./authoring-recording.js";
import { arSessionLive, wireCreatorSetup } from "./creator-setup.js";
import { createObjectListView } from "./object-list.js";
import type { ScanOpen } from "./scan-open.js";
import { meshCursorFromSearch, viewerModeFromSearch } from "./mode.js";
import { describeOpenError } from "./open-errors.js";
import { wireHostPicker } from "./host-picker.js";
import { wireSetupStage } from "./setup-stage.js";
import { mountLanding, watchArStarting } from "./landing/landing-mount.js";
import { holdLandingSkip } from "./landing/landing-skip.js";
import { readTourHost } from "./tour-host.js";
import { checkLink } from "./link-check.js";
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
import { wireVisitorStations } from "./visitor-stations.js";
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";
import { createWalkToast } from "./walk-toast.js";
import { relocationRequested } from "./tour-relocation.js";
import { tourCodesUsable, wireVisitorScreen } from "./visitor-screen.js";
import { wireVisitorStart } from "./visitor-start.js";
import { wireFoldingLabel } from "./folding-label.js";
import { pictureProblem } from "./image-cap.js";
import { driveProxyBaseUrl } from "./drive-proxy-url.js";
import {
  stepStoreOrUndefined,
  visitorLaunchHref,
  wireWizard,
} from "./wizard.js";
import { editorPitch, wireHaveTour } from "./have-tour.js";
import { readPrintedText } from "./level-printed.js";
import {
  showAllContentSet,
  showAllStationsFromSearch,
} from "./visitor-guide-slice.js";
import { wireTourNameField } from "./tour-name-field.js";
import { renderTourContact } from "./tour-contact.js";
import {
  NOT_FINISHED,
  tourUnfinished,
  unfinishedNote,
} from "./tour-unfinished.js";

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

/** An SVG element by id (the walk's direction arrow). */
function svgElement(id: string): SVGElement {
  const found = document.getElementById(id);
  if (!(found instanceof SVGElement)) throw new Error(`missing svg #${id}`);
  return found;
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
/** Read on each use: the reader can change it while the page is open. */
const reducedMotion = (): boolean =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
// The landing's moving parts (src/landing/landing-mount.ts): dynamic
// imports, for a creator only; its text and still are static markup.
{
  const film = document.getElementById("landing-film");
  const cards = document.querySelector<HTMLElement>(".landing-cards");
  const uses = document.getElementById("landing-uses");
  const landing = mountLanding({
    mode,
    dom:
      film === null || cards === null || uses === null
        ? null
        : { film, cards, uses },
    reducedMotion: reducedMotion(),
    watchReducedMotion: (onChange) => {
      if (typeof matchMedia !== "function") return () => undefined;
      const query = matchMedia("(prefers-reduced-motion: reduce)");
      const changed = (): void => {
        onChange(query.matches);
      };
      query.addEventListener("change", changed);
      return () => {
        query.removeEventListener("change", changed);
      };
    },
    onArStarting: watchArStarting(document),
  });
  // A returning device's page was scrolled to the setup before the
  // parts revealed below (and the landing's pictures) showed: it is kept
  // there while they settle. Called here, before the rest of the wiring,
  // so a throw further down cannot skip it; its ResizeObserver sees the
  // reveals that come later.
  holdLandingSkip(document, { until: landing.ready });
}
// `?debug=1` (the apps' shared reader): the QR readout in the AR overlay
// (plan §66), the visitor's troubleshooting recording (M1b); the visitor
// link carries it on.
const debug = debugUiEnabledFromSearch(location.search);
// The troubleshooting recording (authoring recording plan 2026-09-28-0953,
// M1a; a visitor's with `?debug=1` since M1b): the store is built with its
// backend and gate, and both stay silent until someone opts in and enters
// AR. Its controls show only with `?debug=1`, for a creator too since
// polish round M3 (Q-Data, A20: it was the developer's) - without it
// nothing about either page changes.
const recordingControls = debug;
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
// The test switch ?allstations=1 (visitor plan 2026-10-18-2349 §3): every
// station's content shows, not only the present one's.
if (showAllStationsFromSearch(location.search)) {
  arStore.dispatch(showAllContentSet(true));
}
// The location permission enable() asks for is settled without waiting for
// a fix (QR-first M1b-1 review #1): indoors a visitor who allowed location
// got none, and the framework's requester failed enable() on every tap.
/** Location requests refused in this page: a creator's failed start names
 *  the location only when its own request was among them (`ar-entry.ts`). */
let locationRefusals = 0;
const arController = createEnableGpsArController({
  ...seams.controllerDeps,
  requestGeolocationPermission: locationPermissionWithoutFix({
    query: () => seams.queryGeolocationPermission(),
    request:
      seams.controllerDeps.requestGeolocationPermission ??
      requestGeolocationPermission,
    onRefused: () => {
      locationRefusals += 1;
    },
  }),
});
const ctx = createTourViewerSession(arStore);
ctx.debug = debug;
// The gallery is a creator's debugging aid (polish round M2): shown only
// with ?debug=1, and never to a visitor, whose tour appears in AR. Hidden,
// it is still filled (each photo decoded): the e2e suite reads it as its
// "tour is open" signal, so skipping the fill waits for a readiness
// attribute to replace that (filed with the PR #598 review).
element("gallery").hidden = !(mode === "creator" && debug);
element<HTMLPreElement>("ar-debug").hidden = !ctx.debug;
// The page's CSS keeps a creator's technical AR line for ?debug=1 only
// (polish round M3: the HUD's readout is the setup status card).
document.body.dataset["debug"] = String(ctx.debug);
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
    info: element("print-info"),
    tiles: element("print-tiles"),
    urlOut: element("print-url-out"),
    countInput: element("print-count"),
    countDown: element("print-count-down"),
    countUp: element("print-count-up"),
    posterTitle: element("poster-title"),
    posterExplanation: element("poster-explanation"),
    posterCallToAction: element("poster-cta"),
    paperSelect: element("print-paper"),
    pdfButton: element("print-pdf"),
  },
  onLaunchUrl: (launchUrl) => {
    wizard.presentLaunchUrl(launchUrl);
  },
  // Through the seam like every other download, so the e2e fake captures
  // the bytes instead of the browser writing a file.
  downloadPdf: (blob, filename) => seams.downloadPdf(blob, filename),
  openPdfTab: () => seams.openPdfTab(),
  // The poster title defaults to the tour's name (polish round D-P7).
  tourTitle: () => ctx.tourDocument.manifest()?.title ?? null,
  posterStore: stepStoreOrUndefined(),
  // The re-check before the PDF of a link step 2 could not confirm
  // (polish round M2): the same transport an open uses, probed and let go.
  checkLink: (url) =>
    checkLink(url, (link, options) =>
      openRemoteArchive(link, {
        ...options,
        corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
      }),
    ),
  // The open tour's measured codes, so the panel can say when printing
  // this one would strand them. Read at print time rather than captured:
  // the levels arrive asynchronously after an open, and a tour can be
  // swapped without the panel being rewired.
  // With the codes measured on this page that the tour does not host yet
  // (code book plan M4d): printing over them strands them too.
  measuredCodeIds: () => measuredCodeIds(),
  // The texts those codes were printed with, from their levels (follow-up
  // F2): this page's newest level first, else the hosted one.
  measuredCodeTexts: () =>
    measuredCodeIds().flatMap((id) => {
      const json =
        setup.codes.savedText(id) ?? ctx.currentLevelTexts?.get(id) ?? null;
      const text = json === null ? null : readPrintedText(json);
      return text === null ? [] : [{ id, text }];
    }),
});

function measuredCodeIds(): string[] {
  return [
    ...new Set([
      ...(ctx.currentLevels?.keys() ?? []),
      ...setup.measuredCodeIds(),
    ]),
  ];
}

const stepStore = stepStoreOrUndefined();
const wizard = wireWizard({
  mode,
  debug: ctx.debug,
  dom: {
    steps: {
      host: element<HTMLDetailsElement>("step-host"),
      link: element<HTMLDetailsElement>("step-link"),
      print: printPanel,
      hang: element<HTMLDetailsElement>("step-hang"),
      measure: measureStep,
      done: element<HTMLDetailsElement>("step-done"),
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
// Labelled as the last tour (polish round M2, A3), so a prefilled field
// does not read as a link this visit gave.
{
  const linkInput = element<HTMLInputElement>("link");
  const last = wizard.rememberedTourUrl();
  if (mode === "creator" && last !== null && linkInput.value === "") {
    linkInput.value = last;
    const status = element("link-status");
    status.textContent = `Your last tour's link - tap "Check link" to continue with it, or paste another.`;
    status.hidden = false;
  }
}
// Step 1's host tiles (polish round M2, A6/A7): the choice is stored with
// the wizard's other state, and Continue moves on to the link.
if (mode === "creator") {
  wireHostPicker<
    HTMLButtonElement | HTMLLIElement | HTMLSpanElement | HTMLAnchorElement
  >({
    dom: {
      tiles: element("host-tiles"),
      steps: element("host-steps"),
      starter: element("starter-zip"),
      continueButton: element("host-continue"),
    },
    store: stepStore,
    createElement: (tag) => document.createElement(tag),
    onContinue: () => {
      wizard.openStep("link");
      element<HTMLInputElement>("link").focus();
    },
  });
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

// A tour opened from a file (tour kit plan K0) has no link: the print step
// keeps asking for one, and only a creator's wizard moves on - the same
// steps a link would reach, without remembering a link to prefill.
// A link step 2 could not confirm but that may still work (polish round
// M2, A16): printed as given, marked unverified, so it is entered once.
hooks.presentUnverifiedLink = (url) => {
  print.presentTour(url, { verified: false });
  wizard.presentTour(url);
};

// The open tour's codes arrived: the first poster continues their
// numbering (polish round M0b).
hooks.presentTourCodes = () => {
  print.presentCodes();
};

hooks.presentLocalTour = (origin) => {
  print.presentNoTour();
  if (mode !== "creator") return;
  wizard.openStep(origin === "measure-step" ? "measure" : "print");
};

const visitor = wireVisitorScreen({
  mode,
  seams,
  dom: {
    screen: element("visitor-screen"),
    more: element("visitor-more"),
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
  // A tour with no code that can place it keeps the denial copy (M1b-1
  // review #2); null while the levels are not known yet, false once their
  // read failed (r857 review #4).
  codesUsable: () => tourCodesUsable(ctx.currentLevels, ctx.levelsUnreadable),
  // A tour marked "needs no GPS" never asks its visitor (Q-QF-1).
  needsNoGps: () => ctx.tourDocument.manifest()?.needsNoGps === true,
});

// The visitor's start page leads with the tour's name, a line and one of
// its photos (polish round M4a, the owner's V4); a creator never sees it.
if (mode === "visitor") {
  const visitorStart = wireVisitorStart({
    dom: {
      title: element("visitor-title"),
      subline: element("visitor-subline"),
      description: element("visitor-description"),
      page: document,
      cover: element("visitor-cover"),
      coverImage: element<HTMLImageElement>("visitor-cover-image"),
    },
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    checkPicture: pictureProblem,
  });
  // The tour's contact under an error (W2, D15): while an error shows,
  // for the tour open now. An error before its manifest is read names no
  // contact: the contact is inside the file.
  const contactDom = {
    line: element("error-contact"),
    link: element<HTMLAnchorElement>("error-contact-link"),
  };
  /** The open tour is not finished yet (`tour-unfinished.ts`): its
   *  contact shows under the start page's sentence too. */
  let unfinished = false;
  const renderContact = (): void => {
    renderTourContact(
      contactDom,
      errorBox.textContent || (unfinished ? NOT_FINISHED : ""),
      ctx.tourDocument.manifest()?.contact,
    );
  };
  new MutationObserver(renderContact).observe(errorBox, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  hooks.presentTourInfo = (tour) => {
    if (tour === null) visitorStart.clear();
    else visitorStart.present(tour.manifest, tour.loadImage);
    unfinished = tour !== null && tourUnfinished(tour.manifest);
    renderContact();
    visitor.tourChanged();
  };
  // The levels settle after the manifest, often: the line follows whether
  // a code can place the tour (r857 review #5).
  hooks.presentTourLevels = () => {
    visitor.tourChanged();
  };
}

// The setup page's station row and map (polish round M2b, the L5 look):
// wired after the visitor screen, which reveals the creator-only parts,
// so the row's own hidden states are the last word.
if (mode === "creator") {
  const stepNodes = {
    host: element<HTMLDetailsElement>("step-host"),
    link: element<HTMLDetailsElement>("step-link"),
    print: printPanel,
    hang: element<HTMLDetailsElement>("step-hang"),
    measure: measureStep,
    done: element<HTMLDetailsElement>("step-done"),
  };
  const summaryOf = (step: HTMLDetailsElement): HTMLElement | undefined =>
    step.querySelector<HTMLElement>(":scope > summary") ?? undefined;
  const svgById = <T extends SVGElement>(id: string): T | undefined =>
    (document.getElementById(id) as T | null) ?? undefined;
  const route = svgById<SVGGeometryElement>("map-route");
  const reveal = svgById<SVGPathElement>("map-route-reveal");
  const stations = svgById<SVGGElement>("map-stations");
  const start = svgById<SVGGElement>("map-start");
  const endFlag = svgById<SVGGElement>("map-end-flag");
  wireSetupStage<HTMLButtonElement>({
    dom: {
      steps: stepNodes,
      summaries: Object.fromEntries(
        Object.entries(stepNodes).map(([step, node]) => [
          step,
          summaryOf(node),
        ]),
      ),
      badge: element("setup-badge"),
      of: element("setup-of"),
      dots: element("setup-dots"),
      nav: element("setup-nav"),
      back: element("setup-back"),
      next: element("setup-next"),
      begins: Array.from(
        document.querySelectorAll<HTMLButtonElement>(".landing-begin"),
      ),
      stage: element("setup-stage"),
    },
    reducedMotion,
    openStep: (step) => {
      wizard.openStep(step);
    },
    createElement: (tag) => document.createElement(tag),
    ...(route === undefined || reveal === undefined || stations === undefined
      ? {}
      : {
          map: {
            route,
            reveal,
            stations,
            ...(start === undefined ? {} : { start }),
            ...(endFlag === undefined ? {} : { endFlag }),
          },
        }),
  });
}

// Step 4's scan-to-open lives in archive-open, which is wired below the
// setup panel that feeds it; bound once both exist.
let scanOpen: ScanOpen | null = null;
// The summary after Finish (authoring plan 2026-09-28-0953 M3b). Its map is
// a DYNAMIC import - the only way the page reaches Leaflet - so a visitor's
// page never downloads it (summary-map-lazy.test.ts). Its way back into AR
// is the page's own Start creating, tapped for the creator.
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
// The H1 strip's chips fold to their icons after their first use (polish
// round M3, D-P4). Wired BEFORE the setup binds the chips' own clicks: a
// long press that unfolds a label must not also place a pin.
if (mode === "creator") {
  for (const [id, label] of [
    ["setup-pin", "Place a pin"],
    ["setup-photo", "Take a photo"],
    ["setup-new-station", "New station here"],
  ] as const) {
    wireFoldingLabel({
      button: element(id),
      key: id,
      label,
      // The page's one guarded localStorage (`stepStoreOrUndefined`).
      store: stepStore ?? null,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => {
          clearTimeout(timer);
        };
      },
    });
  }
}

/** The tour's own name in step 3 (tour editor plan 2026-10-17-1816, W2):
 *  it shows the open tour's title (or the name typed for it before a
 *  reload) and tells the Finish what the creator did with it
 *  (`tour-name-field.ts`). */
const tourNameField = wireTourNameField(
  element<HTMLInputElement>("tour-name-input"),
  // A typed name outlives a reload, as the poster text does (M4a review
  // #12), keyed by the tour's file.
  stepStore,
  // The name becomes the tour document's (W2): a change like any other,
  // saved by the next Finish - or refused in words beside the field (over
  // 80 characters, counted as the format counts them). Read when a tour
  // opens, after `setup` exists.
  {
    apply: (name) => setup.renameTour(name),
    error: element<HTMLElement>("tour-name-error"),
  },
);
if (mode === "creator") {
  const visitorLinkNote = element("visitor-link-note");
  hooks.presentTourInfo = (tour) => {
    const manifest = tour?.manifest ?? null;
    tourNameField.present(
      manifest?.title ?? null,
      manifest === null ? null : (ctx.session?.archive.url ?? null),
    );
    // What a visitor of the hosted file reads while it is not finished.
    const note = tour === null ? null : unfinishedNote(tour.manifest);
    visitorLinkNote.textContent = note ?? "";
    visitorLinkNote.hidden = note === null;
  };
}

const setup = wireCreatorSetup({
  ctx,
  mode,
  // A name still in its field is the tour's before any Finish reads it.
  beforeFinish: () => {
    tourNameField.commit();
  },
  // A code measured or restored from a draft after the open: the print
  // step continues the numbering past it (follow-up F16). Through the
  // hook, which the print panel fills in once it is wired.
  onCodesChanged: () => {
    hooks.presentTourCodes();
  },
  renderArEntry: () => {
    hooks.renderArEntry();
  },
  // A code the tour stores votes for a creator as for a visitor: through
  // the viewer placement, wired after the setup.
  codeVotes: (options) => hooks.storedCodeVotes(options),
  // Step 6 names the host chosen in step 1 (polish round M2).
  host: () => readTourHost(stepStore),
  codeTour: {
    onDetection: (text) => {
      scanOpen?.onDetection(text);
    },
    status: (text) => scanOpen?.status(text) ?? { kind: "quiet" },
    // Before scan-to-open exists nothing is known about a code, so nothing
    // is measured on its own (UI round 1, U3).
    relation: (text) => scanOpen?.relation(text) ?? "resolving",
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
    uploadAsk: element("upload-ask"),
    uploadAskText: element("upload-ask-text"),
    uploadYes: element<HTMLButtonElement>("upload-yes"),
    uploadNo: element<HTMLButtonElement>("upload-no"),
    sizeInput,
    printSettings: element<HTMLDetailsElement>("print-settings"),
    printPanel,
    status: element("setup-status"),
    finishButton: element("setup-finish"),
    keepScanRow: element("keep-scan-row"),
    keepScanInput: element<HTMLInputElement>("keep-scan"),
    finishStatus: element("finish-status"),
    downloadButton: element("finish-download"),
    replaceHelpGeneric: element("replace-help-generic"),
    replaceHelpDrive: element("replace-help-drive"),
    replaceDriveCopy: element("replace-drive-copy"),
    debugSave: element("debug-save"),
    debugSaveText: element("debug-save-text"),
    debugSaveButton: element("debug-save-btn"),
    debugSaveStatus: element("debug-save-status"),
    pinButton: element("setup-pin"),
    pinLabel: element("pin-label"),
    pinLabelCount: element("pin-label-count"),
    pinSave: element("pin-save"),
    pinCancel: element("pin-cancel"),
    photoButton: element("setup-photo"),
    newStationButton: element<HTMLButtonElement>("setup-new-station"),
    undoButton: element<HTMLButtonElement>("setup-undo"),
    undoLabel: element("setup-undo-label"),
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
    stationChip: element("creator-station"),
  },
  // Crash-safe authoring (F13), in this origin's private file system - the
  // desktop editor's draft opens through the same wrapper (M6 E2c).
  openDraftStore: (key) => openDraftStore(navigator, key),
});
hooks.renderAuthorReadout = setup.renderAuthorReadout;
hooks.startAuthorPipeline = setup.startAuthorPipeline;
hooks.creatorCanStartOnCodes = setup.creatorCanStartOnCodes;
hooks.resetFinishStep = setup.resetFinishStep;
// The save cannot be forgotten (UI round 1, U2): another tour, or leaving
// the page, asks first while a rebuilt tour file was not saved.
hooks.confirmLeaveTour = () =>
  !setup.leaveNeedsConfirm() || window.confirm(setup.leaveQuestion());
window.addEventListener("beforeunload", (event) => {
  if (setup.leaveNeedsConfirm()) event.preventDefault();
});
hooks.beginAuthorVisit = setup.beginAuthorVisit;
hooks.endAuthorVisit = setup.endAuthorVisit;
hooks.selectInView = setup.selectInView;
hooks.finishFromAr = () => setup.finishNow();
hooks.presentNoTour = () => {
  print.presentNoTour();
};
hooks.presentDraftForTour = setup.presentDraftForTour;
hooks.forgetRefusedDraft = setup.forgetRefusedDraft;

// The recording's controls: a `?debug=1` creator's or visitor's (M1b;
// polish round M3, Q-Data); wired before the AR entry that asks them at
// each entry. One save at a time across the block: "Save the recording"
// and the offer share a guard.
// The visitor's hidden switch (QR-first plan M1c): five taps on the tour's
// name within three seconds reload the page with the debug readout and the
// recording asked for - a field test after a scan with any QR app.
if (mode === "visitor") {
  const tap = createTapCounter({
    taps: 5,
    windowMs: 3000,
    now: () => Date.now(),
  });
  element("visitor-title").addEventListener("click", () => {
    if (!tap()) return;
    const next = withRecordingFlags(location.href);
    if (next !== location.href) location.replace(next);
  });
}

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
  // Opened through the hidden switch (`record=1`, QR-first plan M1c): the
  // box starts ticked, as if the visitor had ticked it.
  if (wantsRecording(location.search, debug)) {
    const optIn = element<HTMLInputElement>("record-session");
    optIn.checked = true;
    optIn.dispatchEvent(new Event("change"));
  }
  arController.subscribe(() => {
    recordingPanel.render();
  });
  // Failed writes are counted as they happen, after a dispatch.
  arStore.subscribe(() => {
    recordingPanel.render();
  });
  wireRecordingHousekeeping();
} else if (mode === "creator") {
  // The switch is ?debug=1's since polish round M3 (Q-Data), but a creator
  // may hold recordings from before: they are still cleaned up, and one a
  // killed tab left unsaved is still offered (M3 review #8).
  wireRecordingHousekeeping();
}

/**
 * A recording a killed tab left unsaved is offered, and old saved ones are
 * cleaned up (M1b, `recording-housekeeping.ts`), wherever the recording's
 * controls show - and for every creator (M3 review #8). Best effort:
 * without OPFS there is nothing to offer.
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
      // Without ?debug=1 the block is hidden; an offer needs it shown.
      element("recording-block").hidden = false;
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
  // A station's photos are read through the stations' prefetch cache.
  // It holds story media only, so a return reads an
  // item photo from the archive again until item photos join it.
  loadContent: (path) => stations.loadContent(path),
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
hooks.storedCodeVotes = viewer.storedCodeVotes;
hooks.tryPlaceTour = viewer.tryPlaceTour;
hooks.startScanGate = viewer.startScanGate;
hooks.resetScanGate = viewer.resetScanGate;
hooks.reconsiderScanGate = viewer.reconsiderScanGate;

// The visitor's toast in AR: the
// framework's one toast, its news said once per AR entry.
const walkToast = createWalkToast(
  createToast(element("walk-toast-root"), {
    className: "walk-toast",
    id: "walk-toast",
  }),
  element("walk-live"),
);

// The visitor's stations and their stories (tour kit plan K4), and the
// walk's sheet.
const stations = wireVisitorStations({
  ctx,
  mode,
  arStore,
  seams,
  dom: {
    guide: {
      line: element("station-line"),
      skip: element("station-skip"),
      // The end of a story is the story card's control.
      end: element("walk-story-end"),
    },
    scene: {
      panel: element("scene-panel"),
      title: element("scene-title"),
      speaker: element("scene-speaker"),
      text: element("scene-text"),
      status: element("scene-status"),
      image: element<HTMLImageElement>("scene-image"),
      choices: element("scene-choices"),
      continueButton: element("scene-continue"),
      playNext: element("scene-play-next"),
    },
    skipButton: element("station-skip"),
    continueButton: element("scene-continue"),
    playNextButton: element("scene-play-next"),
    doc: document,
  },
  now: () => Date.now(),
  schedule: (fn, ms) => seams.schedule(fn, ms),
  walk: {
    dom: {
      doc: document,
      root: element("walk-sheet"),
      grab: element("walk-grab"),
      peek: element("walk-peek"),
      segments: element("walk-segments"),
      eyebrow: element("walk-eyebrow"),
      title: element("walk-title"),
      distance: element("walk-distance"),
      distanceText: element("walk-distance-text"),
      distanceArrow: svgElement("walk-distance-arrow"),
      tail: element("walk-tail"),
      tailArrow: svgElement("walk-tail-arrow"),
      quick: element("station-skip"),
      story: element("walk-story"),
      dots: element("walk-dots"),
      storyEnd: element("walk-story-end"),
      keepListening: element("walk-keep-listening"),
      list: element("walk-list"),
      listTitle: element("walk-list-title"),
      chip: element("walk-chip"),
      close: element("walk-close"),
      done: element("walk-done"),
      doneTitle: element("walk-done-title"),
      doneText: element("walk-done-text"),
      progress: element("walk-progress"),
      hint: element("walk-hint"),
      rows: element("walk-rows"),
      away: {
        root: element("walk-away"),
        text: element("walk-away-text"),
        segments: element("walk-away-segments"),
        rows: element("walk-away-rows"),
      },
    },
    toast: walkToast,
    onShownChange: () => {
      hooks.renderArStatus();
    },
    // The radar and the precision chip.
    radar: {
      wrap: element("walk-radar-wrap"),
      button: element("walk-radar"),
      canvas: element<HTMLCanvasElement>("walk-radar-canvas"),
      chip: element("walk-precision"),
      chipText: element("walk-precision-text"),
      rangeLabel: element("walk-range"),
    },
    edgePill: {
      root: element("walk-edge-pill"),
      text: element("walk-edge-pill-text"),
      arrow: svgElement("walk-edge-pill-arrow"),
    },
  },
  // The test switch ?relocate=here (tour-relocation.ts, owner decision S-D9).
  ...(relocationRequested(location.search)
    ? {
        relocate: {
          onRelocated: () => {
            element("relocate-note").hidden = false;
          },
        },
      }
    : {}),
});
// Every camera frame: the visitor's stations, and the creator's open
// station (each does nothing in the other mode).
hooks.tickStations = () => {
  stations.tick();
  setup.tickStations();
  // The present station's content follows the guide's verdict at once.
  viewer.syncContent();
};
hooks.stationCodeLocked = stations.codeLocked;
hooks.unlockStationAudio = stations.unlockAudio;
hooks.stopStations = stations.stop;
// Every device fix goes through the viewer placement: while a scanned code's
// keep-alive holds, the fix and its ring reach the store as ONE batch, one
// solve (authoring plan 2026-09-28-0953 D18); otherwise as before.
const gpsHandler = createGpsPositionHandler({
  store: arStore,
  getArPose: () => seams.getArPose(),
  recordFix: viewer.recordDeviceFix,
});

const arEntry = wireArEntry({
  ctx,
  mode,
  arStore,
  // The creator's ring on a mesh of the surroundings (polish round M5,
  // Q-Mesh): the default since the owner's phone test of 2026-10-15;
  // ?mesh=0 turns it off.
  meshCursor: mode === "creator" && meshCursorFromSearch(location.search),
  arController,
  gpsHandler,
  seams,
  locationGate: visitor.locationGate,
  locationRefusals: () => locationRefusals,
  dom: {
    arRoot: element("ar-root"),
    arStatus: element("ar-status"),
    arHint: element("ar-hint"),
    enterArButton: element("enter-ar"),
    sizeInput,
    errorBox,
    escapeButton,
    arDebug: element("ar-debug"),
    arStatusLive: element("ar-status-live"),
    scanCard: element("scan-card"),
    scanCardLine: element("scan-card-line"),
    scanCardTitle: element("scan-card-title"),
    coach: {
      root: element("walk-coach"),
      text: element("walk-coach-text"),
    },
    codeTail: element("walk-code-tail"),
  },
  hooks,
  walk: {
    toast: walkToast,
    progressKept: () => mode === "visitor" && stations.progressKept(),
    sheetShown: () => stations.walkShown(),
    debugLines: () => stations.debugLines(),
  },
  ...(recordingPanel === null ? {} : { recording: recordingPanel }),
});
hooks.renderArStatus = arEntry.renderArStatus;
hooks.renderArEntry = arEntry.renderArEntry;

const archive = wireArchiveOpen({
  ctx,
  mode,
  dom: {
    form: element("open-form"),
    linkInput: element("link"),
    openButton: element("open"),
    openFileButton: element("open-file"),
    fileInput: element("file-input"),
    fileAdvice: element("file-advice"),
    openFileAdviceButton: element("open-file-advice"),
    fileStatus: element("file-status"),
    tourTrust: element("tour-trust"),
    statsPanel: element("stats"),
    statsHeadline: element("stats-headline"),
    statsDetail: element("stats-detail"),
    errorBox,
    linkStatus: element("link-status"),
    gallery: element("gallery"),
    readiness: document.body,
    storagePanel: element("storage-panel"),
    clearCacheButton: element("clear-cache"),
  },
  cacheStore,
  corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
  hooks,
});
scanOpen = archive.scanOpen;

// "You already have a tour?" below the steps (tour editor plan
// 2026-10-17-1816, W1): a phone opens a tour through the page's one open
// path, then plays it or goes on setting it up. A creator's only.
if (mode === "creator") {
  // The computer's half: what the editor's Save does in this browser.
  element("have-tour-editor-text").textContent = editorPitch(window);
  wireHaveTour({
    dom: {
      fileButton: element<HTMLButtonElement>("have-tour-file"),
      fileInput: element<HTMLInputElement>("have-tour-input"),
      form: element("have-tour-form"),
      linkInput: element<HTMLInputElement>("have-tour-link"),
      linkButton: element<HTMLButtonElement>("have-tour-open"),
      status: element("have-tour-status"),
      ask: element("have-tour-ask"),
      askText: element("have-tour-ask-text"),
      play: element<HTMLAnchorElement>("have-tour-play"),
      continueButton: element("have-tour-continue"),
    },
    openFile: archive.openFile,
    openLink: archive.openLink,
    playHref: (url) => visitorLaunchHref(url, ctx.debug),
    errorText: () => errorBox.textContent ?? "",
    continueSetup: () => {
      element("setup-card").scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    },
  });
}

// The QR launch is the one flow with no retry (a printed code) — an
// unexpected boot failure must reach the error box, not vanish in an
// unhandled rejection.
archive.boot().catch((err: unknown) => {
  errorBox.textContent = describeOpenError(err, undefined, mode);
});
