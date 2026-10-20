/**
 * The open path: the paste-a-link form and the `?qr=` boot, the streaming
 * session's lifetime (open, teardown), the live stats panel, the
 * progressive gallery, and the Storage section's clear-cache control. All
 * transport policy lives in the framework (`openRemoteArchive`) and in
 * `tour-session.ts`; this is the DOM glue. Its own module since the flows
 * plan M6.
 */

import {
  OpenRemoteArchiveError,
  type BoundedLocalCacheStore,
} from "gps-plus-slam-app-framework/storage";
import { resolveQrPayload } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-dispatch";
import {
  createEmptyTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { walkAtOpen } from "./tour-document-bake.js";

import { pictureProblem } from "./image-cap.js";
import { DEFAULT_ASSET_PREFIX } from "./code-tour.js";
import type { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";

import {
  describeIntegrityError,
  describeOpenError,
  OPEN_FILE_ADVICE_LABEL,
  offersFileOpen,
} from "./open-errors.js";
import {
  linkStatusText,
  printsUnverified,
  type LinkStatus,
} from "./link-check.js";
import { hostOfLink } from "./tour-host.js";
import { toStatsView } from "./stats-view.js";
import { describeTourTrust } from "./tour-trust-view.js";
import { codeTrustKey, linkTrustKey, trustStorage } from "./tour-trust.js";
import { clearCacheLabel } from "./tour-flow.js";
import {
  codeResolver,
  createScanOpen,
  type OpenOutcome,
  type ScanOpen,
} from "./scan-open.js";
import {
  openTourFile,
  openTourSession,
  tourLabel,
  type TourSession,
} from "./tour-session.js";
import {
  endTourCodeVotes,
  type TourViewerHooks,
  type TourViewerSession,
} from "./tour-viewer-session.js";
import type { ViewerMode } from "./mode.js";
import {
  entriesForVisitor,
  scanEntryNames,
  stopsVisitorDownload,
} from "./tour-read-set.js";

/** The label on every button that opens a tour. "Open" until the second
 *  testing session (F6): nobody wants to open the zip, they want to know
 *  the link works - and a link that opens here is one the printed code can
 *  carry. "Check link" since polish round M2: the check runs by itself on
 *  paste, so the button is the explicit retry. */
const OPEN_BUTTON_LABEL = "Check link";
/** The step-1 link that opens a tour zip from the device (tour kit plan
 *  K0; a small link since polish round M2, A5). */
const OPEN_FILE_LABEL = "Open it from this device";

/** What an open reads: a link, or a file picked on this device (K0). */
type TourSource = { kind: "link"; url: string } | { kind: "file"; file: File };

export interface ArchiveOpenDom {
  form: HTMLFormElement;
  linkInput: HTMLInputElement;
  openButton: HTMLButtonElement;
  /** Step 1's "Open a file" (creator page). */
  openFileButton: HTMLButtonElement;
  /** The one hidden `<input type="file">` both file buttons click. */
  fileInput: HTMLInputElement;
  /** Under the error box, both modes: shown with the "download the file and
   *  open it here" advice for a host that blocks browsers (K0). */
  fileAdvice: HTMLElement;
  openFileAdviceButton: HTMLButtonElement;
  /** Names the file a tour was opened from (both modes). */
  fileStatus: HTMLElement;
  /** Who signed the open tour, trust warnings, linked tours (K1). */
  tourTrust: HTMLElement;
  statsPanel: HTMLDivElement;
  statsHeadline: HTMLDivElement;
  statsDetail: HTMLDivElement;
  errorBox: HTMLElement;
  /** Step 2's status line under the link (polish round M2): what the
   *  check found, in plain words. */
  linkStatus: HTMLElement;
  gallery: HTMLUListElement;
  /** Carries `data-tour-open`: "opening" while an open runs, "settled"
   *  once its own work has (the manifest's and the levels' continuations,
   *  and the gallery's fill while shown), "failed" for an open that failed
   *  (follow-up F14: the readiness the e2e reads, which used to be "the
   *  gallery holds N images"). Optional: the composition root passes the
   *  page's body. */
  readiness?: HTMLElement;
  storagePanel: HTMLDetailsElement;
  clearCacheButton: HTMLButtonElement;
}

/** The composition root's entry points; step 2's open is reached through
 *  the form listener (M6 review #6: an `openUrl` handle was returned and
 *  never called). */
export interface ArchiveOpen {
  /** The `?qr=` launch: resolve the payload and open. Rejections reach the
   *  error box - a printed code is the one flow with no retry. */
  boot: () => Promise<void>;
  /** Step 4's scan-to-open, fed by the creator's AR pipeline (plan §9). */
  scanOpen: ScanOpen;
  /** The "You already have a tour?" box (tour editor plan 2026-10-17-1816,
   *  W1): `url` is opened through the one open path; once it opened it
   *  is the link of record (step 2's field and "found" line). A link that
   *  did not open leaves step 2 alone - no unverified hand-off to
   *  printing (PR #637 review); the outcome, and the error box's words,
   *  are the box's to show. */
  openLink: (url: string) => Promise<OpenOutcome>;
  /** The same box's file: opened as step 1's "Open it from this device"
   *  opens one. */
  openFile: (file: File) => Promise<OpenOutcome>;
}

export function wireArchiveOpen(deps: {
  ctx: TourViewerSession;
  dom: ArchiveOpenDom;
  /** Undefined = no local copies (`?nocache=1`, no Cache API). */
  cacheStore: BoundedLocalCacheStore | undefined;
  corsProxyBaseUrl: string;
  hooks: TourViewerHooks;
  /** A visitor's page stops the background download of a copy that
   *  carries more than visitors read (scan-pass plan S1). */
  mode: ViewerMode;
}): ArchiveOpen {
  const { ctx, dom, cacheStore, corsProxyBaseUrl, hooks } = deps;
  let objectUrls: string[] = [];
  /** An open is in flight (a real flag, cleared by the open that owns it):
   *  scan-to-open starts none meanwhile (plan §9 #6). */
  let opening = false;

  async function teardownSession(): Promise<void> {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
    dom.gallery.replaceChildren();
    ctx.tourManifestStatus = "settled";
    ctx.scanEntries = new Set();
    // Everything below belongs to a CLOSING tour, and without one there is
    // none of it: every writer of tour state runs after `ctx.session =
    // opened` and is guarded by it. What exists with no tour open is the
    // creator's own work - a measurement, placements, the print-size check -
    // made before any tour opened; the open about to run takes it, and a
    // retried open must not wipe it (scan-to-open plan §5 #1, §9 #1).
    const closing = ctx.session;
    if (closing === null) return;
    // The viewer pipeline's level source and the placed planes belong to the
    // closing tour — a newly opened tour must not relocalize against them.
    ctx.currentLevels = null;
    ctx.currentLevelTexts = null;
    ctx.levelsUnreadable = false;
    // The tour document goes with its tour: the manifest, and the
    // creator's placed objects and deletions (M4 review #1, plan
    // 2026-09-28-0953 §3.4) - carried into another tour they would be
    // written into ITS zip, and into the same tour re-opened after a finish
    // they would duplicate their own ids and break every later finish; an
    // id deleted from one tour means nothing in another.
    ctx.tourDocument.close();
    // The next open bakes its own walk.
    ctx.walkBake = null;
    hooks.presentTourInfo(null);
    // The closing tour's story and HUD (tour kit plan K4).
    hooks.stopStations();
    ctx.rebuiltZip = null;
    ctx.tourLabel = null;
    // The measured level belongs to the CLOSING tour. It survives a SESSION
    // end on purpose (finishing ends the session), but it must not survive
    // the TOUR: M5 persists it into a draft, so carrying it over would
    // write one poster's measurement into another tour's draft and then
    // into its zip (M5 review #9). `resetFinishStep` below empties it (the
    // creator's code module, code book plan M5d-2); the generation bump
    // makes any mint hash still in flight land on nothing.
    ctx.mintGeneration += 1;
    // A failed finish is the closing tour's too: it keeps Save off, and only
    // a finish - which needs a measured level - clears it (scan-to-open
    // plan §9 #8).
    ctx.finishError = null;
    hooks.resetFinishStep();
    // The AR button reads the finish's failure ("Close AR"); it is gone
    // now (scan-to-open in AR opens a tour mid-session - M3 review #3).
    hooks.renderArEntry();
    // From here until an open SUCCEEDS there is no tour, and the page has
    // to say so: the print step goes back to asking for a link and step 4
    // offers to open one again. Both are hidden again below on success, so
    // the visible effect is only on the paths that end without a tour.
    hooks.presentNoTour();
    // Same cache: the closed tour's levels must stop voting (M4 review #1),
    // and the per-text level cache belongs to the closed tour too (M6
    // review #8).
    ctx.qrController?.reset();
    ctx.levelByText.clear();
    ctx.levelIdByText.clear();
    // The code keep-alive holds a closing tour's code for up to ~4 min,
    // and the vote budget remembers which codes voted; the pipeline
    // outlives the switch, so both end with the tour here (M2b; review #6).
    endTourCodeVotes(ctx);
    ctx.imagePlanes?.dispose();
    ctx.imagePlanes = null;
    ctx.stationContent?.dispose();
    ctx.stationContent = null;
    ctx.contentAttempted = false;
    ctx.contentError = null;
    // The gate belongs to the closing tour too (M5 review #8): a gate
    // waived for a code-less tour must not carry into one with a code.
    hooks.resetScanGate();
    for (const preview of ctx.placedPreviews.values()) preview.dispose();
    ctx.placedPreviews.clear();
    ctx.placementNote = null;
    // Clear the latch HERE too (PR #367 review): the stale run's finally is
    // generation-guarded and cannot clear it any more, and a latched
    // imagePlanesLoading blocks every later placement in the session.
    ctx.imagePlanesLoading = false;
    ctx.planesRunGeneration += 1; // invalidate any in-flight placement run
    ctx.placementAttempted = false;
    ctx.joinDeclined = false;
    // The QR line describes the CLOSING tour's codes (PR #434 review): a
    // lock, a vote count, an unknown or unusable code and a failed image
    // placement all belong to levels that just went away. Without this a
    // tour switch kept rendering "Relocalized - vote budget spent" for a
    // code the new tour does not contain, and suppressed its own
    // "no printed codes" line, which needs `lockedText === null`.
    ctx.viewerQrStatus = null;
    ctx.viewerLockedText = null;
    ctx.viewerVotedLocks = 0;
    ctx.viewerReprojectionPx = null;
    ctx.viewerUnknownCode = null;
    ctx.viewerUnusableCode = null;
    // The fused pose's hint and ?debug=1 counts too (PR #508 review): the
    // pipeline outlives a tour switch, so the counts are emptied IN PLACE -
    // it keeps writing into the same map for the new tour's codes.
    ctx.viewerLastEvaluation = null;
    ctx.fusedTallies?.clear();
    // The print-size check measured the closing tour's codes (S3a).
    ctx.printSizeCheck?.reset();
    ctx.viewerPlanesError = null;
    ctx.placement = { kind: "idle" };
    ctx.session = null;
    await closing.close().catch(() => undefined);
  }

  function renderStats(): void {
    // A file is read from the device: there is no network transfer to
    // report, and "serving from cache" would be wrong.
    if (ctx.session === null || ctx.session.fromFile) return;
    // stats().origin tracks the LATEST read, so the label flips to "serving
    // from cache" once the warm download swaps the session over —
    // archive.origin is only the initial state (PR #357 review).
    const stats = ctx.session.stats();
    const view = toStatsView(stats, ctx.session.archive.size, stats.origin);
    // The transfer numbers are a transport demo, shown only with ?debug=1
    // since polish round M2 (a creator reads the steps, not byte counts);
    // a visitor's could also stall below 100 % once the whole-file
    // download stops (UI round 1, U1, review F11).
    dom.statsPanel.hidden = !ctx.debug;
    dom.statsHeadline.textContent = view.headline;
    dom.statsDetail.textContent = view.detail;
  }

  /** Sequentially stream image entries into the gallery — each image pops
   *  in as its bytes arrive, which is the visible proof of range streaming. */
  function markReadiness(state: "opening" | "settled" | "failed"): void {
    if (dom.readiness !== undefined) dom.readiness.dataset["tourOpen"] = state;
  }

  async function fillGallery(current: TourSession): Promise<void> {
    // Only while it is shown (a `?debug=1` creator, follow-up F14): a
    // hidden gallery read, decoded and kept a URL for every photo of the
    // tour on every open, on a phone, for nothing.
    if (dom.gallery.hidden) return;
    // Never the creator's walk (scan-pass plan S1): a copy that kept it must
    // not decode its frames onto every visitor's page.
    for (const entry of entriesForVisitor(current.entries, ctx.scanEntries)) {
      if (ctx.session !== current) return; // a newer open superseded this one
      const item = document.createElement("li");
      const caption = document.createElement("figcaption");
      caption.textContent = `${entry.filename} (${String(entry.size)} B)`;
      if (entry.isImage) {
        try {
          const blob = await current.loadEntry(entry.filename);
          if (ctx.session !== current) return;
          // Measured before the <img> decodes it (tour kit K4 review R2).
          const problem = await pictureProblem(blob);
          if (ctx.session !== current) return;
          if (problem !== null) throw new Error(problem);
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          const img = document.createElement("img");
          img.src = url;
          img.alt = entry.filename;
          item.append(img);
        } catch {
          // A rejection landing after a newer open replaced the gallery must
          // not append an old archive's caption to it (PR #357 review).
          if (ctx.session !== current) return;
          caption.textContent = `${entry.filename} — failed to load`;
        }
      }
      item.append(caption);
      dom.gallery.append(item);
      renderStats();
    }
  }

  /** Every button that can start an open, with its idle label: each must
   *  show the in-progress state (M3 review #11). Step 4's paste form is gone
   *  (scan-to-open plan §2) - a scan opens without a button of its own. */
  const openButtons = (): { button: HTMLButtonElement; idle: string }[] => [
    { button: dom.openButton, idle: OPEN_BUTTON_LABEL },
    { button: dom.openFileButton, idle: OPEN_FILE_LABEL },
    { button: dom.openFileAdviceButton, idle: OPEN_FILE_ADVICE_LABEL },
  ];

  /**
   * A LATE integrity failure (tour kit plan K1, §8 D3): an entry read, or
   * the whole archive once it arrived, does not match the list the tour
   * opened with. The tour's content is removed - in AR too, through the
   * same teardown a tour switch uses - and the visitor is told why, on the
   * page and in the AR status line (the error box is outside the overlay).
   * The session already dropped its cached copy and refuses every read.
   */
  function onIntegrityFailure(
    err: TourIntegrityError,
    failed: TourSession,
  ): void {
    if (ctx.session !== failed) return; // closed or superseded: nothing shown
    void teardownSession().then(() => {
      const message = `${describeIntegrityError(err)} Its content was removed.`;
      dom.errorBox.textContent = message;
      ctx.contentError = message;
      hooks.renderArStatus();
    });
  }

  /** A late failure the session found before the page held it (its
   *  report went nowhere then): handled now, through the same teardown. */
  function reportEarlyFailure(opened: TourSession): void {
    const early = opened.integrityFailure();
    if (early !== null) onIntegrityFailure(early, opened);
  }

  /** The session a source opens; a file has its own reader (no network,
   *  no cache: the bytes are already on the device). */
  function openSession(source: TourSource): Promise<TourSession> {
    const onStats = (): void => {
      renderStats();
    };
    return source.kind === "file"
      ? openTourFile(source.file, { onIntegrityFailure })
      : openTourSession(source.url, {
          ...(cacheStore !== undefined ? { cacheStore } : {}),
          corsProxyBaseUrl,
          onStats,
          onIntegrityFailure,
        });
  }

  /** What the page shows for a newly opened tour: a link goes to the
   *  print step's prefill; a file has no link, so it is named under the
   *  error box and the print step keeps asking for one. */
  function presentSource(
    source: TourSource,
    origin: "host-step" | "measure-step",
  ): void {
    if (source.kind === "link") {
      hooks.presentTourForPrint(source.url, origin);
      return;
    }
    dom.fileStatus.textContent = fileStatusText(source.file.name);
    dom.fileStatus.hidden = false;
    hooks.presentLocalTour(origin);
  }

  function openUrl(
    url: string,
    origin: "host-step" | "measure-step" = "host-step",
    /** The printed code's text, when a code named this link (K1). */
    codeText?: string,
  ): Promise<OpenOutcome> {
    return openTour({ kind: "link", url }, origin, codeText);
  }

  /**
   * The lines about the open tour's signature (tour kit plan K1): who
   * signed it or that nobody did, the trust-on-first-use warnings for its
   * sources - the link (`linkTrustKey`) and the printed code - and, for a
   * signed tour, its links to other series. Shown in both modes, under the file line.
   */
  async function presentTrust(
    opened: TourSession,
    source: TourSource,
    codeText: string | undefined,
  ): Promise<void> {
    const sources = [
      ...(source.kind === "link" ? [linkTrustKey(opened.archive.url)] : []),
      ...(codeText === undefined ? [] : [codeTrustKey(codeText)]),
    ];
    const lines = await describeTourTrust({
      integrity: opened.integrity,
      sources,
      storage: trustStorage(),
      nowMs: Date.now(),
    }).catch(() => null);
    if (ctx.session !== opened || lines === null) return;
    dom.tourTrust.textContent = lines.join("\n");
    // An unsigned tour without a warning has no line (UI round 1; for the
    // creator too since the r820 feedback, R6).
    dom.tourTrust.hidden = lines.length === 0;
  }

  async function openTour(
    source: TourSource,
    /** Where the open came from - a step-4 scan asks the wizard to
     *  stay there rather than jump to step 2 (M3 review #1). */
    origin: "host-step" | "measure-step" = "host-step",
    codeText?: string,
  ): Promise<OpenOutcome> {
    // Another tour would replace one whose rebuilt file was not saved: ask
    // first (UI round 1, U2; the work itself stays in the draft).
    if (ctx.session !== null && !hooks.confirmLeaveTour()) {
      return { kind: "cancelled" };
    }
    const generation = ++ctx.openGeneration;
    opening = true;
    markReadiness("opening");
    dom.errorBox.textContent = "";
    dom.fileStatus.hidden = true;
    dom.tourTrust.hidden = true;
    dom.fileAdvice.hidden = true;
    // Async-UI rule: the in-progress state engages BEFORE the first await —
    // teardown of a previous session is async, and a second submission
    // landing in that window used to race the button state (PR #357 review).
    for (const { button } of openButtons()) {
      button.disabled = true;
      button.textContent = "Opening…";
    }
    try {
      // INSIDE the try (PR #365 review): a throw from the previous session's
      // teardown (controller reset, three.js disposals) otherwise rejected
      // openUrl before the catch/finally existed — the button stayed
      // "Opening…" forever and the error surfaced nowhere.
      await teardownSession();
      const opened = await openSession(source);
      if (generation !== ctx.openGeneration) {
        // A newer open superseded this one while it was in flight (e.g. a
        // click racing the ?qr= boot) — the loser cleans itself up.
        await opened.close().catch(() => undefined);
        return { kind: "superseded" };
      }
      ctx.session = opened;
      ctx.tourLabel = labelOf(source);
      // Pending BEFORE the placement trigger below: the photos' baked spots
      // live in tour.json, and a trigger that saw the teardown's "settled"
      // with no manifest would decline them for the whole session (S1
      // milestone review #4; archive-open-order.test.ts).
      ctx.tourManifestStatus = "pending";
      renderStats();
      // A tour opened AFTER entering AR places itself from the open path
      // (flows plan M4, review #8) - not from the levels continuation
      // below, whose rejection would otherwise silently cancel a GPS-only
      // feature.
      hooks.tryPlaceTour();
      presentSource(source, origin);
      void presentTrust(opened, source, codeText);
      // The placed content (guided-setup plan M3): the finish step writes
      // it back, so a re-measure never drops what an earlier session placed.
      // A broken manifest is an error the creator must see (the framework's
      // rule for this file), not a silently empty tour.
      /** The tour settles: the document opens `document` (what the
       *  creator edits) while the page reads the file's own `manifest`. */
      const settle = (
        manifest: TourManifest | null,
        document: TourManifest | null,
      ) => {
        // The creator's work made before the manifest settled (or before
        // any tour opened) comes along (scan-to-open plan §9 #5).
        ctx.tourDocument.open(document);
        ctx.tourManifestStatus = "settled";
        hooks.presentTourInfo({
          manifest,
          loadImage: (path) =>
            opened.loadEntry(`${opened.manifestWrap}${path}`),
        });
        ctx.scanEntries = new Set(
          manifest === null
            ? []
            : scanEntryNames(
                opened.entries.map((e) => e.filename),
                manifest,
                opened.manifestWrap,
              ),
        );
        // The background download fetches the WHOLE file; a visitor of a
        // baked copy that kept the walk reads entries on demand instead.
        // The archive's dispose aborts the download AND its recovery
        // download for a host that stops honouring ranges mid-session
        // (S1 milestone review #5): accepted for this copy only.
        if (
          stopsVisitorDownload(
            deps.mode,
            ctx.scanEntries,
            manifest?.captureSpots !== undefined,
          )
        ) {
          opened.archive.dispose();
        }
        // The gallery waits for the manifest, which says what it shows.
        const filled = fillGallery(opened);
        // Only now can a draft be judged: "already hosted" is a question
        // about this manifest.
        hooks.presentDraftForTour(tourKeyOf(source, opened));
        hooks.renderAuthorReadout();
        hooks.tryPlaceTour(); // a visitor's content may now be placeable
        return filled;
      };
      const manifestDone = opened.loadTourManifest().then(
        (manifest) => {
          if (ctx.session !== opened) return;
          if (deps.mode !== "creator") return settle(manifest, manifest);
          // A creator's zip without tour.json (a recording) opens as an
          // empty unnamed tour, not as "no tour": its stations exist from
          // the first placement, for the HUD, the settle and the write
          // alike. A visitor's stays "no tour".
          const base = manifest ?? createEmptyTourManifest();
          if (!opened.hasRecording || base.captureSpots !== undefined) {
            ctx.walkBake = { kind: "decided", photos: {} };
            return settle(manifest, base);
          }
          // The recording's photos are baked once, now, into the tour's
          // stations by the station rule (`walkAtOpen`): the tour opens
          // with them, so no station appears or moves at the Finish. The
          // open settles when the bake has run; work placed meanwhile
          // comes along by the rule.
          ctx.walkBake = { kind: "baking", done: 0, total: 0 };
          hooks.renderAuthorReadout();
          return walkAtOpen(opened, base, {
            shouldContinue: () => ctx.session === opened,
            onChunk: (done, total) => {
              if (ctx.session !== opened) return;
              ctx.walkBake = { kind: "baking", done, total };
              hooks.renderAuthorReadout();
            },
          }).then((walk) => {
            if (ctx.session !== opened) return;
            ctx.walkBake = { kind: "decided", photos: walk.photos };
            return settle(manifest, walk.manifest);
          });
        },
        (err: unknown) => {
          if (ctx.session !== opened) return;
          // The finish step refuses on "broken" (M3 review #5): it must not
          // overwrite a placement it could not read.
          ctx.tourManifestStatus = "broken";
          const filled = fillGallery(opened);
          dom.errorBox.textContent = `Reading the tour's content list (tour.json) failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          hooks.renderAuthorReadout();
          return filled;
        },
      );
      // A tour opened INTO a running session gets its own gate (M5 review
      // #8); on the plain page this is idle until the session starts.
      hooks.startScanGate();
      // The authored levels ride the same zip; a newer open's guard keeps a
      // slow load from installing a closed tour's levels.
      const levelsDone = opened
        .loadQrLevels()
        .then((levels) => {
          if (ctx.session !== opened) return;
          ctx.currentLevels = levels;
          ctx.currentLevelTexts = opened.levelTexts();
          hooks.presentTourCodes();
          hooks.presentTourLevels();
          hooks.renderAuthorReadout();
          hooks.reconsiderScanGate(levels);
          // The controller caches a level (or the negative-cache
          // placeholder) per decoded text; levels arriving AFTER a scan
          // would otherwise be invisible until AR re-entry (M4 milestone
          // review #1).
          ctx.qrController?.reset();
          ctx.viewerUnknownCode = null;
          ctx.viewerUnusableCode = null;
          ctx.viewerPlanesError = null;
          hooks.renderArStatus();
        })
        .catch((err: unknown) => {
          // Never had a catch (flows plan review #8): a rejecting level
          // parse died as an unhandled rejection. The tour still works
          // without levels; say what failed and keep the placement path
          // alive.
          if (ctx.session !== opened) return;
          dom.errorBox.textContent = `Reading the tour's printed-code levels failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          // These levels never come: no code of this tour can place it
          // (r857 review #4), and the visitor's line says so.
          ctx.levelsUnreadable = true;
          hooks.presentTourLevels();
          // The gate cannot wait for levels that never come (M5 review #1);
          // its own line names the failure inside the overlay.
          hooks.reconsiderScanGate("unavailable");
        });
      // Settled once this open's own work has run - never by an older open
      // after a newer one began.
      void Promise.allSettled([manifestDone, levelsDone]).then(() => {
        if (ctx.session === opened) markReadiness("settled");
      });
      reportEarlyFailure(opened);
      return { kind: "opened" };
    } catch (err) {
      if (generation !== ctx.openGeneration) return { kind: "superseded" };
      markReadiness("failed");
      const cause =
        err instanceof OpenRemoteArchiveError ? err.rejectCause : "other";
      dom.errorBox.textContent = describeOpenError(
        err,
        source.kind === "link" ? source.url : undefined,
        deps.mode,
      );
      // A host that blocks browsers: the advice says "download the file
      // and open it here", and its button is right below it (K0). Offline,
      // missing, broken or too large: a download would not help.
      dom.fileAdvice.hidden = !offersFileOpen(cause);
      // The scan-to-open retry policy reads the cause (plan §9 #7).
      return { kind: "failed", cause };
    } finally {
      // Guarded like every other effect in this function: a superseded
      // open's finally must not undo the newer open's in-progress state
      // (PR #357 review).
      if (generation === ctx.openGeneration) {
        opening = false;
        for (const { button, idle } of openButtons()) {
          button.disabled = false;
          button.textContent = idle;
        }
      }
    }
  }

  // Step 4's scan-to-open (plan §2, §9): the first code the creator's
  // camera reads opens the tour it names. The link of record follows the
  // open, as for a ?qr= boot (§9 #15).
  const scanOpen = createScanOpen({
    ctx,
    resolve: codeResolver(corsProxyBaseUrl),
    open: (url, codeText) => {
      dom.linkInput.value = url;
      return openUrl(url, "measure-step", codeText);
    },
    isOpening: () => opening,
    now: () => performance.now(),
    render: () => {
      hooks.renderAuthorReadout();
    },
  });

  /** The link the last check ran for: a paste followed by the field's
   *  `change` must not check the same link twice. */
  let lastChecked: string | null = null;
  /** The link being checked right now: "Check link" tapped while it runs
   *  (the field's `change` fires on that same blur) is not a retry
   *  (PR #585 review). */
  let checking: string | null = null;

  /** Step 2's check (polish round M2, A13/A16): the open itself, with its
   *  outcome in the status line. A link whose file is not there yet, or
   *  that could not be asked offline, still goes on to printing - marked
   *  unverified - so the creator gives the link once. */
  async function checkLinkStep(url: string): Promise<OpenOutcome> {
    lastChecked = url;
    checking = url;
    showLinkStatus({ kind: "checking" });
    const outcome = await openUrl(url).finally(() => {
      if (checking === url) checking = null;
    });
    if (outcome.kind === "opened") {
      showLinkStatus({ kind: "found" });
    } else if (outcome.kind === "failed") {
      showLinkStatus({ kind: "failed", cause: outcome.cause }, url);
      // Where the link points decides (M0c review): a missing file is a
      // wrong link on a cloud host, "not there yet" on an own server.
      if (printsUnverified(outcome.cause, hostOfLink(url))) {
        // The status line is the whole message for a tolerated failure:
        // the open's own error ("that file does not exist") would
        // contradict its "that is fine for now" (PRs #584/#585 reviews).
        dom.errorBox.textContent = "";
        hooks.presentUnverifiedLink(url);
      }
    } else if (outcome.kind === "cancelled") {
      // The creator stayed with the open tour: this link was not checked.
      lastChecked = null;
      dom.linkStatus.hidden = true;
    }
    // superseded: the newer check owns the line.
    return outcome;
  }

  function showLinkStatus(status: LinkStatus, url?: string): void {
    dom.linkStatus.textContent = linkStatusText(
      status,
      url === undefined ? null : hostOfLink(url),
    );
    dom.linkStatus.hidden = false;
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = dom.linkInput.value.trim();
    if (url !== "" && url !== checking) void checkLinkStep(url);
  });
  // The check runs by itself (A16): on a paste - the value lands after the
  // event, hence the deferral - and when the field is left with a new link.
  const autoCheck = (): void => {
    const url = dom.linkInput.value.trim();
    if (url !== "" && url !== lastChecked) void checkLinkStep(url);
  };
  dom.linkInput.addEventListener("paste", () => {
    setTimeout(autoCheck, 0);
  });
  dom.linkInput.addEventListener("change", autoCheck);

  // "Open a file" (tour kit plan K0): both buttons open the one picker;
  // the pick opens the tour. The value is cleared so picking the SAME file
  // again (after a fix, or a failed open) still fires `change`.
  for (const button of [dom.openFileButton, dom.openFileAdviceButton]) {
    button.addEventListener("click", () => {
      dom.fileInput.click();
    });
  }
  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    dom.fileInput.value = "";
    if (file !== undefined) void openTour({ kind: "file", file });
  });

  wireClearCache(ctx, dom, cacheStore);

  return {
    scanOpen,
    openLink: async (url) => {
      // Not step 2's check (PR #637 review): a link the box could not open
      // is never handed on to printing, nor made step 2's link - step 2
      // hears of it once it opened. The open's own error stays for the box.
      const outcome = await openUrl(url);
      if (outcome.kind === "opened") {
        dom.linkInput.value = url;
        lastChecked = url;
        showLinkStatus({ kind: "found" });
      }
      return outcome;
    },
    openFile: (file) => openTour({ kind: "file", file }),
    boot: async () => {
      const payload = new URLSearchParams(location.search).get("qr");
      if (payload === null) return;
      const url = await resolveQrPayload(payload, DEFAULT_ASSET_PREFIX);
      if (url === null) {
        dom.errorBox.textContent =
          "This QR launch link carries an unreadable payload.";
        return;
      }
      dom.linkInput.value = url;
      await openUrl(url, "host-step", payload);
    },
  };
}

