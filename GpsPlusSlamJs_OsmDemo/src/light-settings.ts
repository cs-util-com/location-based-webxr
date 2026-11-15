/**
 * The light settings the owner tunes in the light dialog (plan
 * 2026-09-24-2140-osm-demo-light-settings-dialog-plan): the noon surface
 * gain's ramp, the sky light on buildings, the sky's auto-exposure
 * adaptation, the EV compensation, and the haze's visibility and start
 * (`HAZE_VISIBILITY_KM`, `HAZE_START_RATIO`). The defaults ARE the shipped look, so
 * an untouched dialog changes nothing; the values travel in the URL
 * (`?light=v1:gain=1.8,ev=-2.5`, only the fields that differ) so a tuned
 * look can be shared and pasted back. This is a deliberate exception to
 * DEC-R12-5 (presentation state stays out of the URL): the owner asked for
 * it (plan 2026-09-24-2140, DEC-LIGHT-4), and the keyed, versioned form keeps
 * every value a link STATES. A field a link leaves out means today's
 * default, so a new default changes such a link: r1158 raised the sky light
 * on buildings from 1.4 to 3, and an old link without `sky` now opens at 3.
 * Deliberate (light-settings.ts.md, "Old links"): the linear building colours
 * of r1158 changed what 1.4 renders, so no value could keep such a link's look.
 *
 * @see light-settings.ts.md
 */

import {
  BUILDING_SKY_LIGHT,
  HAZE_START_RATIO,
  HAZE_VISIBILITY_KM,
  NATURAL_LIGHT_ADAPTATION,
  NATURAL_LIGHT_COMPENSATION_EV,
  NOON_SURFACE_GAIN,
  type SurfaceGainRamp,
} from "./atmosphere-rig.js";
import { HAZE_VEIL_TINT, type HazeVeil } from "./haze-veil.js";

export interface LightSettings {
  /** The building and road colour factor at a high sun. */
  readonly gainMax: number;
  /** The sun elevation where the factor starts rising, degrees. */
  readonly gainFromDeg: number;
  /** The sun elevation where it reaches `gainMax`, degrees. */
  readonly gainFullDeg: number;
  /** A multiplier on the building materials' sky (environment) light. */
  readonly buildingSkyLight: number;
  /**
   * The sky auto-exposure's adaptation (1 full). Measured (plan §8): lowering
   * it barely changes noon and mostly darkens dawn and dusk.
   */
  readonly exposureAdaptation: number;
  /** The EV compensation on top of the auto-exposure. */
  readonly exposureEv: number;
  /**
   * The air's meteorological visibility, km: the sky's and the haze's on the
   * city (`AtmosphereRig.setHaze`). Lower brings the haze into the city.
   */
  readonly hazeVisibilityKm: number;
  /**
   * Where the haze's boundary fade starts, as a share of the draw distance
   * (0 at the camera). The physical haze acts at every distance either way.
   */
  readonly hazeStartRatio: number;
  /**
   * The haze veil's lightness, CIE L* on screen (`haze-veil.ts`); 0 means
   * no veil, the haze takes the sky's colour as it always did.
   */
  readonly hazeVeilLightness: number;
  /** The haze veil's tint, CIE b* on screen; below 0 is bluer. */
  readonly hazeVeilTint: number;
}

/** Today's look: the shipped constants, read from where they live. */
export const DEFAULT_LIGHT_SETTINGS: LightSettings = {
  gainMax: NOON_SURFACE_GAIN.max,
  gainFromDeg: NOON_SURFACE_GAIN.fromDeg,
  gainFullDeg: NOON_SURFACE_GAIN.fullDeg,
  buildingSkyLight: BUILDING_SKY_LIGHT,
  exposureAdaptation: NATURAL_LIGHT_ADAPTATION,
  exposureEv: NATURAL_LIGHT_COMPENSATION_EV,
  hazeVisibilityKm: HAZE_VISIBILITY_KM,
  hazeStartRatio: HAZE_START_RATIO,
  hazeVeilLightness: 0,
  hazeVeilTint: HAZE_VEIL_TINT,
};

/** The sliders' ranges and steps (the dialog's inputs and the URL's bounds). */
export const LIGHT_SETTING_RANGES: {
  readonly [K in keyof LightSettings]: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
  };
} = {
  gainMax: { min: 1, max: 2.5, step: 0.05 },
  gainFromDeg: { min: 0, max: 60, step: 1 },
  gainFullDeg: { min: 1, max: 90, step: 1 },
  // To 5 since the default became 3 (r1158), so the slider still brightens.
  buildingSkyLight: { min: 0.5, max: 5, step: 0.05 },
  exposureAdaptation: { min: 0.5, max: 1, step: 0.05 },
  exposureEv: { min: -4, max: 0, step: 0.05 },
  // 9 km is the hazy end of the reference city measured (9-21 km); 60 the
  // look-dev noon preset, so the slider also clears the air.
  hazeVisibilityKm: { min: 9, max: 60, step: 1 },
  // Below 1, so the fade never starts at the far plane itself.
  hazeStartRatio: { min: 0, max: 0.9, step: 0.01 },
  // 80 keeps every tint below the tone curve's knee (at -12, L* 81 is the last; haze-veil.test.ts holds
  // it for every slider value); 0 is "no veil".
  hazeVeilLightness: { min: 0, max: 80, step: 1 },
  hazeVeilTint: { min: -12, max: 4, step: 0.5 },
};

