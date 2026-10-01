/**
 * Map-Centric Recording Browser (full-bleed map + floating overlays)
 *
 * The desktop browser the user drives to find and replay recordings spatially
 * (D3 + D3a). Layout follows the app's native idiom — a full-viewport Leaflet
 * map with translucent overlay panels on top, like a maps app — NOT a
 * side-by-side split or a centered modal:
 *   - the map fills the container (which the app gives `fixed inset-0`);
 *   - a search field floats top-center (D5 name search);
 *   - a tour-list panel floats on the left (the selected tile's tours, or all
 *     filtered tours when no tile is selected);
 *   - a close button floats top-right.
 *
 * H3 coverage tiles are drawn from each recording's coverage cells, clustered to
 * the current zoom via `clusterCellsByZoom` (through `buildTileIndex`). Clicking
 * a tile lists the tours crossing it; clicking a tour invokes `onPlayTour` (v1
 * plays exactly one tour — multi-tour replay is deferred, D4).
 *
 * The Leaflet wiring here is thin; the load-bearing logic lives in the pure,
 * unit-tested `map-browser-index.ts`. This component is covered by Playwright
 * e2e (`playwright-tests/map-browser.spec.js`).
 *
 * @see ./map-browser-index.ts
 * @see ./recording-index.ts
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md (D3/D3a/D5)
 */

import L from 'leaflet';
import { cellToBoundary } from 'h3-js';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { addOsmTileLayer } from 'gps-plus-slam-app-framework/visualization/osm-tile-layer';
import { FIT_BOUNDS_PADDING } from './map-osm-base';
import type { RecordingCoverage } from './recording-index';
import type { BackfillResult } from '../storage/coverage-backfill';
import {
  buildTileIndex,
  leafletZoomToH3Res,
  toursAtTile,
  filterRecordingsByName,
  coverageCellLatLngs,
  type TileIndex,
} from './map-browser-index';

const log = createLogger('MapBrowser');

const RESIZE_DELAY_MS = 200;
/** How long the "N recordings" confirmation lingers before the pill hides. */
const PROGRESS_DONE_LINGER_MS = 1200;
/** Zoom used when the map cannot frame coverage (no cells). Whole-world view. */
const WORLD_ZOOM = 2;
/** Accent colour for coverage tiles (reuses the fused-path palette entry). */
const TILE_COLOR = VIS_COLORS.FUSED_VIO.css;

/** Options for {@link createMapBrowser}. */
export interface MapBrowserOptions {
  /**
   * Initial recordings with their H3 coverage (from `buildRecordingIndex`).
   * Optional and defaults to empty: the progressive flow mounts the browser
   * before any coverage exists and streams recordings in via `addRecording`.
   */
  readonly recordings?: readonly RecordingCoverage[];
  /** Invoked when the user picks a single tour to replay (D3 — one at a time). */
  readonly onPlayTour: (recording: RecordingCoverage) => void;
  /** Invoked when the user closes the browser (optional). */
  readonly onClose?: () => void;
  /**
   * Invoked when the user opts in to the one-time in-zip coverage backfill
   * (Slice B). When provided AND there are backfillable (legacy, with coverage)
   * recordings, a "Speed up future loads" button appears once indexing finishes.
   * The click is the user gesture that the `readwrite` permission upgrade needs.
   * Resolves with the outcome so the button can show its final state.
   */
  readonly onBackfill?: () => Promise<BackfillResult>;
}

/** Imperative handle for the browser, also used to drive it from e2e tests. */
export interface MapBrowserInstance {
  /** Tear down the Leaflet map and remove all DOM. */
  destroy(): void;
  /** The H3 resolution tiles are currently drawn at (derived from zoom). */
  getRes(): number;
  /** Tile cells currently rendered on the map. */
  getRenderedTiles(): string[];
  /** Select a tile (filters the tour list to its tours), or `null` to clear. */
  selectTile(tileCell: string | null): void;
  /** Set the name-search query (mirrors the search input). */
  setNameQuery(query: string): void;
  /**
   * Append a recording to the browser and re-render. Re-renders are coalesced
   * (one per animation frame) so streaming a whole folder does not trigger a
   * tile rebuild per recording. The map is framed to coverage exactly once —
   * on the first recording that carries cells — and not moved thereafter (O1).
   */
  addRecording(recording: RecordingCoverage): void;
  /**
   * Drive the indexing progress pill. While `done < total` it shows a spinner +
   * "Indexing done / total…"; once `done === total` it shows a brief
   * confirmation and then auto-hides (the durable-end-state rule). `total <= 0`
   * hides it immediately (nothing to index).
   */
  setIndexingProgress(done: number, total: number): void;
}

