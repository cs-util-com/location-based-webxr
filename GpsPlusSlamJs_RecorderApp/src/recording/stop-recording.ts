/**
 * Stopping a recording: tearing down what feeds it, then the ordered flow that
 * persists, packages and summarises what it produced.
 *
 * WHY IT IS OUT HERE. `performStop` is 170 lines doing nine things in
 * sequence, and it was the largest single function in a 939-line factory. It
 * could not move while the nine variables it reads and writes were loose
 * `let`s in that factory's closure; naming them as {@link SessionRuntime} is
 * what made this possible.
 *
 * **`handleStopRecording` DELIBERATELY STAYED BEHIND.** It is the re-entrancy
 * guard, and the flag it owns must not travel — a guard that moved with the
 * flow would be re-created per call and guard nothing.
 *
 * @see stop-recording.ts.md
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  getDepthSampleCount,
  getImageCaptureFrameCount,
  stopDepthCapture,
  stopImageCapture,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { stopAbsoluteOrientationWatch } from 'gps-plus-slam-app-framework/sensors/absolute-orientation';
import {
  stopGpsWatch,
  stopOrientationWatch,
} from 'gps-plus-slam-app-framework/sensors/gps';
import { endSession } from 'gps-plus-slam-app-framework/state/recording-slice';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import {
  hideAbsCompass,
  hideFrameCount,
  hideQrStatus,
  hideRecordingControls,
  hideTrackingQuality,
  updateStatus,
} from '../ui/hud';
import {
  disableBeforeUnloadWarning,
  replaceScreenState,
} from '../ui/navigation';
import { showSessionSummary } from '../ui/session-summary';
import { selectRefPointEntries } from '../state/ref-points-slice';
import {
  generateSessionFilename,
  getSaveFileName,
} from '../storage/external-file-storage';
import { exportScenarioSessionAsZip } from '../storage/scenario-zip-export';
import { buildSessionSummary } from './build-session-summary';
import {
  sanitizedPageUrl,
  writeSessionMetadata,
} from 'gps-plus-slam-app-framework/storage/session-metadata-record';
import { getBuildInfo } from '../utils/build-info';
import { buildZipContributors } from './zip-contributors';
import type { ZipContributorDeps } from './zip-contributors';
import { FALLBACK_SCENARIO, type SessionRuntime } from './session-runtime';
import type { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import type { ImageQualityClient } from './image-quality-client';

const log = createLogger('StopRecording');

/**
 * The slice of `RecordingSessionDeps` the stop flow needs.
 *
 * Narrow on purpose — see the same note in `zip-contributors.ts`. Six of that
 * interface's sixteen members, and stating which six is documentation the full
 * type cannot carry. It extends {@link ZipContributorDeps} because the final
 * export builds the contributors.
 */
export interface StopRecordingDeps extends ZipContributorDeps {
  setImageQualityAnalyzer: (
    analyzer: ImageQualityClient['analyze'] | null
  ) => void;
  getMapOverlay: () => LeafletMapOverlay | null;
  collectTrackerErrors: (
    tracker: { getFailureCount(): number; reset(): void } | null,
    label: string,
    errors: string[]
  ) => void;
}

/**
 * Clear the live AbsCompass HUD poll.
 *
 * OUT HERE RATHER THAN IN THE FACTORY because it is half of a pair whose other
 * half is a stop-path concern: `stopLiveFeeds` must clear the timer, and
 * `startAbsCompassHudUpdates` calls this first so re-arming can never leak the
 * previous interval. The factory imports it back for that second reason.
 */
export function stopAbsCompassHudUpdates(runtime: SessionRuntime): void {
  if (runtime.absCompassHudTimer !== null) {
    clearInterval(runtime.absCompassHudTimer);
    runtime.absCompassHudTimer = null;
  }
}

/**
 * Stop everything that actively FEEDS a recording — captures, sensor
 * watches, the off-thread quality analyzer — plus their HUD readouts. The
 * ONE teardown for this resource cluster, shared by `performStop` (the
 * ordered stop flow) and `cleanupForNewRecording` (the start-over path),
 * which previously skipped it and left the camera/GPS feeds and the analyzer
 * Worker running (recurring PR #115/#120/#123 review finding). Every call is
 * idempotent, so running it on an already-stopped session is a no-op.
 *
 * NOT the XR-session-end path, despite what this comment said until
 * 2026-08-17: a system-ended XRSession is handled by `system-session-end.ts`,
 * which calls the regular `handleStopRecording` — so that path reaches this
 * function through `performStop`, never through `cleanupForNewRecording`.
 */
export function stopLiveFeeds(
  runtime: SessionRuntime,
  deps: StopRecordingDeps
): void {
  stopImageCapture();
  // Tear down the off-thread quality analyzer (worker) for this recording
  // and clear the injected callback so the next recording starts clean.
  deps.setImageQualityAnalyzer(null);
  runtime.imageQualityClient?.dispose();
  runtime.imageQualityClient = null;
  hideFrameCount();
  hideTrackingQuality();
  stopDepthCapture();
  stopGpsWatch();
  stopOrientationWatch();
  stopAbsCompassHudUpdates(runtime);
  stopAbsoluteOrientationWatch();
  hideAbsCompass();
  hideQrStatus();
}

