/**
 * The link switch for the editor on the globe, and the knobs tuned by
 * eye: what hides on screen, and the approach's meteor (named as
 * in the globe lab). The 3D view opens on the full globe by default;
 * `edit.html?globe=0` opens the older 3D view instead, a temporary way
 * back kept until that view and the 2D map are removed. An old
 * `globe=1` link keeps opening the globe.
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

/** A knob without a default: absent, the page derives the value. */
export type GlobeSwitchOverride = Omit<GlobeSwitchKnob, "fallback">;

/** The switch's parameter and its knobs. */
export const GLOBE_SWITCH = Object.freeze({
  /** `globe=0` turns the editor on the globe off (temporary); anything
   *  else, no value among them, keeps it on. */
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
   * stays in view on the way down (about 20). From 10, the globe lab's
   * own floor: no flatter line was ever flown or swept.
   */
  meteorDeg: Object.freeze({
    param: "meteorDeg",
    fallback: 20,
    min: 10,
    max: 89,
  }) satisfies GlobeSwitchKnob,
  /**
   * ... and lands at this angle (deg), held over the final stretch: the
   * middle of 45 to 60, steep enough to see the stations from
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
   * The flight's start height (km over the ellipsoid), an override only:
   * without it the flight starts where the globe lab's intro zooms out
   * to, at the editor's lens and the page's aspect (about 43,600 km on a
   * landscape screen; `globe-approach-meteor.ts`).
   */
  startKm: Object.freeze({
    param: "startKm",
    min: 500,
    max: 65_000,
  }) satisfies GlobeSwitchOverride,
  /**
   * The speed streaks on the approach (the globe lab's speed dust, in its
   * look): 1 on, 0 off (the A/B link).
   */
  dust: Object.freeze({
    param: "dust",
    fallback: 1,
    min: 0,
    max: 1,
  }) satisfies GlobeSwitchKnob,
  /**
   * The street map's darkening gain (its luma compressed toward this,
   * `patchOsmFade` in the Globe package): the map's tiles are far brighter
   * than the relief's imagery, and at 1 the fade's edge shows as a pale
   * disc. 0.55 by eye; the link's value is its A/B switch. From 0.2 (a
   * darker map loses its roads) to 1 (as the tile server made it).
   */
  osmGain: Object.freeze({
    param: "osmGain",
    fallback: 0.55,
    min: 0.2,
    max: 1,
  }) satisfies GlobeSwitchKnob,
  /**
   * How the street map's gain darkens it (`OsmGainMode` in the Globe
   * package): "flat" multiplies its colour, which keeps the map's
   * contrasts (roads and names against the land); "compress" compresses
   * its luma and lowers them. Flat unless the link says exactly
   * "compress" (the A/B switch).
   */
  osmGainMode: Object.freeze({
    param: "osmGainMode",
    fallback: "flat",
  }),
  /**
   * The clouds' shadow strength on the ground and the tour's 3D models
   * (0 none, 1 black under a full cloud): weaker than the globe lab's 0.5,
   * so the tour reads under a cloud. The interface (pins, rings, titles)
   * is never darkened. The link's value is its A/B switch.
   */
  cloudShadow: Object.freeze({
    param: "cloudShadow",
    fallback: 0.3,
    min: 0,
    max: 1,
  }) satisfies GlobeSwitchKnob,
  /**
   * The clouds' wind floor (m/s at the equator, the drift law's `windMps`):
   * the slowest the cloud field moves, which is what is seen near the
   * ground. 40, not the globe's 10: at 10 a cloud at 3 km moved 30 m in
   * 3 s seen from the landing (about half a degree), read as static. The
   * link's value is its A/B switch.
   */
  cloudWind: Object.freeze({
    param: "cloudWind",
    fallback: 40,
    min: 0,
    max: 1_000,
  }) satisfies GlobeSwitchKnob,
  /**
   * The globe's colour grade by name (`GLOBE_GRADES` in the Globe package,
   * which judges the name: this module carries none of the globe's code).
   * Absent, the package's default.
   */
  grade: Object.freeze({ param: "grade" }),
  /**
   * The clouds near the ground. The old clouds are the default; the new
   * (near) clouds are EXPERIMENTAL and draw only for `clouds=new`, exactly.
   * `clouds=old` is accepted and is the default, so links written while
   * the new clouds were the default keep working; any other value is the
   * default too.
   */
  clouds: Object.freeze({ param: "clouds", experimental: "new" }),
  /**
   * The quality tier by name (`GLOBE_QUALITIES` in the Globe package, which
   * judges it). Absent, the View menu's choice, else the device's default.
   */
  quality: Object.freeze({ param: "quality" }),
  /**
   * The OSM buildings (and trees and roads) at the tour: 1 on, 0 off (a
   * developer's knob: no city worker is made, nothing is asked of
   * Overpass, and a frame-time comparison's other half).
   */
  buildings: Object.freeze({
    param: "buildings",
    fallback: 1,
    min: 0,
    max: 1,
  }) satisfies GlobeSwitchKnob,
});

