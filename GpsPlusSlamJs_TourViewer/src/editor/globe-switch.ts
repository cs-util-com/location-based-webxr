/**
 * The link switch for the editor on the globe, and the knobs the owner
 * tunes by eye: what hides on screen, and the approach's meteor (named as
 * in the globe lab). `edit.html?globe=1` opens the 3D view on the full
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

/** The switch's parameter and its knobs. */
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
  /**
   * The approach's meteor enters at this angle below the tour's horizon
   * (deg): shallow, so the globe turns under the camera and the horizon
   * stays in view on the way down (the owner's "about 20").
   */
  meteorDeg: Object.freeze({
    param: "meteorDeg",
    fallback: 20,
    min: 1,
    max: 89,
  }) satisfies GlobeSwitchKnob,
  /**
   * ... and lands at this angle (deg), held over the final stretch: the
   * middle of the owner's 45 to 60, steep enough to see the stations from
   * above, shallow enough to see where they stand. Never under
   * `meteorDeg` (read as it then).
   */
  meteorLandDeg: Object.freeze({
    param: "meteorLandDeg",
    fallback: 50,
    min: 10,
    max: 85,
  }) satisfies GlobeSwitchKnob,
  /**
   * The landing's height over the tour's ground (m): at 50 degrees the
   * camera ends about 196 m from the tour along its view, close to it
   * with a tour of a few hundred metres in the 50 degree lens.
   */
  landAglM: Object.freeze({
    param: "landAglM",
    fallback: 150,
    min: 30,
    max: 5_000,
  }) satisfies GlobeSwitchKnob,
  /**
   * The flight's start height (km): the whole Earth in view at the
   * editor's lens, as the approach always began.
   */
  startKm: Object.freeze({
    param: "startKm",
    fallback: 8_000,
    min: 500,
    max: 65_000,
  }) satisfies GlobeSwitchKnob,
});

/** What the link asks of the editor on the globe. */
export interface GlobeSwitch {
  readonly on: boolean;
  readonly hidePx: number;
  readonly crowdPx: number;
  /** The approach's meteor: its start and landing angles (deg), its
   *  landing height over the tour's ground (m), its start height (km). */
  readonly meteorDeg: number;
  readonly meteorLandDeg: number;
  readonly landAglM: number;
  readonly startKm: number;
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
  const meteorDeg = knob(params, GLOBE_SWITCH.meteorDeg);
  return {
    on: params.get(GLOBE_SWITCH.param) === "1",
    hidePx: knob(params, GLOBE_SWITCH.hidePx),
    crowdPx: knob(params, GLOBE_SWITCH.crowdPx),
    meteorDeg,
    meteorLandDeg: Math.max(
      meteorDeg,
      knob(params, GLOBE_SWITCH.meteorLandDeg),
    ),
    landAglM: knob(params, GLOBE_SWITCH.landAglM),
    startKm: knob(params, GLOBE_SWITCH.startKm),
  };
}
