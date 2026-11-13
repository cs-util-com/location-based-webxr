/**
 * Then and now's blend between the old picture and today: when a visitor
 * lines up with the viewpoint, the old picture fades in from nothing to
 * about half over a few seconds, and from then on the visitor's slider
 * sets it. Lining up has hysteresis, so a wobble across the gate neither
 * drops the slider nor replays the fade; the fade replays only once the
 * visitor was off the spot for a while. Pure: the world part steps it
 * every frame.
 *
 * @see then-now-fade.ts.md
 */
import { smoothstep } from "../../smoothstep.js";

/** The numbers of the blend. */
export interface ThenNowTiming {
  /** Lining up starts within this many degrees of the viewpoint's heading. */
  readonly enterDeg: number;
  /** ... and ends past this many. */
  readonly leaveDeg: number;
  /** Lining up starts once the distance ramp reads above this ... */
  readonly enterNear: number;
  /** ... and ends below this. */
  readonly leaveNear: number;
  /** The fade replays only after the visitor was off the spot this long. */
  readonly freshAfterS: number;
  /** Where the fade ends, 0 to 1. */
  readonly introTo: number;
  /** How long it takes. */
  readonly introS: number;
}

export const THEN_NOW_TIMING: ThenNowTiming = {
  enterDeg: 32,
  leaveDeg: 44,
  enterNear: 0.6,
  leaveNear: 0.3,
  freshAfterS: 1.5,
  introTo: 0.55,
  introS: 5,
};

export interface ThenNowState {
  /** Lined up with the viewpoint: the slider shows. */
  readonly aligned: boolean;
  /** Seconds since lining up was lost (infinite before the first time). */
  readonly lostForS: number;
  /** Seconds into the fade, or null while none runs. */
  readonly introS: number | null;
  /** The old picture's share, 0 to 1. */
  readonly fade: number;
}

export const THEN_NOW_START: ThenNowState = {
  aligned: false,
  lostForS: Infinity,
  introS: null,
  fade: 0,
};

/** One frame's reading: how near (the distance ramp, 0 to 1), how far off
 *  the heading (degrees), and whether the picture is shown at all. */
export interface ThenNowInput {
  readonly dtS: number;
  readonly near: number;
  readonly offAxisDeg: number;
  readonly shown: boolean;
}

function lined(was: boolean, input: ThenNowInput, t: ThenNowTiming): boolean {
  if (!input.shown) return false;
  if (!was) return input.near > t.enterNear && input.offAxisDeg < t.enterDeg;
  return !(input.near < t.leaveNear || input.offAxisDeg > t.leaveDeg);
}

/** The next frame's state. A negative or non-finite `dtS` counts as 0. */
export function stepThenNow(
  state: ThenNowState,
  input: ThenNowInput,
  timing: ThenNowTiming = THEN_NOW_TIMING,
): ThenNowState {
  const dt = Number.isFinite(input.dtS) && input.dtS > 0 ? input.dtS : 0;
  const aligned = lined(state.aligned, input, timing);
  let { introS, fade, lostForS } = state;
  if (aligned && !state.aligned) {
    if (lostForS >= timing.freshAfterS) {
      introS = 0;
      fade = 0;
    }
    lostForS = 0;
  }
  if (!aligned) lostForS += dt;
  if (introS !== null) {
    introS += dt;
    const k = Math.min(1, introS / timing.introS);
    fade = timing.introTo * smoothstep(0, 1, k);
    if (k >= 1) introS = null;
  }
  return { aligned, lostForS, introS, fade };
}

/** The visitor moved the slider: the fade stops and `fade` (clamped to 0
 *  to 1; not a number keeps the old) is the share from now on. */
export function takeOverThenNow(
  state: ThenNowState,
  fade: number,
): ThenNowState {
  if (!Number.isFinite(fade)) return state;
  return { ...state, introS: null, fade: Math.min(1, Math.max(0, fade)) };
}
