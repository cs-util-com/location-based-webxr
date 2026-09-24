/**
 * The light settings the owner tunes in the light dialog (plan
 * 2026-09-24-2140-osm-demo-light-settings-dialog-plan): the noon surface
 * gain's ramp, the sky light on buildings, the sky's auto-exposure
 * adaptation and the EV compensation. The defaults ARE the shipped look, so
 * an untouched dialog changes nothing; the values travel in the URL
 * (`?light=v1:gain=1.8,ev=-2.5`, only the fields that differ) so a tuned
 * look can be shared and pasted back. This is a deliberate exception to
 * DEC-R12-5 (presentation state stays out of the URL): the owner asked for
 * it (plan 2026-09-24-2140, DEC-LIGHT-4), and the keyed, versioned form keeps
 * old links meaning what they said.
 *
 * @see light-settings.ts.md
 */

import { AUTO_EXPOSURE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-exposure";

import {
  NATURAL_LIGHT_COMPENSATION_EV,
  NOON_SURFACE_GAIN,
  type SurfaceGainRamp,
} from "./atmosphere-rig.js";

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
}

/** Today's look: the shipped constants, read from where they live. */
export const DEFAULT_LIGHT_SETTINGS: LightSettings = {
  gainMax: NOON_SURFACE_GAIN.max,
  gainFromDeg: NOON_SURFACE_GAIN.fromDeg,
  gainFullDeg: NOON_SURFACE_GAIN.fullDeg,
  buildingSkyLight: 1,
  exposureAdaptation: AUTO_EXPOSURE.adaptation,
  exposureEv: NATURAL_LIGHT_COMPENSATION_EV,
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
  buildingSkyLight: { min: 0.5, max: 3, step: 0.05 },
  exposureAdaptation: { min: 0.5, max: 1, step: 0.05 },
  exposureEv: { min: -4, max: 0, step: 0.05 },
};

/** Each field's key in the URL; never rename one (shared links use them). */
const KEYS: { readonly [K in keyof LightSettings]: string } = {
  gainMax: "gain",
  gainFromDeg: "from",
  gainFullDeg: "full",
  buildingSkyLight: "sky",
  exposureAdaptation: "adapt",
  exposureEv: "ev",
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
    `EV ${round(s.exposureEv)}`
  );
}

/** The surface gain ramp these settings describe (`surfaceGainAt`). */
export function gainOf(s: LightSettings): SurfaceGainRamp {
  return { max: s.gainMax, fromDeg: s.gainFromDeg, fullDeg: s.gainFullDeg };
}
