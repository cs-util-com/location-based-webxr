/**
 * The 2D summary map's shell: a Leaflet map with the OSM basemap, the
 * shared trajectory layers, the app's own layers on top, an optional
 * fullscreen toggle, and a clean `destroy`.
 *
 * MOVED OUT OF THE RECORDERAPP (DEC-H3, Tour Viewer authoring plan
 * 2026-09-28-0953 §3.3). The Recorder's session summary drew its map here
 * since 2026-01; the Tour Viewer's summary after Finish is the second
 * consumer. What differs between them is passed in, never forked:
 *
 * - `drawExtra` - the app's own layers (the Recorder's reference points,
 *   the Tour Viewer's codes, facing lines and pins), drawn after the
 *   trajectory and removed with the map;
 * - `fitPoints` - frame these points instead of centring on the final
 *   position. The Recorder centres (far-away prior reference points must
 *   not shrink the walk to a dot, 2026-06-02); the Tour Viewer frames its
 *   codes and objects, which can exist without any walk;
 * - `fullscreen` - the toggle's classes. They are the app's styling (the
 *   Recorder's Tailwind utilities, the Tour Viewer's own CSS), so the
 *   framework names none of them; without it no toggle is drawn.
 *
 * Leaflet is imported statically HERE, so an app that must not ship it to
 * every visitor imports this module dynamically (the Tour Viewer does).
 *
 * @see summary-map-shell.ts.md
 */

import L from 'leaflet';

import type { GpsCoord, RawGpsSample } from '../types/geo-types.js';
import { createLogger } from '../utils/logger.js';
import { drawMapData } from './map-overlay-draw.js';
import { addOsmTileLayer } from './osm-tile-layer.js';

const log = createLogger('SummaryMapShell');

/** The zoom a centred map opens at: roughly a city block. */
export const SUMMARY_MAP_INITIAL_ZOOM = 15;

/** Pixel padding of a framed view, so markers and rings at the edge are
 *  not clipped. */
export const SUMMARY_MAP_FIT_PADDING: L.PointTuple = [20, 20];

/**
 * The closest a framed view zooms in. One code and one pin a metre apart
 * would otherwise open at the tiles' ceiling, where the basemap says
 * nothing about where the place is. 18 shows about 150 m across a phone.
 */
const SUMMARY_MAP_FIT_MAX_ZOOM = 18;

/** Delay (ms) before the first `invalidateSize`, for a container that was
 *  not laid out yet when the map was created. */
const FIRST_RESIZE_DELAY_MS = 100;
/** Delay (ms) before re-measuring after a fullscreen transition. */
const TOGGLE_RESIZE_DELAY_MS = 300;

/** The trajectory layers (the framework's shared `MapData` paths). */
export interface SummaryMapShellData {
  /** Raw GPS (yellow polyline; an accuracy circle where `accuracy` is set). */
  readonly rawGpsPath: readonly RawGpsSample[];
  /** Fused SLAM+GPS positions (cyan polyline). */
  readonly fusedPath: readonly GpsCoord[];
  /** Alignment-snapshot positions (red polyline). */
  readonly alignmentSnapshots?: readonly GpsCoord[];
}

export interface SummaryMapShellOptions {
  /** The app's layers, drawn after the trajectory; removed on destroy. A
   *  throw makes the whole map refuse (null), never half-draw. */
  readonly drawExtra?: (map: L.Map) => L.Layer[];
  /** Frame these points (with the drawn trajectory) instead of centring
   *  on the final position. */
  readonly fitPoints?: readonly GpsCoord[];
  /** The zoom a centred map opens at (default
   *  {@link SUMMARY_MAP_INITIAL_ZOOM}). */
  readonly initialZoom?: number;
  /** The fullscreen toggle's styling; no toggle without it. */
  readonly fullscreen?: {
    /** Added to the container while expanded. */
    readonly expandedClasses: readonly string[];
    /** Removed while expanded, restored on collapse. */
    readonly inlineClasses: readonly string[];
    /** Both buttons' class attribute. */
    readonly buttonClassName: string;
    /** Toggled on the button that is not offered. */
    readonly hiddenClass: string;
  };
}

export interface SummaryMapShell {
  /** Remove every layer and the map. Idempotent. */
  destroy: () => void;
  /** Enter fullscreen (a no-op without `fullscreen`, or after destroy). */
  expand: () => void;
  /** Back to the inline view. */
  collapse: () => void;
  isExpanded: () => boolean;
}

/** The view's centre when nothing is framed: the final raw position, else
 *  the final fused one. */
function finalPosition(data: SummaryMapShellData): GpsCoord | undefined {
  return data.rawGpsPath.at(-1) ?? data.fusedPath.at(-1);
}

type Fullscreen = NonNullable<SummaryMapShellOptions['fullscreen']>;

/** Frame the points, or centre on `centre` at `zoom`. */
function frameView(
  map: L.Map,
  fitPoints: readonly GpsCoord[],
  centre: GpsCoord | undefined,
  zoom: number
): void {
  if (fitPoints.length > 0) {
    const bounds = L.latLngBounds(
      fitPoints.map((p) => [p.lat, p.lng] as L.LatLngTuple)
    );
    map.fitBounds(bounds, {
      padding: SUMMARY_MAP_FIT_PADDING,
      maxZoom: SUMMARY_MAP_FIT_MAX_ZOOM,
    });
  } else if (centre !== undefined) {
    map.setView([centre.lat, centre.lng], zoom);
  }
}

