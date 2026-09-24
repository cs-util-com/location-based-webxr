/**
 * Logs an accepted sun-check Mark into the running recording, as a
 * `diagnostics/note` of kind `sun-sighting` (plan
 * 2026-09-24-0100-ar-sun-overlay-heading-check-plan.md §6.3). The note carries
 * the sighting's flat record, so the Investigation can re-derive the heading
 * error offline for any solver preset.
 */

import type { SunCheck } from 'gps-plus-slam-app-framework/ar/sun-check';
import { recordDiagnostic } from 'gps-plus-slam-app-framework/state';

/** One accepted Mark's record, as the framework's sun check produces it. */
export type SunSighting = Extract<
  Awaited<ReturnType<SunCheck['mark']>>,
  { ok: true }
>['sighting'];

export const SUN_SIGHTING_KIND = 'sun-sighting';

/** The store surface the recorder needs (read the gate, dispatch the note). */
interface NoteStore {
  getState(): unknown;
  dispatch(action: ReturnType<typeof recordDiagnostic>): unknown;
}

export interface SunSightingRecorderDeps {
  /** The CURRENT store, read at every call (the store-ref rule). */
  readonly getStore: () => NoteStore;
  /** True between Stop's action flush and the session's end. */
  readonly isStopInProgress: () => boolean;
  /** True while a replay store is installed. */
  readonly isReplaying: () => boolean;
}

/**
 * Returns the recorder: `'recorded'` when the note was dispatched into a
 * running recording, `'not-recording'` when no recording would keep it.
 */
export function createSunSightingRecorder(
  deps: SunSightingRecorderDeps
): (sighting: SunSighting) => 'recorded' | 'not-recording' {
  return (sighting) => {
    const store = deps.getStore();
    // Mirrors the persistence middleware's gate (ref-point-handlers.ts has
    // the same mirror): outside it the note would be dropped silently.
    const state = store.getState() as {
      recording?: { isRecording?: boolean };
    };
    const recording = state.recording?.isRecording ?? false;
    // Stop flushes the action writes before the zip export and ends the
    // session only after it: a note in between would pass the gate above
    // and still miss the zip.
    if (!recording || deps.isStopInProgress() || deps.isReplaying()) {
      return 'not-recording';
    }
    store.dispatch(
      recordDiagnostic({
        kind: SUN_SIGHTING_KIND,
        atMs: sighting.atMs,
        detail: { ...sighting },
      })
    );
    return 'recorded';
  };
}