/** Each field's key in the URL; never rename one (shared links use them). */
const KEYS: { readonly [K in keyof LightSettings]: string } = {
  gainMax: "gain",
  gainFromDeg: "from",
  gainFullDeg: "full",
  buildingSkyLight: "sky",
  exposureAdaptation: "adapt",
  exposureEv: "ev",
  hazeVisibilityKm: "vis",
  hazeStartRatio: "haze",
  hazeVeilLightness: "veil",
  hazeVeilTint: "tint",
};
const FIELDS = Object.keys(KEYS) as (keyof LightSettings)[];

const LIGHT_PARAM = "light";
/** The URL format's version prefix; an unknown version is ignored. */
const VERSION = "v1:";

/** Rounds to the precision a slider can produce, so a round trip is exact. */
const round = (v: number) => Number(v.toFixed(3));

/**
 * The settings in a URL's search string: `?light=v1:key=value,…`. Never
 * throws: a missing, unknown, non-numeric or out-of-range field falls back
 * to its default, a ramp that does not rise falls back to the default ramp,
 * and another version or no version is ignored (a shared link with a typo
 * still opens the page).
 */
export function parseLightSettings(search: string): LightSettings {
  const raw = new URLSearchParams(search).get(LIGHT_PARAM);
  if (raw === null || !raw.startsWith(VERSION)) return DEFAULT_LIGHT_SETTINGS;
  const pairs = new Map(
    raw
      .slice(VERSION.length)
      .split(",")
      .map((pair) => {
        const eq = pair.indexOf("=");
        return [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()] as const;
      }),
  );
  const out: Record<keyof LightSettings, number> = {
    ...DEFAULT_LIGHT_SETTINGS,
  };
  FIELDS.forEach((field) => {
    const text = pairs.get(KEYS[field]) ?? "";
    const v = text === "" ? Number.NaN : Number(text);
    const r = LIGHT_SETTING_RANGES[field];
    if (Number.isFinite(v) && v >= r.min && v <= r.max) out[field] = round(v);
  });
  if (!(out.gainFullDeg > out.gainFromDeg)) {
    out.gainFromDeg = DEFAULT_LIGHT_SETTINGS.gainFromDeg;
    out.gainFullDeg = DEFAULT_LIGHT_SETTINGS.gainFullDeg;
  }
  return out;
}

/**
 * The `?light=` value (only the fields that differ from the defaults), or
 * null when the settings are the defaults.
 */
export function serializeLightSettings(s: LightSettings): string | null {
  const changed = FIELDS.filter(
    (f) => round(s[f]) !== round(DEFAULT_LIGHT_SETTINGS[f]),
  );
  if (changed.length === 0) return null;
  return VERSION + changed.map((f) => `${KEYS[f]}=${round(s[f])}`).join(",");
}

/** The one-line summary the Copy button puts on the clipboard. */
export function describeLightSettings(s: LightSettings): string {
  return (
    `light: gain ${round(s.gainMax)} (${round(s.gainFromDeg)}° to ${round(s.gainFullDeg)}°), ` +
    `sky light ${round(s.buildingSkyLight)}, adaptation ${round(s.exposureAdaptation)}, ` +
    `EV ${round(s.exposureEv)}, ` +
    `haze ${round(s.hazeVisibilityKm)} km from ${round(s.hazeStartRatio)} of the draw distance` +
    (s.hazeVeilLightness > 0
      ? `, veil L* ${round(s.hazeVeilLightness)} b* ${round(s.hazeVeilTint)}`
      : "")
  );
}

/** The haze these settings describe (`AtmosphereRig.setHaze`). */
export function hazeOf(s: LightSettings): {
  readonly visibilityKm: number;
  readonly startRatio: number;
} {
  return { visibilityKm: s.hazeVisibilityKm, startRatio: s.hazeStartRatio };
}

/** The haze veil these settings describe, or null for the sky's colour. */
export function veilOf(s: LightSettings): HazeVeil | null {
  return s.hazeVeilLightness > 0
    ? { lightness: s.hazeVeilLightness, tint: s.hazeVeilTint }
    : null;
}

/** The surface gain ramp these settings describe (`surfaceGainAt`). */
export function gainOf(s: LightSettings): SurfaceGainRamp {
  return { max: s.gainMax, fromDeg: s.gainFromDeg, fullDeg: s.gainFullDeg };
}