/** Draw every layer: the basemap, the trajectory, the app's. */
function drawLayers(
  map: L.Map,
  data: SummaryMapShellData,
  drawExtra: SummaryMapShellOptions['drawExtra']
): L.Layer[] {
  const layers: L.Layer[] = [addOsmTileLayer(map)];
  const drawn = drawMapData(map, {
    userPosition: null,
    rawGpsPath: [...data.rawGpsPath],
    fusedPath: [...data.fusedPath],
    alignmentSnapshots: [...(data.alignmentSnapshots ?? [])],
  });
  layers.push(...drawn.layers, ...(drawExtra?.(map) ?? []));
  return layers;
}

/** The fullscreen toggle: its two buttons in `container`, the classes they
 *  swap, and `refit` after each transition. */
function createToggle(
  container: HTMLElement,
  toggle: Fullscreen,
  refit: () => void
): {
  setExpanded: (next: boolean) => void;
  isExpanded: () => boolean;
  dispose: () => void;
} {
  const { expand, collapse } = toggleButtons(toggle);
  let expanded = false;
  let disposed = false;
  function setExpanded(next: boolean): void {
    if (disposed || expanded === next) return;
    expanded = next;
    container.classList.remove(
      ...(next ? toggle.inlineClasses : toggle.expandedClasses)
    );
    container.classList.add(
      ...(next ? toggle.expandedClasses : toggle.inlineClasses)
    );
    expand.classList.toggle(toggle.hiddenClass, next);
    collapse.classList.toggle(toggle.hiddenClass, !next);
    refit();
  }
  const onExpand = (): void => {
    setExpanded(true);
  };
  const onCollapse = (): void => {
    setExpanded(false);
  };
  if (!container.style.position && !container.classList.contains('relative')) {
    container.style.position = 'relative';
  }
  expand.addEventListener('click', onExpand);
  collapse.addEventListener('click', onCollapse);
  container.append(expand, collapse);
  return {
    setExpanded,
    isExpanded: () => expanded,
    dispose: () => {
      disposed = true;
      expand.removeEventListener('click', onExpand);
      collapse.removeEventListener('click', onCollapse);
      expand.remove();
      collapse.remove();
    },
  };
}

/** Remove every layer, then the map; a failing removal is logged, never
 *  thrown (a half-removed map must not break the page's cleanup). */
function removeAll(map: L.Map, layers: readonly L.Layer[]): void {
  for (const layer of layers) {
    try {
      layer.remove();
    } catch (err) {
      log.warn('Ignoring error during layer cleanup:', err);
    }
  }
  try {
    map.remove();
  } catch (err) {
    log.warn('Error during map cleanup:', err);
  }
}

/**
 * Create the map in `container`.
 *
 * @returns null when there is no container, nothing to show (no path and
 *   no `fitPoints`), or Leaflet or an app layer throws.
 */
export function createSummaryMapShell(
  container: HTMLElement | null,
  data: SummaryMapShellData,
  options: SummaryMapShellOptions = {}
): SummaryMapShell | null {
  const fitPoints = options.fitPoints ?? [];
  const centre = finalPosition(data);
  if (container === null) {
    log.warn('Cannot create summary map: container is null');
    return null;
  }
  if (centre === undefined && fitPoints.length === 0) {
    log.warn('Cannot create summary map: nothing to show');
    return null;
  }
  return buildShell(container, data, options, { fitPoints, centre });
}

/** {@link createSummaryMapShell} past its preconditions. */
function buildShell(
  container: HTMLElement,
  data: SummaryMapShellData,
  options: SummaryMapShellOptions,
  view: { fitPoints: readonly GpsCoord[]; centre: GpsCoord | undefined }
): SummaryMapShell | null {
  const { fitPoints, centre } = view;
  let map: L.Map | null = null;
  try {
    const created = L.map(container);
    map = created;
    const layers = drawLayers(created, data, options.drawExtra);
    const initialZoom = options.initialZoom ?? SUMMARY_MAP_INITIAL_ZOOM;
    frameView(created, fitPoints, centre, initialZoom);

    let destroyed = false;
    const firstResize = setTimeout(() => {
      created.invalidateSize();
    }, FIRST_RESIZE_DELAY_MS);
    let toggleResize: ReturnType<typeof setTimeout> | null = null;
    const refit = (): void => {
      if (toggleResize !== null) clearTimeout(toggleResize);
      toggleResize = setTimeout(() => {
        created.invalidateSize();
        frameView(created, fitPoints, centre, created.getZoom());
      }, TOGGLE_RESIZE_DELAY_MS);
    };
    const toggle =
      options.fullscreen === undefined
        ? null
        : createToggle(container, options.fullscreen, refit);

    return {
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstResize);
        if (toggleResize !== null) clearTimeout(toggleResize);
        toggle?.dispose();
        removeAll(created, layers);
      },
      expand: () => {
        toggle?.setExpanded(true);
      },
      collapse: () => {
        toggle?.setExpanded(false);
      },
      isExpanded: () => toggle?.isExpanded() ?? false,
    };
  } catch (err) {
    log.error('Failed to create summary map:', err);
    try {
      map?.remove();
    } catch {
      // A map that failed half way may not remove cleanly either.
    }
    return null;
  }
}

/** The two toggle buttons, the collapse one hidden. */
function toggleButtons(toggle: Fullscreen): {
  expand: HTMLButtonElement;
  collapse: HTMLButtonElement;
} {
  const make = (testId: string, text: string, title: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-testid', testId);
    button.className = toggle.buttonClassName;
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
  };
  const expand = make('btn-map-expand', '⛶', 'Enlarge map');
  const collapse = make('btn-map-collapse', '✕', 'Close fullscreen');
  collapse.classList.add(toggle.hiddenClass);
  return { expand, collapse };
}
