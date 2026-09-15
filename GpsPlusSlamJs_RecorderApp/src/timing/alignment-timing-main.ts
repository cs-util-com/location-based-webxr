/**
 * Entry point of `alignment-timing.html`. Supplies the real dependencies to
 * `alignment-timing-page.ts` and does nothing else - all behaviour, and every
 * test, lives there.
 *
 * This module is NOT reachable from the recorder's own entry (`src/main.ts`)
 * and the page is linked from nothing; `alignment-timing-isolation.test.ts`
 * asserts both. The recorder's normal behaviour is unchanged.
 *
 * THE STORE IS THE APP'S OWN, deliberately. The timed unit is one dispatch of
 * a recorded GPS action into the store the recorder builds for itself, so the
 * figure includes the dispatch machinery the app really pays around the solve,
 * not a stripped-down harness that would flatter it. Three deviations, each
 * for a stated reason:
 *
 * - `NullStorageBackend` - the page never starts a recording session, so the
 *   persistence middleware short-circuits anyway; a null backend makes that
 *   true by construction rather than by accident.
 * - `enableDevChecks: false` - matches a production build, where the
 *   deep-equality dev middleware is off. Left on, a dev-server run would
 *   measure those checks rather than the solve.
 * - the three compass opt-ins OFF - otherwise the framework auto-enables one
 *   of them on the first session zero, and every arm would be measured under a
 *   configuration none of them declared. Replay mode disables them for the
 *   same reason.
 */

import { wireAlignmentTimingPage } from './alignment-timing-page';
import { loadRecording } from '../storage/recording-loader';
import { createRecorderStore } from '../state/recorder-store';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';

wireAlignmentTimingPage({
  document,
  readFile: async (file) => new Uint8Array(await file.arrayBuffer()),
  loadRecording: async (bytes) => {
    const recording = await loadRecording(bytes);
    return recording.actions.map((entry) => entry.action);
  },
  createStore: () =>
    createRecorderStore({
      storageBackend: new NullStorageBackend(),
      enableDevChecks: false,
      enableCompassColdStartOverride: false,
      enableCompassRotationPrior: false,
      enableCompassWebXRConsistency: false,
    }),
  environment: {
    userAgent: navigator.userAgent,
    hardwareConcurrency:
      typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : null,
    appVersion: globalThis.__APP_VERSION__ ?? 'dev',
    libraryVersion: globalThis.__LIB_VERSION__ ?? 'dev',
    frameworkVersion: globalThis.__FW_VERSION__ ?? 'dev',
    buildCommit: globalThis.__BUILD_COMMIT__ ?? 'dev',
  },
  now: () => performance.now(),
  nowIso: () => new Date().toISOString(),
});
