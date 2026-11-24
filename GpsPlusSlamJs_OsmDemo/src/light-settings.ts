/**
 * The light settings the owner tunes in the light dialog (plan
 * 2026-09-24-2140-osm-demo-light-settings-dialog-plan): the noon surface
 * gain's ramp, the sky light on buildings, the sky's auto-exposure
 * adaptation, the EV compensation, the haze's visibility and start
 * (`HAZE_VISIBILITY_KM`, `HAZE_START_RATIO`), and the haze veil's lightness,
 * tint and rise up the sky (`veil`, `tint`, `rise`; `haze-veil.ts`), and the
 * sky balance's cast (`skya`, `skyb`; `sky-balance.ts`). The
 * defaults ARE the shipped look, so
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
import type { ColourSchemeName } from "./colour-schemes.js";
import { rgbToLab } from "osm-h3";

import {
  clampHazeVeil,
  HAZE_VEIL_RISE_DEG,
  HAZE_VEIL_TINT,
  type HazeVeil,
} from "./haze-veil.js";
import { hasSkyBalance, skyBalanceGain } from "./sky-balance.js";

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
  /** The haze veil's tint, CIE b* on screen; below 0 bluer, above yellower. */
  readonly hazeVeilTint: number;
  /** The haze veil's other tint, CIE a*; below 0 greener, above redder. */
  readonly hazeVeilTintA: number;
  /**
   * How far up the sky the veil reaches, degrees above the horizon (where
   * it has fallen to 1/e); 0 leaves the sky its own colour. Only drawn while
   * a veil is on.
   */
  readonly hazeVeilRiseDeg: number;
  /**
   * The sky balance's cast, CIE a* a mid grey takes through it
   * (`sky-balance.ts`); with `skyBalanceB` 0 and this 0, no balance.
   */
  readonly skyBalanceA: number;
  /** The sky balance's cast, CIE b*; below 0 bluer, above yellower. */
  readonly skyBalanceB: number;
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
  hazeVeilTintA: 0,
  hazeVeilRiseDeg: HAZE_VEIL_RISE_DEG,
  skyBalanceA: 0,
  skyBalanceB: 0,
};

/**
 * The light a colour scheme is tuned with, where it differs from the shipped
 * look. Urban's walls were tuned under a bright, bluish veil at EV -2, which
 * brings its far field toward the reference city's haze; the price is paler
 * far accents and a few points less near contrast, accepted for the look.
 */
const SCHEME_LIGHT: Partial<Record<ColourSchemeName, Partial<LightSettings>>> =
  {
    urban: { hazeVeilLightness: 72, exposureEv: -2 },
    // The low-sun looks (colour-scheme-looks.ts), tuned at the sun their
    // links pin: after sunset a sky balance moves the model's mauve twilight
    // toward the dusk reference's slate blue, and a warm veil carries its
    // horizon band.
    // Golden hour keeps the model's sky: a cool balance on a sunlit sky
    // turns it olive, not blue (measured); clear air carries the colour.
    golden: { exposureEv: -3, hazeVisibilityKm: 60 },
    dusk: {
      exposureEv: -1.5,
      skyBalanceA: -12,
      skyBalanceB: -8,
      hazeVeilLightness: 65,
      hazeVeilTintA: 5,
      hazeVeilTint: 22,
      hazeVeilRiseDeg: 6,
    },
    bluehour: {
      exposureEv: -1.5,
      skyBalanceA: -16,
      skyBalanceB: -12,
      hazeVeilLightness: 62,
      hazeVeilTintA: 8,
      hazeVeilTint: 24,
      hazeVeilRiseDeg: 5,
    },
  };

/**
 * The defaults a link is read against under a colour scheme: the shipped
 * look, with the scheme's own light over it. An unknown name, or a scheme
 * with no light of its own, gives `DEFAULT_LIGHT_SETTINGS` itself.
 */
