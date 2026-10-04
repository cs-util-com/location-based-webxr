/**
 * The vocabulary one recording is described in: what it OWNS, and the fallback
 * name it falls back to when it has none.
 *
 * WHY THIS IS ITS OWN MODULE. Both the handler factory and the stop flow need
 * these, and the stop flow lives in `stop-recording.ts` — so leaving them in
 * `recording-session-handlers.ts` would have made that module import its own
 * caller. A shared vocabulary module is the ordinary answer to that, and it is
 * a smaller thing than the alternative of moving `RecordingSessionDeps` as
 * well (see `stop-recording.ts` for how that was avoided instead).
 *
 * @see session-runtime.ts.md
 */

import { DEFAULT_SCENARIO } from '../storage/session-zip-naming';
import type { FailureTracker } from 'gps-plus-slam-app-framework/utils/failure-tracker';
import type { SyncManager } from '../storage/sync-manager';
import type { ZipExportResult } from 'gps-plus-slam-app-framework/storage/zip-export';
import type { QrAnchorOutcome } from '../qr/qr-level-zip-contributor';
import type { ImageQualityClient } from './image-quality-client';

/**
 * Single fallback used everywhere a scenario name is needed but unavailable.
 * Re-exported from `session-zip-naming.DEFAULT_SCENARIO` so that the recording
 * pipeline and the replay browser's metadata-merge contract stay in sync
 * (any divergence would silently break the "missing-metadata + Default
 * Scenario" merge for newly-recorded zips).
 */
export const FALLBACK_SCENARIO = DEFAULT_SCENARIO;

/**
 * Everything ONE recording owns: its resources, its identity, and the two
 * results the summary screen reads.
 *
 * WHY IT IS A NAMED OBJECT AND NOT NINE `let`s. It was nine, and the cost was
 * not tidiness: the stop flow reaches into all of them, so the 168-line
 * `performStop` could not be moved anywhere without losing access to its own
 * state. Naming the cluster is what makes that possible, and it also answers
 * "what does a recording actually hold?" in one place instead of nine
 * declarations spread over twenty-five lines.
 *
 * **MUTABLE ON PURPOSE, and every field is nulled by its owner.** These are
 * live resources — a worker, a timer, a sync manager, a store subscription —
 * whose lifetime is the recording's. `readonly` would be a lie here; what
 * keeps them honest is that each is cleared on the path that stops it, which
 * `cleanupForNewRecording` and `reset` both assert by doing it again.
 *
 * The two re-entrancy flags are NOT here. They guard handlers rather than the
 * recording; see the comment at their declaration.
 */
export interface SessionRuntime {
  /** Warn-once tracker for image WRITE failures; created on start. */
  writeFailureTracker: FailureTracker | null;
  /** Warn-once tracker for image CAPTURE failures; created on start. */
  captureFailureTracker: FailureTracker | null;
  /** `recording-<timestamp>`, the folder and zip name. Empty between sessions. */
  currentSessionName: string;
  /** External-zip sync driver, when the user chose a save location. */
  syncManager: SyncManager | null;
  /**
   * What the last contributor run decided per code — shown on the summary
   * screen, so a declined anchor is visible rather than just absent.
   */
  latestQrAnchorOutcomes: readonly QrAnchorOutcome[];
  /** The zip the session ended up in, external or OPFS-generated. */
  lastSyncResult: ZipExportResult | null;
  /** Teardown for this recording's store subscriptions. */
  unsubscribeStore: (() => void) | null;
  /**
   * Off-thread blur/blackness analyzer worker for this recording (null when the
   * quality gate is disabled). Owned here: created on start, disposed on stop.
   */
  imageQualityClient: ImageQualityClient | null;
  /**
   * Live AbsCompass HUD refresh timer for THIS recording. The capture module
   * surfaces lifecycle via its onStatus callback but not per-reading; this polls
   * the latest reading a few times a second to show the live magnetic heading
   * (the same number the v3 absolute-compass demo shows), so a field tester can
   * point at a landmark and cross-check it on the spot. Armed on start, cleared
   * on stop.
   */
  absCompassHudTimer: ReturnType<typeof setInterval> | null;
}
