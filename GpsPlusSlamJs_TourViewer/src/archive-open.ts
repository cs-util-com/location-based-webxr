/**
 * The open path: the paste-a-link form and the `?qr=` boot, the streaming
 * session's lifetime (open, teardown), the live stats panel, the
 * progressive gallery, and the Storage section's clear-cache control. All
 * transport policy lives in the framework (`openRemoteArchive`) and in
 * `tour-session.ts`; this is the DOM glue. Its own module since the flows
 * plan M6.
 */

import type { BoundedLocalCacheStore } from "gps-plus-slam-app-framework/storage";
import { resolveQrPayload } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-dispatch";

import { describeOpenError } from "./open-errors.js";
import { toStatsView } from "./stats-view.js";
import { clearCacheLabel } from "./tour-flow.js";
import { openTourSession, type TourSession } from "./tour-session.js";
import type {
  TourViewerHooks,
  TourViewerSession,
} from "./tour-viewer-session.js";

/** Bare-name `?qr=` payloads resolve under this prefix — the convention the
 *  QR builder's `defaultAssetPrefix` example documents. */
const DEFAULT_ASSET_PREFIX =
  "https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/";

/** The label on every button that opens a tour. "Open" until the second
 *  testing session (F6): nobody wants to open the zip, they want to know
 *  the link works - and a link that opens here is one the printed code can
 *  carry. */
const OPEN_BUTTON_LABEL = "Test link";

/** Step 4's own open button. A different label on purpose: by then the
 *  creator is not testing a link, they are getting the tour onto the
 *  device they are holding. */
const MISSING_OPEN_LABEL = "Open the tour here";

export interface ArchiveOpenDom {
  form: HTMLFormElement;
  linkInput: HTMLInputElement;
  openButton: HTMLButtonElement;
  /** Step 4's "this device does not have the tour" form (F12) - the SAME
   *  control over the SAME state, surfaced where the link is missing. Its
   *  input mirrors into `linkInput` before the open, so the page keeps one
   *  link of record and one open path. */
  missingForm: HTMLFormElement;
  missingInput: HTMLInputElement;
  missingButton: HTMLButtonElement;
  /** The block holding that form; hidden once a tour is actually open. */
  missingBlock: HTMLElement;
  statsPanel: HTMLDivElement;
  statsHeadline: HTMLDivElement;
  statsDetail: HTMLDivElement;
  errorBox: HTMLElement;
  gallery: HTMLUListElement;
  storagePanel: HTMLDetailsElement;
  clearCacheButton: HTMLButtonElement;
}

/** The one entry point the composition root needs; the interactive open
 *  is reached through the form listener (M6 review #6: an `openUrl` handle
 *  was returned and never called). */
export interface ArchiveOpen {
  /** The `?qr=` launch: resolve the payload and open. Rejections reach the
   *  error box - a printed code is the one flow with no retry. */
  boot: () => Promise<void>;
}