/** What the creator's panel calls the tour: a link's `tourLabel`, or a
 *  file's name, short. */
function labelOf(source: TourSource): string {
  if (source.kind === "link") return tourLabel(source.url);
  const name = source.file.name;
  return name.length > 24 ? `${name.slice(0, 24)}…` : name;
}

/** The tour's identity for its draft: its link as the creator gave it,
 *  or for a file the content key the session was opened under
 *  (`tour-file-key.ts`, also its `archive.url`). */
function tourKeyOf(source: TourSource, opened: TourSession): string {
  return source.kind === "link" ? source.url : opened.archive.url;
}

/** The line under the error box once a tour opened from a file - seen by
 *  a visitor too, so it only says what happened; step 1's own copy tells
 *  a creator that a file has no link to print. */
function fileStatusText(name: string): string {
  return `Opened "${name}" from this device.`;
}

/** The Storage section (flows plan M2, DEC-F1): hidden entirely without a
 *  cache store; the clear control counts before the eviction, aborts the
 *  session's warm download through `evict()`, and confirms with a timed
 *  label. */
function wireClearCache(
  ctx: TourViewerSession,
  dom: ArchiveOpenDom,
  cacheStore: BoundedLocalCacheStore | undefined,
): void {
  // Without a cache there is nothing to clear and nothing to explain — hide
  // the whole Storage section (?nocache=1, or a browser without the Cache
  // API).
  if (cacheStore === undefined) {
    dom.storagePanel.hidden = true;
    return;
  }
  /** The confirmation's revert timer; cleared on the next click so a click
   *  during the transient cannot capture it as the idle label. */
  let revertTimer: ReturnType<typeof setTimeout> | null = null;
  dom.clearCacheButton.addEventListener("click", () => {
    if (revertTimer !== null) clearTimeout(revertTimer);
    revertTimer = null;
    dom.clearCacheButton.disabled = true;
    dom.clearCacheButton.textContent = "Clearing…";
    // Count BEFORE the open session's eviction drops its copy from the index
    // (flows plan M2, review #3), then evict-then-clear: `evict()` aborts
    // the session's warm download and disarms every later writer, so the
    // store is durably empty when "Cache cleared" appears (PR #358 review
    // #1) and the button no longer waits for a tens-of-MB download.
    void cacheStore
      .size()
      .then(async (stored) => {
        if (ctx.session !== null) await ctx.session.archive.evict();
        await cacheStore.clear();
        return stored;
      })
      .then(
        (stored) => {
          dom.clearCacheButton.disabled = false;
          dom.clearCacheButton.textContent = clearCacheLabel(stored);
          revertTimer = setTimeout(() => {
            revertTimer = null;
            dom.clearCacheButton.textContent = "Clear cache";
          }, 2000);
        },
        (err: unknown) => {
          // Async-UI rule: a failure must surface and the in-progress state
          // must revert — the old version reported "Cache cleared" either
          // way.
          dom.clearCacheButton.disabled = false;
          dom.clearCacheButton.textContent = "Clear cache";
          dom.errorBox.textContent = `Clearing the cache failed: ${err instanceof Error ? err.message : String(err)}`;
        },
      );
  });
}
