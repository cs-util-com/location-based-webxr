/**
 * Session Summary Panel
 *
 * Displays recording statistics, error logs, and validation data
 * after a recording session ends. This is a TERMINAL state per the
 * Application State Machine - users cannot restart from here.
 *
 * @see README.md#session-summary-panel-summary-state
 */

import { createSummaryMap, type SummaryMapInstance } from './summary-map';
import { qrAnchorSummaryLines } from '../qr/qr-anchor-summary';
import type { QrAnchorOutcome } from '../qr/qr-level-zip-contributor';
import type { RefPointMarkerInput } from './draw-ref-point-markers';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { formatFileSize } from 'gps-plus-slam-app-framework/utils/format-file-size';
import { getRequiredElement } from '../utils/dom-helpers';
import { formatDistance } from 'gps-plus-slam-app-framework/utils/format-distance';
import type {
  GpsCoord,
  RawGpsSample,
} from 'gps-plus-slam-app-framework/types/geo-types';

// Re-export formatFileSize for tests and external consumers
export { formatFileSize } from 'gps-plus-slam-app-framework/utils/format-file-size';

const log = createLogger('SessionSummary');

// --- Types ---

interface SessionSummaryCallbacks {
  /** Called when user clicks "New Recording" - should reload the page */
  onNewRecording: () => void;
  /** Called when user clicks "View Logs" - optional */
  onViewLogs?: () => void;
}

export interface SessionSummaryData {
  /** Recording duration */
  readonly duration: { startTime: number; endTime: number };
  /** Number of GPS events recorded */
  readonly gpsEventCount: number;
  /** Number of reference points marked */
  readonly refPointCount: number;
  /** Number of images captured */
  readonly imageCount: number;
  /** Number of depth samples taken */
  readonly depthSampleCount: number;
  /** List of errors/warnings from the session */
  readonly errors: string[];
  /**
   * What this recording decided about each printed QR code it saw.
   *
   * Empty is the normal case (QR recording off). A DECLINED code has to
   * appear here, because in the zip "declined" and "never seen" look
   * identical - no file - and the only feedback for "your poster moved"
   * would otherwise be silence.
   */
  readonly qrAnchors: readonly QrAnchorOutcome[];
  /** First GPS coordinate (null if no GPS data) */
  readonly firstGps: GpsCoord | null;
  /** Last GPS coordinate (null if no GPS data) */
  readonly lastGps: GpsCoord | null;
  /** Total distance traveled in meters (from odometry) */
  readonly totalDistanceMeters: number;
  /**
   * Number of failed file write operations during this session.
   * User Feedback Issue #1 Part B: Track write failures for visibility.
   */
  readonly failedWriteCount?: number;
  /**
   * Full raw GPS path for map visualization. Per-event accuracy (when
   * available) is rendered as a transparent circle on the 2D map so users
   * can tell accurate fixes from noisy ones.
   * User Feedback Issue #4 (2026-01-27): Show recorded path in summary.
   */
  readonly rawGpsPath?: RawGpsSample[];
  /**
   * Full fused/aligned path for map visualization.
   * User Feedback Issue #4 (2026-01-27): Show recorded path in summary.
   */
  readonly fusedPath?: GpsCoord[];
  /**
   * Reference points with names for map markers. Each carries a `timestamp`
   * used to classify it as prior (green) or current (red) relative to the
   * recording start time.
   * User Feedback Issue #4 (2026-01-27): Show ref points on summary map.
   */
  readonly referencePointsForMap?: RefPointMarkerInput[];
  /**
   * ZIP blob size in bytes for display on summary.
   * User Feedback Issue #3 (2026-02-06): Show ZIP stats.
   */
  readonly zipSizeBytes?: number;
  /**
   * Number of files in the exported ZIP.
   * User Feedback Issue #3 (2026-02-06): Show ZIP stats.
   */
  readonly zipFileCount?: number;
  /**
   * The ZIP blob for sharing via Web Share API.
   * User Feedback Issue #2 (2026-02-06): Share session button.
   */
  readonly zipBlob?: Blob;
  /**
   * Suggested filename for the ZIP when sharing/downloading.
   * User Feedback Issue #2 (2026-02-06): Share session button.
   */
  readonly zipFilename?: string;
  /**
   * GPS coordinates of alignment snapshot positions.
   * User Feedback Issue #1 (2026-03-21): Red dots on summary map at
   * the system's best GPS estimate at each alignment update.
   */
  readonly alignmentSnapshotPath?: GpsCoord[];
}

// --- Cached DOM Elements ---

let cachedElements: {
  panel: HTMLElement;
  duration: HTMLElement;
  gpsCount: HTMLElement;
  refPoints: HTMLElement;
  images: HTMLElement;
  depthSamples: HTMLElement;
  failedWrites: HTMLElement | null;
  errors: HTMLElement;
  firstGps: HTMLElement;
  lastGps: HTMLElement;
  distance: HTMLElement;
  btnNewRecording: HTMLButtonElement;
  btnViewLogs: HTMLButtonElement | null;
  mapContainer: HTMLElement | null;
  zipSize: HTMLElement | null;
  zipFiles: HTMLElement | null;
  btnShare: HTMLButtonElement | null;
} | null = null;

