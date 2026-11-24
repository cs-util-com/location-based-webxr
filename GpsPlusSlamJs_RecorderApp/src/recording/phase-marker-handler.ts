/**
 * The "Mark phase" tap: drops the next numbered phase marker into the running
 * recording and confirms it on screen.
 *
 * Recording a marker is synchronous store work (one dispatch; the
 * persistence middleware queues the file write), so the tap needs no
 * in-progress state. What it does need is an outcome the walker can read at
 * a glance: a short toast naming the number, and the button keeps showing
 * the last number. A tap that cannot reach the recording (none running, or
 * Stop already exporting the zip) is refused with a warning toast and
 * nothing is numbered. A second tap within {@link DOUBLE_TAP_GUARD_MS} of
 * the last marker is taken as a double tap and dropped.
 *
 * @see phase-marker-handler.ts.md
 */

import type { RecorderStore } from '../state/recorder-store';
import { isRecordingActive } from '../state/recording-active';
import {
  phaseMarked,
  selectPhaseMarkers,
  selectNextPhaseMarkerNumber,
} from '../state/phase-markers-slice';
import { showToast, isAlertToastShowing } from '../ui/toast';
import { setPhaseMarkButtonLabel } from '../ui/hud';

/** Long enough to read mid-walk, short enough not to sit over the next tap. */
const CONFIRM_TOAST_MS = 1500;

/**
 * A tap this soon after the last marker is a double tap, not a new phase:
 * no protocol step is shorter than half a second.
 */
const DOUBLE_TAP_GUARD_MS = 500;

export interface PhaseMarkerHandlerDeps {
  /** The current store (a new one per recording). */
  getStore: () => RecorderStore;
  /** True from Stop until the session has ended. */
  isStopInProgress: () => boolean;
  /** Epoch-ms clock; tests inject one. */
  now?: () => number;
}

export interface PhaseMarkerHandler {
  /** Record the next marker; its number, or null when the tap was refused. */
  markPhase(): number | null;
}

/**
 * A short info confirmation, unless a warning or error toast is still up:
 * that one matters more, and the button label already shows the number.
 */
function confirm(message: string): void {
  if (isAlertToastShowing()) return;
  showToast(message, { severity: 'info', duration: CONFIRM_TOAST_MS });
}

export function createPhaseMarkerHandler(
  deps: PhaseMarkerHandlerDeps
): PhaseMarkerHandler {
  // Looked up per tap, not captured once: a page clock installed after
  // start-up (the e2e test pins it) must be the clock the guard sees.
  const now = deps.now ?? (() => Date.now());
  return {
    markPhase() {
      const store = deps.getStore();
      const state = store.getState();
      if (!isRecordingActive(state, deps.isStopInProgress())) {
        showToast('Not recording - phase marker not saved', {
          severity: 'warning',
        });
        return null;
      }
      const timestamp = now();
      // The last marker lives in the store, so the guard needs no state of
      // its own and a new recording (new store) starts unguarded.
      const last = selectPhaseMarkers(state).at(-1);
      if (last) {
        const sinceLast = timestamp - last.timestamp;
        // Forward only: a clock stepped backwards must not lock the button.
        if (sinceLast >= 0 && sinceLast < DOUBLE_TAP_GUARD_MS) {
          confirm(`Phase ${last.number} already marked`);
          return null;
        }
      }
      const number = selectNextPhaseMarkerNumber(state);
      store.dispatch(phaseMarked({ number, timestamp }));
      setPhaseMarkButtonLabel(number);
      confirm(`Phase ${number} marked`);
      return number;
    },
  };
}