export function lightDefaultsFor(scheme: string): LightSettings {
  const own = Object.hasOwn(SCHEME_LIGHT, scheme)
    ? SCHEME_LIGHT[scheme as ColourSchemeName]
    : undefined;
  return own === undefined
    ? DEFAULT_LIGHT_SETTINGS
    : { ...DEFAULT_LIGHT_SETTINGS, ...own };
}

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
  // 90 is where neutral meets the tone curve's knee (L* 89.7); a coloured
  // veil reaches less, and is held at its own bound (`clampHazeVeil`, the
  // dialog says so). 0 is "no veil".
  hazeVeilLightness: { min: 0, max: 90, step: 1 },
  // b* from a strong blue to a strong yellow, a* a milder red-green; every
  // pair can show some lightness (haze-veil.test.ts).
  hazeVeilTint: { min: -24, max: 40, step: 0.5 },
  hazeVeilTintA: { min: -10, max: 10, step: 0.5 },
  hazeVeilRiseDeg: { min: 0, max: 20, step: 0.5 },
  // A strong cast either way; every corner is a drawable gain
  // (light-settings.test.ts). The cool corner clips red to 0, which the
  // light dialog says (`#light-sky-note`).
  skyBalanceA: { min: -20, max: 20, step: 0.5 },
  skyBalanceB: { min: -30, max: 30, step: 0.5 },
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
  hazeVeilTintA: "tinta",
  hazeVeilRiseDeg: "rise",
  skyBalanceA: "skya",
  skyBalanceB: "skyb",
};

/**
 * A read-only shorthand for the veil's colour: `vcol=f2e6c8` (or the
 * 3-digit `vcol=fec`, each digit doubled as in CSS), an sRGB hex read as
 * L*, a* and b*, each snapped to its slider and held in its range. Never written; the three keys it sets are, and a
 * stated key wins over it.
 */
const HEX_KEY = "vcol";

/** A 6-digit hex from a 3- or 6-digit one, or null for anything else. */
function expandHex(hex: string): string | null {
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^[0-9a-f]{3}$/i.test(hex)) return hex.replace(/./g, "$&$&");
  return null;
}

/** A value snapped to its slider's step and held in its range. */
function snapTo(field: keyof LightSettings, v: number): number {
  const r = LIGHT_SETTING_RANGES[field];
  const k = Math.round((v - r.min) / r.step);
  // `+ 0` turns a -0 (a hex just below a* 0) into 0, as a slider reads.
  return round(Math.min(Math.max(r.min + k * r.step, r.min), r.max)) + 0;
}
const FIELDS = Object.keys(KEYS) as (keyof LightSettings)[];

const LIGHT_PARAM = "light";
/** The URL format's version prefix; an unknown version is ignored. */
const VERSION = "v1:";

/** Rounds to the precision a slider can produce, so a round trip is exact. */
const round = (v: number) => Number(v.toFixed(3));

/** A light link read: its settings, and the fields it stated. */
export interface LightLink {
  readonly settings: LightSettings;
  /**
   * The fields whose value came from the link (an accepted key, or a
   * `vcol`'s three), so a scheme switch keeps them even where a value
   * equals the scheme's default (`rebaseLightSettings`' `touched`).
   */
  readonly stated: ReadonlySet<keyof LightSettings>;
}

/**
 * The settings in a URL's search string: `?light=v1:key=value,…`. Never
 * throws: a missing, unknown, non-numeric or out-of-range field falls back
 * to its default, a ramp that does not rise falls back to the default ramp,
 * and another version or no version is ignored (a shared link with a typo
 * still opens the page). "Default" is `defaults`: the scheme's
 * (`lightDefaultsFor`), the shipped look when left out.
 */
export function parseLightSettings(
  search: string,
  defaults: LightSettings = DEFAULT_LIGHT_SETTINGS,
): LightSettings {
  return parseLightLink(search, defaults).settings;
}

