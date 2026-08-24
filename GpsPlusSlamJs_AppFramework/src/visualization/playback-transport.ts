/**
 * Pure playback "transport" model — the single source of truth for which clip
 * is active, whether it is playing or paused, and where the playhead is.
 *
 * One reducer drives three things at once: the exclusive one-clip-at-a-time
 * policy (a `click` makes that id the only active clip), the play/stop button
 * (`toggle`), and the seekable progress bar (`seek` + `tick` + `progressFraction`).
 * Keeping it one model — rather than a per-sprite flag plus a separate
 * "who's playing" map — is what removes the chance of the two drifting and what
 * lets us ignore *stale* `ended` and `tick` events (from a clip the user
 * already switched away from — pausing an element emits a final `timeupdate`)
 * instead of letting them stop or scrub the new clip. Both actions carry the
 * source clip's id for exactly that reason; callers forward events blindly.
 *
 * Framework-free and view-free: no Three.js, no DOM, no audio element. The view
 * layer maps these actions to `HTMLAudioElement` calls and forwards `tick` /
 * `ended` back in. Reused by component 8's AR scene.
 */

import { clamp01 } from './clamp.js';

// Local — consumers read playback via the `isPlaying` selector, not this type.
type PlaybackStatus = 'playing' | 'paused';

export interface TransportState {
  /** The clip whose panel is open / whose audio is loaded; `null` when idle. */
  readonly activeId: string | null;
  readonly status: PlaybackStatus;
  readonly positionSec: number;
  /** Clip length; 0 until the audio element reports it via `tick`. */
  readonly durationSec: number;
}

export type TransportAction =
  | { readonly type: 'click'; readonly id: string }
  | { readonly type: 'toggle' }
  | { readonly type: 'seek'; readonly fraction: number }
  | {
      readonly type: 'tick';
      /** The clip whose audio element emitted the tick (stale ticks ignored). */
      readonly id: string;
      readonly positionSec: number;
      readonly durationSec: number;
    }
  | { readonly type: 'ended'; readonly id: string };

export const INITIAL: TransportState = {
  activeId: null,
  status: 'paused',
  positionSec: 0,
  durationSec: 0,
};

/**
 * Apply `update` only when a clip is active; otherwise the action is a no-op
 * (returns the same state). Centralises the idle guard shared by `toggle` /
 * `seek` so the reducer itself stays simple (`tick` / `ended` guard by id
 * instead, which subsumes the idle case).
 */
function whenActive(
  state: TransportState,
  update: (s: TransportState) => TransportState
): TransportState {
  return state.activeId === null ? state : update(state);
}

export function transportReducer(
  state: TransportState,
  action: TransportAction
): TransportState {
  switch (action.type) {
    case 'click':
      // A sprite click always (re)starts that clip from the beginning and makes
      // it the sole active clip. Re-clicking the active clip keeps its known
      // duration (same element, still valid — the bar must not flash empty);
      // for a new clip the duration is unknown until the next `tick`.
      return {
        activeId: action.id,
        status: 'playing',
        positionSec: 0,
        durationSec: action.id === state.activeId ? state.durationSec : 0,
      };

    case 'toggle':
      return whenActive(state, (s) => ({
        ...s,
        status: s.status === 'playing' ? 'paused' : 'playing',
      }));

    case 'seek':
      return whenActive(state, (s) => ({
        ...s,
        positionSec: clamp01(action.fraction) * s.durationSec,
      }));

    case 'tick':
      // Ignore a stale tick, symmetric with `ended`: pausing the previous
      // clip's element emits a final `timeupdate` that must not scrub the
      // clip the user just switched to. (Also covers the idle case.)
      return action.id === state.activeId
        ? {
            ...state,
            positionSec: action.positionSec,
            durationSec: action.durationSec,
          }
        : state;

    case 'ended':
      // Ignore a stale `ended` from a clip that is no longer active — otherwise
      // a late event would stop the clip the user just switched to.
      return action.id === state.activeId
        ? { ...state, status: 'paused', positionSec: state.durationSec }
        : state;
  }
}

export function isActive(state: TransportState, id: string): boolean {
  return state.activeId === id;
}

export function isPlaying(state: TransportState, id: string): boolean {
  return state.activeId === id && state.status === 'playing';
}

/** Playhead fraction in [0, 1]; 0 when the duration is not known yet. */
export function progressFraction(state: TransportState): number {
  if (state.durationSec <= 0) {
    return 0;
  }
  return clamp01(state.positionSec / state.durationSec);
}
