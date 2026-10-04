/**
 * Summary Map Component
 *
 * Leaflet-based 2D map for the session summary panel.
 * Displays the recorded path with:
 * - Yellow polyline: Raw GPS readings
 * - Cyan polyline: Fused GPS+SLAM aligned positions
 * - Markers: Reference points with labels
 *
 * User Feedback Issue #4 (2026-01-27):
 * "In the final report screen when I clicked 'Stop' I would like to be able
 * to see the map with the path the user walked (both the raw GPS path and
 * the fused GPS+SLAM path)."
 *
 * THE SHELL LIVES IN THE FRAMEWORK since 2026-10-01
 * (`gps-plus-slam-app-framework/visualization/summary-map-shell`, DEC-H3,
 * Tour Viewer authoring plan 2026-09-28-0953 §3.3): the map, the basemap,
 * the shared trajectory layers, the fullscreen toggle and the cleanup. This
 * file is what the RECORDER adds to it - its reference-point markers, its
 * Tailwind classes, and centring on the final position.
 */

import type {
  GpsCoord,
  RawGpsSample,
} from 'gps-plus-slam-app-framework/types/geo-types';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { createSummaryMapShell } from 'gps-plus-slam-app-framework/visualization/summary-map-shell';
import {
  drawRefPointMarkers,
  type RefPointMarkerInput,
} from './draw-ref-point-markers';
import { INITIAL_ZOOM } from './map-osm-base';

// ============================================================================
// Types
// ============================================================================

/** Data required to render the summary map */
export interface SummaryMapData {
  /**
   * Raw GPS positions (yellow polyline). When samples include `accuracy`
   * (in meters), a transparent yellow circle of that radius is drawn at
   * each point so users can visually distinguish accurate from noisy fixes.
   */
  rawGpsPath: RawGpsSample[];
  /** Fused/aligned positions (cyan polyline) */
  fusedPath: GpsCoord[];
  /**
   * Reference points with markers. Each carries its own `timestamp`, which is
   * compared against `startTime` to classify it as prior (green) or current
   * (red) — drawn by the recorder-owned {@link drawRefPointMarkers} helper
   * rather than the ref-agnostic shared overlay module.
   */
  referencePoints: RefPointMarkerInput[];
  /**
   * Recording start time (epoch ms) used to classify ref points as prior
   * (green) or current (red). Optional: when omitted it defaults to `0`, so
   * every ref point classifies as current — the production caller
   * (session-summary) always passes the real session start time.
   */
  startTime?: number;
  /** Alignment snapshot GPS positions (red dots) — Issue #1 */
  alignmentSnapshots?: GpsCoord[];
}

/** Summary map instance with cleanup and fullscreen methods */
export interface SummaryMapInstance {
  /** Clean up Leaflet resources */
  destroy: () => void;
  /** Expand map to fullscreen overlay */
  expand: () => void;
  /** Collapse map back to inline view */
  collapse: () => void;
  /** Whether the map is currently in fullscreen mode */
  isExpanded: () => boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Colors matching the 3D visualization — re-exported from vis-colors.ts */
export const RAW_GPS_COLOR = VIS_COLORS.RAW_GPS.css;
export const FUSED_PATH_COLOR = VIS_COLORS.FUSED_VIO.css;
export const REF_POINT_COLOR = VIS_COLORS.CURRENT_REF_POINT.css;
export const ALIGNMENT_SNAPSHOT_COLOR = VIS_COLORS.ALIGNMENT_SNAPSHOT.css;

/** The recorder's fullscreen toggle, in its Tailwind utilities. */
const FULLSCREEN = {
  /** Added in fullscreen mode. */
  expandedClasses: ['fixed', 'inset-0', 'z-[60]'],
  /** Removed in fullscreen mode (restored on collapse). */
  inlineClasses: ['h-48', 'rounded-lg'],
  buttonClassName:
    'absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 text-white rounded-lg w-9 h-9 flex items-center justify-center text-lg shadow-md transition-colors',
  hiddenClass: 'hidden',
} as const;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a summary map in the given container.
 *
 * Centred on the FINAL user position of the recording (last raw GPS
 * reading, falling back to the last fused position), never fitted to all
 * elements: when prior ref points sit far away from each other that
 * bounds-fit zooms the recording down to a useless dot (user feedback
 * 2026-06-02). Reference points are drawn but never extend the view.
 *
 * @param container - DOM element to render the map into
 * @param data - GPS paths and reference points to display
 * @returns Map instance with destroy() method, or null if creation failed
 */
export function createSummaryMap(
  container: HTMLElement | null,
  data: SummaryMapData
): SummaryMapInstance | null {
  return createSummaryMapShell(
    container,
    {
      rawGpsPath: data.rawGpsPath,
      fusedPath: data.fusedPath,
      alignmentSnapshots: data.alignmentSnapshots ?? [],
    },
    {
      initialZoom: INITIAL_ZOOM,
      drawExtra: (map) =>
        drawRefPointMarkers(map, data.referencePoints, data.startTime ?? 0),
      fullscreen: FULLSCREEN,
    }
  );
}