/** Track active map instance for cleanup */
let currentMapInstance: SummaryMapInstance | null = null;

// --- Helper Functions ---

/**
 * Format duration in milliseconds to a readable string.
 * Examples: "1:00" for 60s, "2:30" for 150s, "10:05" for 605s
 */
function formatDuration(startTime: number, endTime: number): string {
  const durationMs = endTime - startTime;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format GPS coordinates for display.
 */
function formatGps(gps: GpsCoord | null): string {
  if (!gps) {
    return 'No data';
  }
  return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`;
}

/**
 * Format distance in meters for display.
 *
 * The workspace's shared formatter (2026-08-24) with this screen's rule: two
 * decimals on kilometres, because a session total is a figure the user compares
 * between recordings rather than glances at, and 1.23 km distinguishes two
 * walks that 1.2 km does not. Output unchanged for non-negative finite input —
 * the framework's `format-distance.test.ts` pins it differentially against the
 * old body. Outside that range it DID change on purpose: this summary used to
 * print "NaN m", and now formats that as "0.0 m".
 */
function formatSummaryDistance(meters: number): string {
  return formatDistance(meters, { kmDecimals: 2 });
}

/**
 * Format errors list for display.
 */
/** Render the printed-code block, or hide it when nothing was seen. */
function renderQrAnchors(
  outcomes: readonly QrAnchorOutcome[] | undefined
): void {
  const block = document.getElementById('summary-qr-anchors-block');
  const body = document.getElementById('summary-qr-anchors');
  if (!block || !body) return;
  const lines = qrAnchorSummaryLines(outcomes);
  if (lines === null) {
    block.classList.add('hidden');
    return;
  }
  block.classList.remove('hidden');
  body.textContent = lines;
}

function formatErrors(errors: string[]): string {
  if (errors.length === 0) {
    return 'No errors';
  }
  return errors.map((e) => `• ${e}`).join('\n');
}

/**
 * Handle the share/download action for the session ZIP.
 *
 * Uses Web Share API with file sharing where supported (primarily mobile),
 * falls back to <a download> for desktop browsers.
 *
 * User Feedback Issue #2 (2026-02-06): Share recorded session button.
 */
async function handleShareSession(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/zip' });

  // Try Web Share API with file support.
  // Note: The outer check tests that the API exists at all, while
  // canShare(shareData) tests that this browser supports *file* sharing
  // specifically — many desktop browsers expose the API for text/URLs
  // only and return false for files. Both checks are needed.
  if (navigator.canShare && navigator.share) {
    const shareData = { files: [file] };
    if (navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        log.info(`Shared session via Web Share API: ${filename}`);
        return;
      } catch (err) {
        const error = err as Error;
        if (error.name === 'AbortError') {
          log.info('User cancelled share');
          return;
        }
        log.warn(
          'Web Share API failed, falling back to download:',
          error.message
        );
      }
    }
  }

  // Fallback: <a download> approach
  triggerDownload(blob, filename);
}

/**
 * Trigger a file download via hidden <a> element.
 * Used as fallback when Web Share API is not available.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // The browser resolves the blob URL synchronously during click(), so the
  // download is already initiated when we reach this point. Use a generous
  // timeout to ensure the download starts on slower Android browsers where
  // the click event may propagate asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  log.info(`Download triggered via <a download>: ${filename}`);
}

// --- Public API ---

/**
 * Initialize the session summary panel.
 * Must be called before showSessionSummary.
 *
 * @param callbacks - Event handlers for panel buttons
 * @throws Error if required DOM elements are missing
 */
export function initSessionSummary(callbacks: SessionSummaryCallbacks): void {
  const panel = getRequiredElement('session-summary-panel');
  const duration = getRequiredElement('summary-duration');
  const gpsCount = getRequiredElement('summary-gps-count');
  const refPoints = getRequiredElement('summary-ref-points');
  const images = getRequiredElement('summary-images');
  const depthSamples = getRequiredElement('summary-depth-samples');
  const failedWrites = document.getElementById('summary-failed-writes');
  const errors = getRequiredElement('summary-errors');
  const firstGps = getRequiredElement('summary-first-gps');
  const lastGps = getRequiredElement('summary-last-gps');
  const distance = getRequiredElement('summary-distance');
  const btnNewRecording =
    getRequiredElement<HTMLButtonElement>('btn-new-recording');
  const btnViewLogs = document.getElementById(
    'btn-view-logs'
  ) as HTMLButtonElement | null;

  // Map container is optional - may not exist in older HTML
  const mapContainer = document.getElementById('summary-map-container');

  // ZIP stats and share button (Issue #2+#3, 2026-02-06)
  const zipSize = document.getElementById('summary-zip-size');
  const zipFiles = document.getElementById('summary-zip-files');
  const btnShare = document.getElementById(
    'btn-share-session'
  ) as HTMLButtonElement | null;

  cachedElements = {
    panel,
    duration,
    gpsCount,
    refPoints,
    images,
    depthSamples,
    failedWrites,
    errors,
    firstGps,
    lastGps,
    distance,
    btnNewRecording,
    btnViewLogs,
    mapContainer,
    zipSize,
    zipFiles,
    btnShare,
  };

  // Wire up New Recording button
  btnNewRecording.addEventListener('click', () => {
    callbacks.onNewRecording();
  });

  // Wire up View Logs button if present and callback provided
  if (btnViewLogs && callbacks.onViewLogs) {
    btnViewLogs.addEventListener('click', () => {
      callbacks.onViewLogs?.();
    });
  }
}

/**
 * Display the session summary with the provided data.
 *
 * @param data - Session statistics and validation data
 * @throws Error if initSessionSummary was not called
 */
export function showSessionSummary(data: SessionSummaryData): void {
  if (!cachedElements) {
    throw new Error('showSessionSummary called before initSessionSummary()');
  }

  // Populate the summary data
  cachedElements.duration.textContent = formatDuration(
    data.duration.startTime,
    data.duration.endTime
  );
  cachedElements.gpsCount.textContent = String(data.gpsEventCount);
  cachedElements.refPoints.textContent = String(data.refPointCount);
  cachedElements.images.textContent = String(data.imageCount);
  cachedElements.depthSamples.textContent = String(data.depthSampleCount);

  // User Feedback Issue #1 Part B: Display failed write count
  if (cachedElements.failedWrites) {
    const failedCount = data.failedWriteCount ?? 0;
    cachedElements.failedWrites.textContent = String(failedCount);

    // Add warning class if there are failed writes
    // Also manage bg-gray-700/50 to avoid CSS specificity issues (no !important needed)
    const parentRow = cachedElements.failedWrites.closest('.summary-row');
    if (parentRow) {
      if (failedCount > 0) {
        parentRow.classList.add('warning');
        parentRow.classList.remove('bg-gray-700/50');
      } else {
        parentRow.classList.remove('warning');
        parentRow.classList.add('bg-gray-700/50');
      }
    }
  }

  cachedElements.errors.textContent = formatErrors(data.errors);
  renderQrAnchors(data.qrAnchors);
  cachedElements.firstGps.textContent = formatGps(data.firstGps);
  cachedElements.lastGps.textContent = formatGps(data.lastGps);
  cachedElements.distance.textContent = formatSummaryDistance(
    data.totalDistanceMeters
  );

  // User Feedback Issue #3 (2026-02-06): Display ZIP statistics
  if (cachedElements.zipSize) {
    cachedElements.zipSize.textContent =
      data.zipSizeBytes != null ? formatFileSize(data.zipSizeBytes) : '—';
  }
  if (cachedElements.zipFiles) {
    cachedElements.zipFiles.textContent =
      data.zipFileCount != null ? String(data.zipFileCount) : '—';
  }

  // User Feedback Issue #2 (2026-02-06): Share session button
  if (cachedElements.btnShare) {
    // Release previous closure's blob reference before reassignment
    cachedElements.btnShare.onclick = null;
    if (data.zipBlob) {
      cachedElements.btnShare.classList.remove('hidden');
      // Store blob reference for the click handler via closure
      const blob = data.zipBlob;
      const filename = data.zipFilename ?? 'session.zip';
      cachedElements.btnShare.onclick = () => {
        void handleShareSession(blob, filename);
      };
    } else {
      cachedElements.btnShare.classList.add('hidden');
    }
  }

  // User Feedback Issue #4: Create summary map with GPS paths
  if (cachedElements.mapContainer) {
    // Destroy any existing map first
    if (currentMapInstance) {
      currentMapInstance.destroy();
      currentMapInstance = null;
    }

    // Create new map if we have GPS data
    const rawGpsPath = data.rawGpsPath ?? [];
    const fusedPath = data.fusedPath ?? [];
    const referencePoints = data.referencePointsForMap ?? [];

    if (rawGpsPath.length > 0 || fusedPath.length > 0) {
      currentMapInstance = createSummaryMap(cachedElements.mapContainer, {
        rawGpsPath,
        fusedPath,
        referencePoints,
        startTime: data.duration.startTime,
        alignmentSnapshots: data.alignmentSnapshotPath ?? [],
      });
      if (currentMapInstance) {
        log.info('Summary map created successfully');
      }
    } else {
      log.debug('No GPS data for summary map');
      const fallbackDiv = document.createElement('div');
      fallbackDiv.className = 'text-gray-500 text-center py-4';
      fallbackDiv.textContent = 'No GPS path recorded';
      cachedElements.mapContainer.replaceChildren(fallbackDiv);
    }
  }

  // Show the panel
  cachedElements.panel.classList.remove('hidden');
}

/**
 * Hide the session summary panel.
 */
export function hideSessionSummary(): void {
  if (!cachedElements) {
    return; // Silently ignore if not initialized
  }

  // Bug 11 fix: destroy map instance immediately to free tile images,
  // event listeners, and DOM nodes on mobile devices
  if (currentMapInstance) {
    currentMapInstance.destroy();
    currentMapInstance = null;
  }

  cachedElements.panel.classList.add('hidden');
}
