/**
 * App shell: wires the `?qr=` launch dispatch, the paste-a-link form, the
 * streaming session, the live stats panel and the progressive gallery
 * together. All policy lives in the framework (`openRemoteArchive`) and the
 * colocated view-model modules; this file is the thin DOM layer the e2e
 * suite drives.
 */

import {
  BoundedLocalCacheStore,
  CacheApiStore,
  OpenRemoteArchiveError,
  type LocalCacheStore,
} from "gps-plus-slam-app-framework/storage";

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
  const view = toStatsView(
    session.stats(),
    session.archive.size,
    session.archive.origin,
  );
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
        caption.textContent = `${entry.filename} — failed to load`;
      }
    }
    item.append(caption);
    gallery.append(item);
    renderStats();
  }
}

async function openUrl(url: string): Promise<void> {
  errorBox.textContent = "";
  await teardownSession();
  // Async-UI rule: a visible in-progress state for the whole open, restored
  // (or replaced by the error banner) when the promise settles.
  openButton.disabled = true;
  openButton.textContent = "Opening…";
  try {
    const opened = await openTourSession(url, {
      ...(cacheStore !== undefined ? { cacheStore } : {}),
      onStats: () => {
        renderStats();
      },
    });
    session = opened;
    renderStats();
    void fillGallery(opened);
  } catch (err) {
    errorBox.textContent = describeOpenError(err);
  } finally {
    openButton.disabled = false;
    openButton.textContent = "Open";
  }
}

element<HTMLFormElement>("open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = linkInput.value.trim();
  if (url !== "") void openUrl(url);
});

clearCacheButton.addEventListener("click", () => {
  if (!(cacheStore instanceof BoundedLocalCacheStore)) return;
  clearCacheButton.disabled = true;
  clearCacheButton.textContent = "Clearing…";
  void cacheStore
    .clear()
    .catch(() => undefined)
    .then(() => {
      clearCacheButton.disabled = false;
      clearCacheButton.textContent = "Cache cleared";
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

void boot();
