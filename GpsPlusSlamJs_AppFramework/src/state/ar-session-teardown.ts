/**
 * The AR session-end STATE teardown every consumer app needs (unified
 * 2026-08-26 per DEC-H3 when the third app grew the same sequence):
 *
 * 1. `endSession()` — closes the recording; without it a re-entry's second
 *    `startSession` piles onto a live one.
 * 2. `resetGpsSessionData()` (core 1.20) — drops the session's
 *    odometry↔GPS pairs, solved alignment and odometry path while
 *    PRESERVING the zero reference. WebXR hands every session a fresh
 *    odometry origin, so pairs recorded against the dead session's origin
 *    would blend two frames into one alignment solve on re-entry.
 * 3. `resetCoordinatorState()` — clears the coordinator's cached
 *    device-orientation state.
 *
 * Device-side teardown (camera capture, scene disposal, UI) stays with the
 * caller — this is the STORE half only, and it is safe to call however the
 * session ended (app-initiated or the system back gesture).
 */

import { resetGpsSessionData } from 'gps-plus-slam-js';
import { resetCoordinatorState } from './gps-event-coordinator.js';
import { endSession } from './recording-slice.js';

/** The store surface needed — structural, so stores with extra reducers
 *  (e.g. the TourViewer's `qrDetected` slice) pass without widening. */
export interface ArTeardownStore {
  dispatch(
    action:
      | ReturnType<typeof endSession>
      | ReturnType<typeof resetGpsSessionData>
  ): unknown;
}

export function teardownArSessionState(store: ArTeardownStore): void {
  store.dispatch(endSession());
  store.dispatch(resetGpsSessionData());
  resetCoordinatorState();
}