const OVERLAY_PANEL_CLASS =
  'absolute z-[1000] bg-black/70 text-white rounded-lg shadow-lg backdrop-blur-sm';

/**
 * Create the map-centric recording browser inside `container`.
 *
 * `container` should be a full-viewport, positioned element (the app passes a
 * `fixed inset-0` element). Returns `null` if Leaflet initialisation fails.
 */
export function createMapBrowser(
  container: HTMLElement | null,
  options: MapBrowserOptions
): MapBrowserInstance | null {
  if (!container) {
    log.warn('Cannot create map browser: container is null');
    return null;
  }

  try {
    // The container is the positioning context for the overlays. The app passes
    // a `fixed inset-0` element, which already establishes a positioning context
    // and full-viewport size — do NOT add `relative` here: Tailwind's `.relative`
    // overrides `.fixed` (later in the stylesheet), collapsing the full-bleed
    // container to zero height. Only clip overflow.
    container.classList.add('overflow-hidden');
    container.setAttribute('data-testid', 'map-browser');

    // --- Full-bleed map element ---
    const mapEl = document.createElement('div');
    mapEl.setAttribute('data-testid', 'map-browser-map');
    mapEl.className = 'absolute inset-0 z-0';
    container.appendChild(mapEl);

    // --- Search field overlay (top-center, like a maps search bar) ---
    const searchWrap = document.createElement('div');
    searchWrap.className = `${OVERLAY_PANEL_CLASS} top-3 left-1/2 -translate-x-1/2 px-2 py-1`;
    const searchInput = document.createElement('input');
    searchInput.setAttribute('data-testid', 'map-browser-search');
    searchInput.type = 'search';
    searchInput.placeholder = 'Filter recordings by name…';
    searchInput.className =
      'bg-transparent text-white placeholder-gray-300 text-sm px-2 py-1 w-64 focus:outline-none';
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    // --- Close button overlay (top-right) ---
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('data-testid', 'map-browser-close');
    closeBtn.className = `${OVERLAY_PANEL_CLASS} top-3 right-3 w-9 h-9 flex items-center justify-center text-lg hover:bg-black/80`;
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close map browser';
    container.appendChild(closeBtn);

    // --- Indexing progress pill (top-center, under the search bar) — O4 ---
    const progressPill = document.createElement('div');
    progressPill.setAttribute('data-testid', 'map-browser-progress');
    // Starts hidden; toggled between `hidden` and `flex` by setIndexingProgress.
    progressPill.className = `${OVERLAY_PANEL_CLASS} top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 hidden items-center gap-2 text-sm`;
    const progressSpinner = document.createElement('span');
    progressSpinner.setAttribute('aria-hidden', 'true');
    progressSpinner.className =
      'inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin';
    const progressText = document.createElement('span');
    progressText.setAttribute('data-testid', 'map-browser-progress-text');
    progressPill.append(progressSpinner, progressText);
    container.appendChild(progressPill);

    // --- Backfill ("Speed up future loads") CTA — bottom-center (B1) ---
    const backfillBtn = document.createElement('button');
    backfillBtn.setAttribute('data-testid', 'map-browser-backfill');
    backfillBtn.className = `${OVERLAY_PANEL_CLASS} bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 hidden text-sm hover:bg-black/80 disabled:opacity-60 disabled:hover:bg-black/70`;
    container.appendChild(backfillBtn);

    // --- Tour-list panel overlay (left, collapsible card) ---
    const listPanel = document.createElement('div');
    listPanel.className = `${OVERLAY_PANEL_CLASS} top-16 left-3 bottom-3 w-72 max-w-[80vw] flex flex-col`;
    const listHeader = document.createElement('div');
    listHeader.setAttribute('data-testid', 'map-browser-list-header');
    listHeader.className =
      'flex items-center justify-between px-3 py-2 border-b border-white/15 text-sm font-medium';
    const listTitle = document.createElement('span');
    const clearTileBtn = document.createElement('button');
    clearTileBtn.setAttribute('data-testid', 'map-browser-clear-tile');
    clearTileBtn.className = 'text-xs text-blue-300 hover:text-blue-200 hidden';
    clearTileBtn.textContent = 'Show all';
    listHeader.append(listTitle, clearTileBtn);
    const listEl = document.createElement('div');
    listEl.setAttribute('data-testid', 'map-browser-tour-list');
    listEl.className = 'flex-1 overflow-y-auto p-2 space-y-1';
    listPanel.append(listHeader, listEl);
    container.appendChild(listPanel);

    // --- Leaflet map ---
    const map = L.map(mapEl, { worldCopyJump: true }).setView(
      [0, 0],
      WORLD_ZOOM
    );
    addOsmTileLayer(map);
    const tileLayer = L.layerGroup().addTo(map);

    // --- State ---
    let nameQuery = '';
    let selectedTile: string | null = null;
    let tileIndex: TileIndex = buildTileIndex(
      [],
      leafletZoomToH3Res(WORLD_ZOOM)
    );
    const tilePolygons = new Map<string, L.Polygon>();
    let destroyed = false;
    // Mutable so the progressive flow can stream recordings in after mount.
    const recordings: RecordingCoverage[] = [...(options.recordings ?? [])];
    // O1: frame to coverage exactly once (first recording with cells), then
    // leave the camera alone so streaming does not yank the view around.
    let hasFramedCoverage = false;
    let renderRafId: number | null = null;
    let progressHideTimer: ReturnType<typeof setTimeout> | null = null;
    // Backfill CTA state (B1): how many legacy recordings carry coverage worth
    // embedding, whether indexing has finished (the CTA only appears then), and
    // whether a backfill is currently running.
    let backfillableCount = 0;
    let indexingComplete = false;
    let backfillRunning = false;
    let backfillHideTimer: ReturnType<typeof setTimeout> | null = null;

    function visibleRecordings(): RecordingCoverage[] {
      return filterRecordingsByName(recordings, nameQuery);
    }

    /** Recordings shown in the list: the selected tile's, or all visible. */
    function listedRecordings(): RecordingCoverage[] {
      if (selectedTile !== null) {
        return toursAtTile(tileIndex, selectedTile);
      }
      return visibleRecordings();
    }

    function renderList(): void {
      const listed = listedRecordings();
      listEl.replaceChildren();

      if (selectedTile !== null) {
        listTitle.textContent = `Tile · ${listed.length} tour${listed.length === 1 ? '' : 's'}`;
        clearTileBtn.classList.remove('hidden');
      } else {
        listTitle.textContent = `All tours · ${listed.length}`;
        clearTileBtn.classList.add('hidden');
      }

      if (listed.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-gray-300 px-2 py-2';
        empty.textContent =
          selectedTile !== null
            ? 'No tours cross this tile.'
            : 'No recordings match.';
        listEl.appendChild(empty);
        return;
      }

      for (const recording of listed) {
        const item = document.createElement('button');
        item.setAttribute('data-testid', 'map-browser-tour-item');
        item.setAttribute('data-filename', recording.entry.filename);
        item.className =
          'w-full text-left px-2 py-1.5 rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none';
        const name = document.createElement('div');
        name.className = 'text-sm truncate';
        name.textContent = recording.entry.filename;
        const meta = document.createElement('div');
        meta.className = 'text-[11px] text-gray-300 truncate';
        const dateStr = recording.entry.date
          ? recording.entry.date.toISOString().slice(0, 16).replace('T', ' ')
          : 'unknown date';
        meta.textContent = `${recording.scenario} · ${dateStr}`;
        item.append(name, meta);
        item.addEventListener('click', () => options.onPlayTour(recording));
        listEl.appendChild(item);
      }
    }

    function styleFor(tile: string, tourCount: number): L.PathOptions {
      const isSelected = tile === selectedTile;
      // More tours crossing a tile → more opaque, capped so single tours show.
      const fillOpacity = Math.min(0.6, 0.18 + tourCount * 0.12);
      return {
        color: isSelected ? '#ffffff' : TILE_COLOR,
        weight: isSelected ? 3 : 1,
        fillColor: TILE_COLOR,
        fillOpacity: isSelected ? 0.65 : fillOpacity,
      };
    }

    function renderTiles(): void {
      tileLayer.clearLayers();
      tilePolygons.clear();
      const res = leafletZoomToH3Res(map.getZoom());
      tileIndex = buildTileIndex(visibleRecordings(), res);

      for (const [tile, recs] of tileIndex.tilesToRecordings) {
        const boundary = cellToBoundary(tile).map(
          (p) => [p[0] ?? 0, p[1] ?? 0] as L.LatLngTuple
        );
        const polygon = L.polygon(boundary, styleFor(tile, recs.length));
        polygon.on('click', () => doSelectTile(tile));
        polygon.addTo(tileLayer);
        tilePolygons.set(tile, polygon);
      }

      // A previously selected tile may no longer exist at the new resolution.
      if (selectedTile !== null && !tilePolygons.has(selectedTile)) {
        selectedTile = null;
      }
    }

    function doSelectTile(tile: string | null): void {
      selectedTile = tile;
      // Restyle so the selection highlight is visible without a full redraw.
      for (const [cell, polygon] of tilePolygons) {
        polygon.setStyle(styleFor(cell, toursAtTile(tileIndex, cell).length));
      }
      renderList();
    }

    function fitToCoverage(): void {
      const bounds = L.latLngBounds([]);
      // coverageCellLatLngs skips invalid H3 cells (cellToLatLng throws on some
      // corrupt indices) so one bad cell can't crash the fit — see its doc.
      for (const [lat, lng] of coverageCellLatLngs(recordings)) {
        bounds.extend([lat, lng]);
      }
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING, maxZoom: 17 });
      }
    }

    /**
     * Coalesce tile + list re-renders to one per animation frame. Streaming a
     * whole folder calls this once per recording; without coalescing that would
     * rebuild every Leaflet polygon on every add (the pure tile index is cheap,
     * but the polygon churn is not).
     */
    function scheduleRender(): void {
      if (renderRafId !== null || destroyed) {
        return;
      }
      renderRafId = requestAnimationFrame(() => {
        renderRafId = null;
        if (destroyed) {
          return;
        }
        renderTiles();
        renderList();
      });
    }

    function hideProgress(): void {
      progressPill.classList.add('hidden');
      progressPill.classList.remove('flex');
    }

    function showProgress(): void {
      progressPill.classList.remove('hidden');
      progressPill.classList.add('flex');
    }

    function setIndexingProgress(done: number, total: number): void {
      // A late progress callback can arrive after teardown: the indexing stream
      // is aborted then the browser is destroyed, but an in-flight worker still
      // resolves and fires onProgress. Bail out so we neither touch detached DOM
      // nor arm a progress-hide timer destroy() has already finished clearing.
      if (destroyed) {
        return;
      }
      if (progressHideTimer !== null) {
        clearTimeout(progressHideTimer);
        progressHideTimer = null;
      }
      if (total <= 0) {
        hideProgress();
        return;
      }
      if (done < total) {
        progressSpinner.classList.remove('hidden');
        progressText.textContent = `Indexing ${done} / ${total}…`;
        showProgress();
        return;
      }
      // Durable end state (CLAUDE.md async-UX rule): drop the spinner, show a
      // brief confirmation, then hide.
      progressSpinner.classList.add('hidden');
      progressText.textContent = `${total} recording${total === 1 ? '' : 's'}`;
      showProgress();
      progressHideTimer = setTimeout(() => {
        progressHideTimer = null;
        hideProgress();
      }, PROGRESS_DONE_LINGER_MS);

      // Indexing finished — offer the one-time backfill if anything needs it.
      if (done >= total) {
        indexingComplete = true;
        refreshBackfillButton();
      }
    }

    /** Show/label or hide the backfill CTA based on current state. */
    function refreshBackfillButton(): void {
      if (backfillRunning) {
        return; // don't override the transitional "Embedding…" state
      }
      const show =
        indexingComplete && backfillableCount > 0 && !!options.onBackfill;
      if (!show) {
        backfillBtn.classList.add('hidden');
        return;
      }
      backfillBtn.disabled = false;
      backfillBtn.textContent = `Speed up future loads — embed coverage in ${backfillableCount} recording${
        backfillableCount === 1 ? '' : 's'
      }`;
      backfillBtn.classList.remove('hidden');
    }

    async function runBackfill(): Promise<void> {
      if (!options.onBackfill || backfillRunning) {
        return;
      }
      backfillRunning = true;
      backfillBtn.disabled = true;
      backfillBtn.textContent = 'Embedding…';
      try {
        const result = await options.onBackfill();
        // The user may have closed the map while the backfill was in flight
        // (teardown aborts the same signal). Don't update detached DOM or arm a
        // hide timer destroy() can no longer clear.
        if (destroyed) {
          return;
        }
        backfillRunning = false;
        if (result.permissionDenied) {
          // Degrade: the in-memory index still works; let the user retry.
          backfillBtn.disabled = false;
          backfillBtn.textContent = 'Write access denied — tap to retry';
          return;
        }
        // Done — recordings are now fast; show a brief confirmation then hide.
        backfillableCount = 0;
        backfillBtn.disabled = true;
        backfillBtn.textContent =
          result.failed > 0
            ? `Embedded ${result.embedded}, ${result.failed} failed`
            : `Embedded ${result.embedded} ✓`;
        backfillHideTimer = setTimeout(() => {
          backfillHideTimer = null;
          backfillBtn.classList.add('hidden');
        }, PROGRESS_DONE_LINGER_MS);
      } catch (err) {
        log.error('Coverage backfill failed', err);
        backfillRunning = false;
        backfillBtn.disabled = false;
        backfillBtn.textContent = 'Upgrade failed — tap to retry';
      }
    }

    function addRecording(recording: RecordingCoverage): void {
      if (destroyed) {
        return;
      }
      recordings.push(recording);
      // Track legacy recordings that carry coverage worth embedding (B1).
      if (recording.backfilled && recording.cells.length > 0) {
        backfillableCount += 1;
      }
      // Frame to coverage once, when the first cells arrive (O1).
      if (!hasFramedCoverage && recording.cells.length > 0) {
        hasFramedCoverage = true;
        fitToCoverage();
      }
      scheduleRender();
    }

    // --- Wire interactions ---
    searchInput.addEventListener('input', () => {
      nameQuery = searchInput.value;
      // Clearing the tile selection avoids showing a stale tile's tours.
      selectedTile = null;
      renderTiles();
      renderList();
    });
    clearTileBtn.addEventListener('click', () => doSelectTile(null));
    closeBtn.addEventListener('click', () => options.onClose?.());
    backfillBtn.addEventListener('click', () => void runBackfill());
    map.on('zoomend', () => {
      renderTiles();
      renderList();
    });

    // --- Initial paint ---
    // Frame to any coverage supplied at construction (the non-progressive path);
    // record that we framed so streamed-in recordings don't re-fit (O1).
    if (recordings.some((r) => r.cells.length > 0)) {
      hasFramedCoverage = true;
      fitToCoverage();
    }
    renderTiles();
    renderList();
    const resizeTimeoutId = setTimeout(
      () => map.invalidateSize(),
      RESIZE_DELAY_MS
    );

    log.info('Map browser created', {
      recordings: recordings.length,
    });

    return {
      destroy(): void {
        if (destroyed) {
          return;
        }
        destroyed = true;
        clearTimeout(resizeTimeoutId);
        if (renderRafId !== null) {
          cancelAnimationFrame(renderRafId);
          renderRafId = null;
        }
        if (progressHideTimer !== null) {
          clearTimeout(progressHideTimer);
          progressHideTimer = null;
        }
        if (backfillHideTimer !== null) {
          clearTimeout(backfillHideTimer);
          backfillHideTimer = null;
        }
        map.remove();
        container.replaceChildren();
        container.classList.remove('overflow-hidden');
        container.removeAttribute('data-testid');
        log.info('Map browser destroyed');
      },
      getRes: () => tileIndex.res,
      getRenderedTiles: () => [...tilePolygons.keys()],
      selectTile: (tileCell) => doSelectTile(tileCell),
      setNameQuery: (query) => {
        searchInput.value = query;
        searchInput.dispatchEvent(new Event('input'));
      },
      addRecording,
      setIndexingProgress,
    };
  } catch (err) {
    log.error('Failed to create map browser', err);
    return null;
  }
}