/**
 * {@link parseLightSettings}, with the fields the link stated: a field that
 * fell back to its default (refused, or a crossed ramp) is not stated.
 */
export function parseLightLink(
  search: string,
  defaults: LightSettings = DEFAULT_LIGHT_SETTINGS,
): LightLink {
  const stated = new Set<keyof LightSettings>();
  const raw = new URLSearchParams(search).get(LIGHT_PARAM);
  if (raw === null || !raw.startsWith(VERSION)) {
    return { settings: defaults, stated };
  }
  const pairs = new Map(
    raw
      .slice(VERSION.length)
      .split(",")
      .map((pair) => {
        const eq = pair.indexOf("=");
        return [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()] as const;
      }),
  );
  const out: Record<keyof LightSettings, number> = { ...defaults };
  const hex = expandHex(pairs.get(HEX_KEY) ?? "");
  if (hex !== null) {
    const lab = rgbToLab(Number.parseInt(hex, 16));
    out.hazeVeilLightness = snapTo("hazeVeilLightness", lab.l);
    out.hazeVeilTintA = snapTo("hazeVeilTintA", lab.a);
    out.hazeVeilTint = snapTo("hazeVeilTint", lab.b);
    stated.add("hazeVeilLightness").add("hazeVeilTintA").add("hazeVeilTint");
  }
  FIELDS.forEach((field) => {
    const text = pairs.get(KEYS[field]) ?? "";
    const v = text === "" ? Number.NaN : Number(text);
    const r = LIGHT_SETTING_RANGES[field];
    if (Number.isFinite(v) && v >= r.min && v <= r.max) {
      out[field] = round(v);
      stated.add(field);
    }
  });
  if (!(out.gainFullDeg > out.gainFromDeg)) {
    out.gainFromDeg = defaults.gainFromDeg;
    out.gainFullDeg = defaults.gainFullDeg;
    stated.delete("gainFromDeg");
    stated.delete("gainFullDeg");
  }
  return { settings: out, stated };
}

/**
 * The `?light=` value (only the fields that differ from `defaults`, the
 * shipped look when left out), or null when the settings are the defaults.
 */
export function serializeLightSettings(
  s: LightSettings,
  defaults: LightSettings = DEFAULT_LIGHT_SETTINGS,
): string | null {
  const changed = FIELDS.filter((f) => round(s[f]) !== round(defaults[f]));
  if (changed.length === 0) return null;
  return VERSION + changed.map((f) => `${KEYS[f]}=${round(s[f])}`).join(",");
}

/**
 * The settings moved from one scheme's defaults to another's: a field still
 * at `from`'s value was never set, so it takes `to`'s; a field that differs
 * was set, and keeps its value. What a link states, it still states.
 *
 * A value alone cannot say it was set when it equals `from`'s default (a
 * veil switched off on urban, then shown under a scheme whose default is no
 * veil), so a caller that knows which fields the viewer touched passes them
 * as `touched`: those keep their value whatever it is.
 */
export function rebaseLightSettings(
  s: LightSettings,
  from: LightSettings,
  to: LightSettings,
  touched: ReadonlySet<keyof LightSettings> = new Set(),
): LightSettings {
  const out = { ...s } as Record<keyof LightSettings, number>;
  const followed = new Set<keyof LightSettings>();
  for (const f of FIELDS) {
    if (!touched.has(f) && round(s[f]) === round(from[f])) {
      out[f] = to[f];
      followed.add(f);
    }
  }
  // The ramp must rise, as the parser and the dialog keep it: a kept end
  // wins and a followed end moves; a ramp that crosses with both ends kept
  // (a setting no writer produces) falls back to `to`'s.
  if (!(out.gainFullDeg > out.gainFromDeg)) {
    if (followed.has("gainFullDeg") && !followed.has("gainFromDeg")) {
      out.gainFullDeg = out.gainFromDeg + 1;
    } else if (followed.has("gainFromDeg") && !followed.has("gainFullDeg")) {
      out.gainFromDeg = out.gainFullDeg - 1;
    } else {
      out.gainFromDeg = to.gainFromDeg;
      out.gainFullDeg = to.gainFullDeg;
    }
  }
  return out;
}