/** What the link asks of the editor on the globe. */
export interface GlobeSwitch {
  readonly on: boolean;
  readonly hidePx: number;
  readonly crowdPx: number;
  /** The approach's meteor: its start and landing angles (deg), its
   *  landing height over the tour's ground (m), its start height (km;
   *  null: the lab's zoom-out distance). */
  readonly meteorDeg: number;
  readonly meteorLandDeg: number;
  readonly landAglM: number;
  readonly startKm: number | null;
  /** The speed streaks: 1 on, 0 off. */
  readonly dust: number;
  /** The street map's darkening gain, in (0, 1]. */
  readonly osmGain: number;
  /** How the gain darkens: "flat" or "compress". */
  readonly osmGainMode: "flat" | "compress";
  /** The clouds' shadow strength, in [0, 1]. */
  readonly cloudShadow: number;
  /** The clouds' wind floor (m/s at the equator). */
  readonly cloudWind: number;
  /** The OSM buildings at the tour: 1 on, 0 off. */
  readonly buildings: number;
  /** The colour grade's name as the link wrote it; null: none named. */
  readonly grade: string | null;
  /** Which clouds draw near the ground: "old" (the default) or "new"
   *  (experimental). */
  readonly clouds: "new" | "old";
  /** The quality tier's name; null: none named, the device's default. */
  readonly quality: string | null;
}

/** The knob's value in the link, or null when absent or not in range. */
function override(
  params: URLSearchParams,
  k: GlobeSwitchOverride,
): number | null {
  const text = params.get(k.param);
  if (text === null || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= k.min && value <= k.max
    ? value
    : null;
}

function knob(params: URLSearchParams, k: GlobeSwitchKnob): number {
  return override(params, k) ?? k.fallback;
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
    on: params.get(GLOBE_SWITCH.param) !== "0",
    hidePx: knob(params, GLOBE_SWITCH.hidePx),
    crowdPx: knob(params, GLOBE_SWITCH.crowdPx),
    meteorDeg,
    meteorLandDeg: Math.max(
      meteorDeg,
      knob(params, GLOBE_SWITCH.meteorLandDeg),
    ),
    landAglM: knob(params, GLOBE_SWITCH.landAglM),
    startKm: override(params, GLOBE_SWITCH.startKm),
    dust: Math.round(knob(params, GLOBE_SWITCH.dust)),
    osmGain: knob(params, GLOBE_SWITCH.osmGain),
    osmGainMode:
      params.get(GLOBE_SWITCH.osmGainMode.param) === "compress"
        ? "compress"
        : GLOBE_SWITCH.osmGainMode.fallback,
    cloudShadow: knob(params, GLOBE_SWITCH.cloudShadow),
    cloudWind: knob(params, GLOBE_SWITCH.cloudWind),
    buildings: Math.round(knob(params, GLOBE_SWITCH.buildings)),
    grade: params.get(GLOBE_SWITCH.grade.param),
    clouds:
      params.get(GLOBE_SWITCH.clouds.param) === GLOBE_SWITCH.clouds.experimental
        ? "new"
        : "old",
    quality: params.get(GLOBE_SWITCH.quality.param),
  };
}
