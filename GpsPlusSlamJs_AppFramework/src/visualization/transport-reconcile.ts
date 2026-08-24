/**
 * Pure reconcile step between the transport model and one billboard's player.
 *
 * The subtlest rules of the component live here: when a divergence between the
 * model's playhead and the audio element is a *deliberate jump* (a click
 * restart or a bar seek → issue a seek) versus ordinary ~4 Hz `timeupdate`
 * feedback (→ leave the element alone, or the two would fight), and when a
 * play/pause call must be issued at all. They used to be imperative diffing
 * inside the view's `applyState`; as a pure function they are unit-tested and
 * reused verbatim by component 8's AR scene.
 *
 * The view executes the returned commands mechanically: set panel visibility,
 * seek if `seekToSec` is non-null, then call `play()`/`pause()` per `playback`.
 */

import {
  isActive,
  isPlaying,
  type TransportState,
} from './playback-transport.js';

/** The slice of the audio element's state the reconcile decision reads. */
export interface PlayerSnapshot {
  readonly currentTime: number;
  readonly paused: boolean;
}

/** Commands for the view to apply to this billboard's panel + player. */
export interface ReconcileCommands {
  readonly panelVisible: boolean;
  /** Absolute seek target in seconds; `null` when the element is in sync. */
  readonly seekToSec: number | null;
  /** Imperative transport call to issue; `null` when already matching. */
  readonly playback: 'play' | 'pause' | null;
}

// Re-seek only when the element drifts this far from the model, so the ~4 Hz
// `timeupdate` feedback loop (element → tick → model → reconcile) never
// re-seeks during normal playback; only a click restart or a deliberate bar
// seek exceeds it.
const SEEK_SYNC_EPSILON_SEC = 0.3;

function playbackCommand(
  shouldPlay: boolean,
  paused: boolean
): 'play' | 'pause' | null {
  if (shouldPlay && paused) {
    return 'play';
  }
  if (!shouldPlay && !paused) {
    return 'pause';
  }
  return null;
}

/**
 * Diff the model against one billboard's player snapshot. For an inactive
 * billboard the only possible command is pausing a still-running element;
 * seeking it is pointless (a later click restarts from 0 anyway).
 */
export function reconcilePlayer(
  state: TransportState,
  id: string,
  player: PlayerSnapshot
): ReconcileCommands {
  if (!isActive(state, id)) {
    return {
      panelVisible: false,
      seekToSec: null,
      playback: player.paused ? null : 'pause',
    };
  }
  const drift = Math.abs(player.currentTime - state.positionSec);
  return {
    panelVisible: true,
    seekToSec: drift > SEEK_SYNC_EPSILON_SEC ? state.positionSec : null,
    playback: playbackCommand(isPlaying(state, id), player.paused),
  };
}