export async function performStop(
  runtime: SessionRuntime,
  deps: StopRecordingDeps
): Promise<void> {
  log.info('Stop recording');

  disableBeforeUnloadWarning();

  // Capture counts before stopping
  const imageCount = getImageCaptureFrameCount();
  const depthSampleCount = getDepthSampleCount();

  stopLiveFeeds(runtime, deps);

  // Capture authoritative end time immediately when recording stops,
  // before async operations (metadata write, sync, ZIP export) that
  // may take several seconds. Used for both metadata and summary.
  const endTime = Date.now();

  // Get state before dispatch
  const store = deps.getStore();

  // Drain the persistence middleware's async WriteQueue BEFORE anything
  // reads this session's `actions/` (the final external sync and the OPFS
  // zip export below) — an action dispatched moments before Stop could
  // otherwise land after the export enumerated the directory and silently
  // miss the zip (indoor-loop enablement follow-up §3.6b, 2026-07-12).
  try {
    await store.flushPendingActionWrites();
  } catch (err) {
    log.error('Failed to flush pending action writes:', err);
  }

  const state = store.getState();
  const sessionMetadata = state.recording.sessionMetadata;
  const gpsEvents = state.gpsData?.gpsEvents;
  // Reference points come from the recorder's flat `refPoints` slice (the
  // canonical post-slice-collapse source). The legacy `gpsData.referencePoints`
  // slice is no longer dispatched to (Step 5.7a-1), so reading it here would
  // always yield an empty list. The flat entries carry `timestamp`, which the
  // summary map needs to classify each marker as prior vs. current.
  const refPoints = selectRefPointEntries(state.refPoints);
  const gpsPositions = gpsEvents?.gpsPositions ?? [];

  if (!sessionMetadata?.startTime) {
    log.error(
      'sessionMetadata.startTime is missing at stop — this indicates an inconsistent state. ' +
        'The recorded startedAt will be incorrect (≈ endedAt).'
    );
  }

  // WRITTEN BY ITS OWN MODULE since 2026-09-22. This was forty-five lines
  // here, and it is the one part of the stop pipeline whose inputs are all
  // values - everything around it closes over mutable state of this factory,
  // which is why it moved first. See `session-metadata-record.ts`, in the
  // framework since the Tour Viewer's recording writes the same record.
  await writeSessionMetadata((record) => store.writeSessionMetadata(record), {
    endTime,
    startTime: sessionMetadata?.startTime,
    contextTag: sessionMetadata?.contextTag ?? FALLBACK_SCENARIO,
    gpsPositions,
    frameCount: imageCount,
    userAgent: navigator.userAgent,
    pageUrl: sanitizedPageUrl(globalThis.location?.href),
    getBuildInfo,
  });
  // Final sync before stopping. Capture the manager into a local and claim
  // ownership (null the shared field) *before* the await, so any concurrent
  // teardown path (a second stop, or cleanupForNewRecording) sees null and
  // no-ops instead of stopping it from under us.
  // Defense in depth alongside the re-entrancy guard (Sentry issue 7319627943).
  const sm = runtime.syncManager;
  runtime.syncManager = null;
  if (sm) {
    try {
      log.info('Triggering final sync before stopping...');
      await sm.syncNow();
      log.info('Final sync completed successfully');
    } catch (err) {
      log.error('Final sync failed:', err);
    }
    sm.stop();
    log.info('External ZIP sync stopped');
  }

  // Cleanup store subscription
  if (runtime.unsubscribeStore) {
    runtime.unsubscribeStore();
    runtime.unsubscribeStore = null;
  }

  // Collect tracker errors before resetting
  const errors: string[] = [];
  deps.collectTrackerErrors(
    runtime.writeFailureTracker,
    'image write failures',
    errors
  );
  runtime.writeFailureTracker = null;
  deps.collectTrackerErrors(
    runtime.captureFailureTracker,
    'image capture failures',
    errors
  );
  runtime.captureFailureTracker = null;

  // Hide map overlay
  const mapOverlay = deps.getMapOverlay();
  if (mapOverlay?.isVisible()) {
    mapOverlay.hide();
  }

  // Generate ZIP from OPFS when no external save location
  if (!runtime.lastSyncResult) {
    try {
      log.info('No external save location — generating ZIP from OPFS...');
      updateStatus('Packaging session...');
      const scenarioName =
        deps.getStore().getState().scenario.currentScenarioName ||
        FALLBACK_SCENARIO;
      const result = await exportScenarioSessionAsZip(
        scenarioName,
        runtime.currentSessionName,
        {
          contributors: buildZipContributors(runtime, deps),
        }
      );
      runtime.lastSyncResult = result;
      log.info(
        `OPFS ZIP created: ${result.blob.size} bytes, ${result.fileCount} files`
      );
    } catch (err) {
      log.error('Failed to generate ZIP from OPFS:', err);
    }
  }

  // Dispatch session end
  store.dispatch(endSession());

  // Build summary data (pure derivation — see build-session-summary.ts)
  const summaryData = buildSessionSummary({
    endTime,
    startTime: sessionMetadata?.startTime,
    imageCount,
    depthSampleCount,
    errors,
    // Whatever the last contributor run decided per code — including the
    // refusals, which are invisible in the zip itself.
    qrAnchors: runtime.latestQrAnchorOutcomes,
    failedWriteCount: state.recording.failedWriteCount,
    gpsPositions,
    odometryPositions: gpsEvents?.odometryPositions ?? [],
    alignmentMatrix: gpsEvents?.alignmentMatrix ?? null,
    alignmentSnapshotNuePositions:
      gpsEventVisualizer.getAlignmentSnapshotPositions(),
    refPoints,
    syncResult: runtime.lastSyncResult,
    zipFilename: runtime.lastSyncResult
      ? (getSaveFileName() ?? generateSessionFilename())
      : undefined,
  });

  // Clean up sync result reference
  runtime.lastSyncResult = null;
  // Never carry a previous recording's verdicts into this one's summary:
  // a session with QR off writes no outcomes, so a stale list would be
  // shown as if it described the recording just finished.
  runtime.latestQrAnchorOutcomes = [];

  log.info('Session summary:', summaryData);

  hideRecordingControls();
  replaceScreenState('summary');
  showSessionSummary(summaryData);
}
