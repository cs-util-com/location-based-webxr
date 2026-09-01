/**
 * Secondary HUD status rows — the storage-sync indicator and the AbsCompass
 * (AbsoluteOrientationSensor) presence row shown during recording.
 *
 * Extracted from the monolithic `hud.ts` (simplify-loop Area 5, stage B,
 * 2026-07-24). `hud.ts` re-exports the public surface so all HUD consumers
 * keep one import seam; this module owns the `#sync-*` and `#abs-compass-*`
 * elements and no other HUD state (independent of `initUI`).
 */

/**
 * Sync status for display purposes.
 * Matches SyncStatus from sync-manager.ts.
 */
interface SyncStatusDisplay {
  state: 'idle' | 'active' | 'syncing';
  lastSyncTime: number | null;
  lastError: string | null;
}

/**
 * Format relative time (e.g., "30s ago", "2m ago")
 */
function formatRelativeTime(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Interval ID for refreshing relative time display in sync status */
let relativeTimeInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Update the sync status indicator in the HUD.
 *
 * Shows:
 * - Green "Xs ago" when sync is active and successful
 * - Yellow "⚠️ Error" when last sync failed
 * - "pending" when active but never synced
 * - Hidden when sync is idle
 *
 * Starts a 10s refresh timer so the relative time display stays current
 * between sync events.
 *
 * @param status - Current sync status
 */
export function updateSyncStatus(status: SyncStatusDisplay): void {
  const syncInfo = document.getElementById('sync-info');
  const syncStatus = document.getElementById('sync-status');
  if (!syncInfo || !syncStatus) {
    return;
  }

  // Clear any existing refresh timer
  if (relativeTimeInterval !== null) {
    clearInterval(relativeTimeInterval);
    relativeTimeInterval = null;
  }

  // Hide if idle
  if (status.state === 'idle') {
    syncInfo.classList.add('hidden');
    return;
  }

  // Show the indicator
  syncInfo.classList.remove('hidden');

  // Reset classes
  syncStatus.classList.remove('text-green-400', 'text-yellow-400');

  // Format based on state
  if (status.lastError) {
    // Error state - yellow warning
    syncStatus.textContent = `⚠️ ${status.lastError}`;
    syncStatus.classList.add('text-yellow-400');
  } else if (status.lastSyncTime) {
    // Successful sync - green with relative time
    syncStatus.textContent = formatRelativeTime(status.lastSyncTime);
    syncStatus.classList.add('text-green-400');

    // Refresh relative time every 10s so it doesn't freeze
    const lastSync = status.lastSyncTime;
    relativeTimeInterval = setInterval(() => {
      syncStatus.textContent = formatRelativeTime(lastSync);
    }, 10_000);
  } else {
    // Active but never synced
    syncStatus.textContent = 'pending...';
    syncStatus.classList.add('text-green-400');
  }
}

/**
 * Lifecycle status for the AbsoluteOrientationSensor capture (plan §5).
 * Structurally compatible with the framework's `AbsoluteOrientationStatus`.
 */
export interface AbsCompassStatusDisplay {
  state: 'active' | 'unavailable' | 'error';
  reason?: string;
  /** Optional latest magnetic heading (deg) for the read-out. */
  headingDeg?: number | null;
}

/**
 * Update the AbsCompass (AbsoluteOrientationSensor) status row — the Phase-1
 * presence indicator that lets a field tester confirm a recording is actually
 * capturing the independent-north sensor before collecting many sessions
 * (plan §5).
 *
 * When active with a live heading it shows the **magnetic heading the device
 * points** as a degree value (0°=N, 90°=E), the same number the v3
 * absolute-compass demo shows — so the tester can point the phone at a landmark
 * and cross-check it against that demo on the spot. Falls back to "ok" while the
 * phone is level (heading undefined), gray "unavailable", yellow "error".
 */
export function setAbsCompassStatus(status: AbsCompassStatusDisplay): void {
  const info = document.getElementById('abs-compass-info');
  const el = document.getElementById('abs-compass-status');
  if (!info || !el) {
    return;
  }
  info.classList.remove('hidden');
  el.classList.remove('text-green-400', 'text-yellow-400', 'text-gray-400');
  if (status.state === 'active') {
    // typeof===number alone is insufficient: NaN/Infinity are typeof 'number'
    // and would render "NaN°". Number.isFinite excludes both; the typeof keeps
    // the value narrowed to number for Math.round. A degenerate heading → "ok".
    el.textContent =
      typeof status.headingDeg === 'number' &&
      Number.isFinite(status.headingDeg)
        ? `${Math.round(status.headingDeg)}°`
        : 'ok';
    el.classList.add('text-green-400');
  } else if (status.state === 'unavailable') {
    el.textContent = `unavailable${status.reason ? ` (${status.reason})` : ''}`;
    el.classList.add('text-gray-400');
  } else {
    el.textContent = `⚠️ error${status.reason ? ` (${status.reason})` : ''}`;
    el.classList.add('text-yellow-400');
  }
}

/** Hide the AbsCompass status row (recording stopped). */
export function hideAbsCompass(): void {
  document.getElementById('abs-compass-info')?.classList.add('hidden');
}

/**
 * Update the QR readout row, or hide it when QR detection is off.
 *
 * The recorder used to show NOTHING for QR — the detection producer was built
 * without a status callback and no QR string reached the HUD — so a field
 * session where the detector never fired looked exactly like one where it did,
 * and the difference only surfaced at analysis time. The size it reports is
 * also the number an author checks against a tape measure.
 */
export function setQrStatus(line: string | null): void {
  const info = document.getElementById('qr-info');
  const el = document.getElementById('qr-status');
  if (!info || !el) {
    return;
  }
  if (line === null) {
    info.classList.add('hidden');
    return;
  }
  info.classList.remove('hidden');
  el.textContent = line;
}

/** Hide the QR readout row (recording stopped). */
export function hideQrStatus(): void {
  document.getElementById('qr-info')?.classList.add('hidden');
}