/** The one-line summary the Copy button puts on the clipboard. */
export function describeLightSettings(s: LightSettings): string {
  return (
    `light: gain ${round(s.gainMax)} (${round(s.gainFromDeg)}° to ${round(s.gainFullDeg)}°), ` +
    `sky light ${round(s.buildingSkyLight)}, adaptation ${round(s.exposureAdaptation)}, ` +
    `EV ${round(s.exposureEv)}, ` +
    `haze ${round(s.hazeVisibilityKm)} km from ${round(s.hazeStartRatio)} of the draw distance` +
    (s.hazeVeilLightness > 0 ? describeVeil(s) : "") +
    (hasSkyBalance(s.skyBalanceA, s.skyBalanceB)
      ? `, sky balance a* ${round(s.skyBalanceA)} b* ${round(s.skyBalanceB)}`
      : "")
  );
}

function describeVeil(s: LightSettings): string {
  const shown = veilOf(s)!.lightness;
  return (
    `, veil L* ${round(s.hazeVeilLightness)}` +
    (shown !== s.hazeVeilLightness ? ` (shown at ${round(shown)})` : "") +
    (s.hazeVeilTintA !== 0 ? ` a* ${round(s.hazeVeilTintA)}` : "") +
    ` b* ${round(s.hazeVeilTint)} up to ${round(s.hazeVeilRiseDeg)}° of sky`
  );
}

/** The haze these settings describe (`AtmosphereRig.setHaze`). */
export function hazeOf(s: LightSettings): {
  readonly visibilityKm: number;
  readonly startRatio: number;
} {
  return { visibilityKm: s.hazeVisibilityKm, startRatio: s.hazeStartRatio };
}

/**
 * The haze veil these settings describe, or null for the sky's colour. Its
 * lightness is held at what its colour can show (`clampHazeVeil`), so the
 * view always draws the colour named; the settings keep the stated value.
 */
export function veilOf(s: LightSettings): HazeVeil | null {
  return s.hazeVeilLightness > 0
    ? clampHazeVeil({
        lightness: s.hazeVeilLightness,
        tint: s.hazeVeilTint,
        tintA: s.hazeVeilTintA,
        riseDeg: s.hazeVeilRiseDeg,
      })
    : null;
}

/**
 * The sky balance's gain these settings describe (`skyBalanceGain`), or
 * null for none (the sky the model draws).
 */
export function skyBalanceOf(
  s: LightSettings,
): readonly [number, number, number] | null {
  return skyBalanceGain(s.skyBalanceA, s.skyBalanceB);
}

/**
 * Applies a link's settings at boot, never letting them break it: when
 * `apply` throws (a value the view refuses), it warns and applies
 * `fallback` in their place, so a partly applied setting is overwritten.
 * Returns the settings now applied. `fallback` is the scheme's defaults,
 * which the tests hold valid; an error from them is not caught.
 */
export function applyLightOrFallback(
  settings: LightSettings,
  fallback: LightSettings,
  apply: (s: LightSettings) => void,
  // eslint-disable-next-line no-console -- the one report of a refused link
  warn: (message: string) => void = console.warn,
): LightSettings {
  try {
    apply(settings);
    return settings;
  } catch (error) {
    warn(
      `light settings from the link could not be applied, using the defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
    apply(fallback);
    return fallback;
  }
}

/** The surface gain ramp these settings describe (`surfaceGainAt`). */
export function gainOf(s: LightSettings): SurfaceGainRamp {
  return { max: s.gainMax, fromDeg: s.gainFromDeg, fullDeg: s.gainFullDeg };
}
