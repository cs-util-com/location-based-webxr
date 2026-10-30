/**
 * The link switch for the editor on the globe, and the two knobs the
 * owner tunes by eye. `edit.html?globe=1` opens the 3D view on the full
 * globe; without it the editor's own 3D view stays the default.
 *
 * Pure and free of the globe's code: the page reads it on its first load.
 *
 * @see globe-switch.ts.md
 */

/** One knob of the link: its parameter name, default and range. */
export interface GlobeSwitchKnob {
  readonly param: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

/** The switch's parameter and its two knobs. */
export const GLOBE_SWITCH = Object.freeze({
  /** `globe=1` turns the editor on the globe on; anything else is off. */
  param: "globe",
  /** An object hides below this size on screen (CSS px). */
  hidePx: Object.freeze({
    param: "globeHidePx",
    fallback: 3,
    min: 0.5,
    max: 200,
  }) satisfies GlobeSwitchKnob,
  /**
   * A station pin hides when its nearest neighbour on screen is closer
   * than this (CSS px); 0 turns the crowding off.
   */
  crowdPx: Object.freeze({
    param: "globeCrowdPx",
    fallback: 24,
    min: 0,
    max: 500,
  }) satisfies GlobeSwitchKnob,
});

/** What the link asks of the editor on the globe. */
export interface GlobeSwitch {
  readonly on: boolean;
  readonly hidePx: number;
  readonly crowdPx: number;
}

function knob(params: URLSearchParams, k: GlobeSwitchKnob): number {
  const text = params.get(k.param);
  if (text === null || text.trim() === "") return k.fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= k.min && value <= k.max
    ? value
    : k.fallback;
}

/**
 * The switch and its knobs from a page link's query (`location.search`,
 * with or without its "?"). A knob that is not a finite number in its
 * range reads as its default.
 */
export function readGlobeSwitch(search: string): GlobeSwitch {
  const params = new URLSearchParams(search);
  return {
    on: params.get(GLOBE_SWITCH.param) === "1",
    hidePx: knob(params, GLOBE_SWITCH.hidePx),
    crowdPx: knob(params, GLOBE_SWITCH.crowdPx),
  };
}