export function wireArchiveOpen(deps: {
  ctx: TourViewerSession;
  dom: ArchiveOpenDom;
  /** Undefined = no local copies (`?nocache=1`, no Cache API). */
  cacheStore: BoundedLocalCacheStore | undefined;
  corsProxyBaseUrl: string;
  hooks: TourViewerHooks;
}): ArchiveOpen {
  const { ctx, dom, cacheStore, corsProxyBaseUrl, hooks } = deps;
  let objectUrls: string[] = [];

  async function teardownSession(): Promise<void> {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
    dom.gallery.replaceChildren();
    // The viewer pipeline's level source and the placed planes belong to the
    // closing tour — a newly opened tour must not relocalize against them.
    ctx.currentLevels = null;
    ctx.tourManifest = null;
    ctx.tourManifestStatus = "settled";
    ctx.rebuiltZip = null;
    hooks.resetFinishStep();
    // Same cache: the closed tour's levels must stop voting (M4 review #1),
    // and the per-text level cache belongs to the closed tour too (M6
    // review #8).
    ctx.qrController?.reset();
    ctx.levelByText.clear();
    ctx.imagePlanes?.dispose();
    ctx.imagePlanes = null;
    ctx.contentRendered?.dispose();
    ctx.contentRendered = null;
    ctx.contentAttempted = false;
    ctx.contentError = null;
    // The gate belongs to the closing tour too (M5 review #8): a gate
    // waived for a code-less tour must not carry into one with a code.
    hooks.resetScanGate();
    // The creator's placed objects belong to the closing tour (M4 review
    // #1): carried into another tour they would be written into ITS zip,
    // and into the same tour re-opened after a finish they would duplicate
    // their own ids and break every later finish.
    ctx.placedObjects = [];
    for (const preview of ctx.placedPreviews) preview.dispose();
    ctx.placedPreviews = [];
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
    ctx.viewerPlanesError = null;
    ctx.placement = { kind: "idle" };
    if (ctx.session !== null) {
      const closing = ctx.session;
      ctx.session = null;
      await closing.close().catch(() => undefined);
    }
  }

  function renderStats(): void {
    if (ctx.session === null) return;
    // stats().origin tracks the LATEST read, so the label flips to "serving
    // from cache" once the warm download swaps the session over —
    // archive.origin is only the initial state (PR #357 review).
    const stats = ctx.session.stats();
    const view = toStatsView(stats, ctx.session.archive.size, stats.origin);
    dom.statsPanel.hidden = false;
    dom.statsHeadline.textContent = view.headline;
    dom.statsDetail.textContent = view.detail;
  }

  /** Sequentially stream image entries into the gallery — each image pops
   *  in as its bytes arrive, which is the visible proof of range streaming. */
  async function fillGallery(current: TourSession): Promise<void> {
    for (const entry of current.entries) {
      if (ctx.session !== current) return; // a newer open superseded this one
      const item = document.createElement("li");
      const caption = document.createElement("figcaption");
      caption.textContent = `${entry.filename} (${String(entry.size)} B)`;
      if (entry.isImage) {
        try {
          const blob = await current.loadEntry(entry.filename);
          if (ctx.session !== current) return;
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

  /** Every button that can start an open. Both must show the in-progress
   *  state: a live, unlabelled second button through a whole open is the
   *  async-UI rule broken in the file that documents it most carefully
   *  (M3 review #11). */
  const openButtons = (): { button: HTMLButtonElement; idle: string }[] => [
    { button: dom.openButton, idle: OPEN_BUTTON_LABEL },
    { button: dom.missingButton, idle: MISSING_OPEN_LABEL },
  ];

  async function openUrl(
    url: string,
    /** Where the creator submitted from - step 4's form asks the wizard to
     *  stay there rather than jump to step 2 (M3 review #1). */
    origin: "host-step" | "measure-step" = "host-step",
  ): Promise<void> {
    const generation = ++ctx.openGeneration;
    dom.errorBox.textContent = "";
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
      const opened = await openTourSession(url, {
        ...(cacheStore !== undefined ? { cacheStore } : {}),
        corsProxyBaseUrl,
        onStats: () => {
          renderStats();
        },
      });
      if (generation !== ctx.openGeneration) {
        // A newer open superseded this one while it was in flight (e.g. a
        // click racing the ?qr= boot) — the loser cleans itself up.
        await opened.close().catch(() => undefined);
        return;
      }
      ctx.session = opened;
      renderStats();
      void fillGallery(opened);
      // A tour opened AFTER entering AR places itself from the open path
      // (flows plan M4, review #8) - not from the levels continuation
      // below, whose rejection would otherwise silently cancel a GPS-only
      // feature.
      hooks.tryPlaceTour();
      // Step 4's "this device has no tour" block has served its purpose -
      // and only NOW, on a successful open (M3 review #13). A pasted link
      // fails often on a phone, and a block that hid on submit would take
      // the retry away at the moment it is needed.
      dom.missingBlock.hidden = true;
      hooks.presentTourForPrint(url, origin);
      // The placed content (guided-setup plan M3): the finish step writes
      // it back, so a re-measure never drops what an earlier session placed.
      // A broken manifest is an error the creator must see (the framework's
      // rule for this file), not a silently empty tour.
      ctx.tourManifestStatus = "pending";
      void opened.loadTourManifest().then(
        (manifest) => {
          if (ctx.session !== opened) return;
          ctx.tourManifest = manifest;
          ctx.tourManifestStatus = "settled";
          hooks.renderAuthorReadout();
          hooks.tryPlaceTour(); // a visitor's content may now be placeable
        },
        (err: unknown) => {
          if (ctx.session !== opened) return;
          // The finish step refuses on "broken" (M3 review #5): it must not
          // overwrite a placement it could not read.
          ctx.tourManifestStatus = "broken";
          dom.errorBox.textContent = `Reading the tour's content list (tour.json) failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          hooks.renderAuthorReadout();
        },
      );
      // A tour opened INTO a running session gets its own gate (M5 review
      // #8); on the plain page this is idle until the session starts.
      hooks.startScanGate();
      // The authored levels ride the same zip; a newer open's guard keeps a
      // slow load from installing a closed tour's levels.
      void opened
        .loadQrLevels()
        .then((levels) => {
          if (ctx.session !== opened) return;
          ctx.currentLevels = levels;
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
          // The gate cannot wait for levels that never come (M5 review #1);
          // its own line names the failure inside the overlay.
          hooks.reconsiderScanGate("unavailable");
        });
    } catch (err) {
      if (generation === ctx.openGeneration) {
        dom.errorBox.textContent = describeOpenError(err, url);
      }
    } finally {
      // Guarded like every other effect in this function: a superseded
      // open's finally must not undo the newer open's in-progress state
      // (PR #357 review).
      if (generation === ctx.openGeneration) {
        for (const { button, idle } of openButtons()) {
          button.disabled = false;
          button.textContent = idle;
        }
      }
    }
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = dom.linkInput.value.trim();
    if (url !== "") void openUrl(url);
  });

  // Step 4's form (F12). It writes into the ONE link of record first, so
  // there is never a second value that could disagree with step 1's.
  dom.missingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = dom.missingInput.value.trim();
    if (url === "") return;
    dom.linkInput.value = url;
    void openUrl(url, "measure-step");
  });

  wireClearCache(ctx, dom, cacheStore);

  return {
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
      await openUrl(url);
    },
  };
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
