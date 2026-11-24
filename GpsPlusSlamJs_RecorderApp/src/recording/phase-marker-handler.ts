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
 * nothing is numbered.
 *
 * @see phase-marker-handler.ts.md
 */

import type { RecorderStore } from '../state/recorder-store';
import { isRecordingActive } from '../state/recording-active';
import {
  phaseMarked,
  selectNextPhaseMarkerNumber,
} from '../state/phase-markers-slice';
import { showToast } from '../ui/toast';
import { setPhaseMarkButtonLabel } from '../ui/hud';

/** Long enough to read mid-walk, short enough not to sit over the next tap. */
const CONFIRM_TOAST_MS = 1500;

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

export function createPhaseMarkerHandler(
  deps: PhaseMarkerHandlerDeps
): PhaseMarkerHandler {
  const now = deps.now ?? Date.now;
  return {
    markPhase() {
      const store = deps.getStore();
      if (!isRecordingActive(store.getState(), deps.isStopInProgress())) {
        showToast('Not recording - phase marker not saved', {
          severity: 'warning',
        });
        return null;
      }
      const number = selectNextPhaseMarkerNumber(store.getState());
      store.dispatch(phaseMarked({ number, timestamp: now() }));
      setPhaseMarkButtonLabel(number);
      showToast(`Phase ${number} marked`, {
        severity: 'info',
        duration: CONFIRM_TOAST_MS,
      });
      return number;
    },
  };
}
