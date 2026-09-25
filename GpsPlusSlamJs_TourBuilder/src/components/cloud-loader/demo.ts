/**
 * Standalone demo for Component 6 — cloud-storage tour source, no Three.js, no
 * GPS, no store. It drives the real `openRemoteTour` + `AssetProvider` against a
 * hosted `tour.zip` URL — or a share *page* link pasted straight from a cloud
 * provider, which is auto-normalized and (for known no-CORS hosts, in dev)
 * auto-routed through the built-in proxy — and shows the four beats of
 * §2.5.4/§2.5.6:
 *
 *   1. tour.json + POIs render immediately, before the whole archive downloads;
 *   2. an asset fetched by range → a 206 Partial Content in the Network panel;
 *   3. the background warm completes → the source label flips remote → local,
 *      and a further asset read issues no new request;
 *   4. a range-refusing link still works via the full-download fallback (paste
 *      a URL whose host answers 200 to a Range request — see RECIPE.md).
 *
 * Uses the browser defaults (`URL.createObjectURL`, Cache API), so it exercises
 * exactly the transport the Node suite cannot (Option B, C19).
 */

import { prepareHostedZipUrl } from "../shared/hosted-zip-url.js";

import type { AssetEntry } from "../../store/types.js";
import { TourLoadError } from "./core/errors.js";
import { openRemoteTour, type OpenedTour } from "./view/open-remote-tour.js";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const logEl = $("log");
const sourceEl = $("source");

function log(message: string): void {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function previewAsset(asset: AssetEntry, url: string): void {
  const preview = $("preview");
  if (asset.type === "sprite") {
    preview.innerHTML = `<img alt="${asset.id}" src="${url}" />`;
  } else if (asset.type === "audio") {
    preview.innerHTML = `<audio controls src="${url}"></audio>`;
  } else {
    preview.innerHTML = `<a href="${url}" download="${asset.id}.glb">download ${asset.id}</a>`;
  }
}

function renderAssetButtons(opened: OpenedTour): void {
  const container = $("assets");
  container.innerHTML = "";
  for (const asset of opened.tour.assets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `getAssetUrl("${asset.id}")`;
    btn.addEventListener("click", () => {
      void (async () => {
        log(`requesting asset "${asset.id}" (${asset.type})…`);
        try {
          const url = await opened.assetProvider.getAssetUrl(asset.id);
          log(`  → Blob URL for "${asset.id}" (check Network panel for 206)`);
          previewAsset(asset, url);
        } catch (err) {
          log(`  ✗ ${asset.id} failed: ${String(err)}`);
        }
      })();
    });
    container.append(btn);
  }
}

async function load(): Promise<void> {
  const raw = $<HTMLInputElement>("url").value.trim();
  if (!raw) {
    log("enter a tour.zip URL or share link first");
    return;
  }
  const { url, notes } = prepareHostedZipUrl(raw, import.meta.env.DEV);
  $("tour").textContent = "";
  $("assets").innerHTML = "";
  $("preview").innerHTML = "";
  sourceEl.textContent = "remote (range)";
  for (const note of notes) log(note);
  log(`opening ${url} …`);

  let opened: OpenedTour;
  try {
    opened = await openRemoteTour(url);
  } catch (err) {
    const cause = err instanceof TourLoadError ? ` [${err.loadCause}]` : "";
    log(`✗ could not open tour${cause}: ${String(err)}`);
    sourceEl.textContent = "—";
    return;
  }

  // Beat 1: POIs available before the archive has finished downloading.
  const { tour } = opened;
  $("tour").textContent =
    `${tour.name} — ${tour.waypoints.length} waypoints, ${tour.assets.length} assets ` +
    `(POIs: ${tour.waypoints.map((w) => w.id).join(", ")})`;
  log(
    `✓ tour "${tour.name}" ready before full download — request assets below`,
  );

  // Beat 2: per-asset range fetch on demand.
  renderAssetButtons(opened);

  // Beat 3: the warm completes and the byte-source switches to local.
  void opened.cacheWarming.then(() => {
    sourceEl.textContent = "local (cache)";
    log("✓ background warm complete — byte-source switched to local copy");
  });
}

$("load").addEventListener("click", () => void load());
