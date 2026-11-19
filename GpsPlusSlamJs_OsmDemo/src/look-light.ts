/**
 * The light of the time-of-day blend: each look's light, mixed by the look
 * weights, as the light dialog's settings and as the atmosphere takes them.
 *
 * Under the blend the dialog's defaults are the day look's. A field the
 * viewer set (the dialog's `touched`) keeps its value in every look; every
 * other field follows each look's own light (`lightDefaultsFor`), exactly
 * as a scheme switch moves onto a scheme's light (`rebaseLightSettings`).
 * The mix is then linear per field, except where a linear mix of the
 * settings would not be a mix of what the looks show:
 * - the veil: each look's veil colour is mixed premultiplied by its weight
 *   (`blendVeils`), so a look without a veil fades it rather than shifting
 *   its hue;
 * - the sky balance: the gains are mixed, a look without one counting as
 *   no cast (1, 1, 1); the gains keep luminance 1, and so does their mix;
 * - the haze visibility: rounded to its slider's step (1 km), because a new
 *   visibility rebuilds every sky table, so a sun step inside a blend stays
 *   a sun-only step until the rounded value moves.
 *
 * Pure: no three.js objects, so it runs in node.
 *
 * @see look-light.ts.md
 */

import { TONE_MAPPING_EXPOSURE, type LightSetting } from "./atmosphere-rig.js";
import {
  hazeOf,
  LIGHT_SETTING_RANGES,
  lightDefaultsFor,
  rebaseLightSettings,
  skyBalanceOf,
  veilOf,
  type LightSettings,
} from "./light-settings.js";
import { TIME_OF_DAY_LOOKS } from "./look-choice.js";
import { blendVeils, veilBlendOf } from "./veil-blend.js";

/** The atmosphere's light for one set of light settings. */
export function rigLightOf(s: LightSettings): LightSetting {
  return {
    exposure: { ev: s.exposureEv, adaptation: s.exposureAdaptation },
    haze: hazeOf(s),
    veil: veilBlendOf(veilOf(s), TONE_MAPPING_EXPOSURE),
    skyBalance: skyBalanceOf(s),
  };
}

/**
 * Each look's light settings (one per `TIME_OF_DAY_LOOKS` entry): the
 * dialog's `current` settings moved from its `defaults` onto that look's
 * light, the `touched` fields kept.
 */
export function lookLightSettings(
  current: LightSettings,
  defaults: LightSettings,
  touched: ReadonlySet<keyof LightSettings>,
): readonly LightSettings[] {
  return TIME_OF_DAY_LOOKS.map((look) =>
    rebaseLightSettings(current, defaults, lightDefaultsFor(look), touched),
  );
}

/** The blended light: as the view holds it, and as the atmosphere takes it. */
export interface BlendedLight {
  /** Each field the weighted mean of the looks' (the gain ramp, the sky light). */
  readonly settings: LightSettings;
  readonly light: LightSetting;
}

const WEIGHT_SUM_TOLERANCE = 1e-6;

/**
 * The looks' light mixed by normalised look weights. RangeError for lists
 * of another length than `TIME_OF_DAY_LOOKS`, or weights that are not
 * finite and >= 0 or do not sum to 1, before any work.
 */
export function blendLookLight(
  perLook: readonly LightSettings[],
  weights: readonly number[],
): BlendedLight {
  const n = TIME_OF_DAY_LOOKS.length;
  if (perLook.length !== n || weights.length !== n) {
    throw new RangeError(
      `the light blend needs ${n} looks and ${n} weights, got ${perLook.length} and ${weights.length}`,
    );
  }
  if (!weights.every((w) => Number.isFinite(w) && w >= 0)) {
    throw new RangeError(
      `look weights must be finite and >= 0, got ${weights.join(", ")}`,
    );
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new RangeError(`look weights must sum to 1, got ${sum}`);
  }
  const one = weights.indexOf(1);
  // Exact at weight 1: the look's own light, without a round trip.
  if (one >= 0) {
    const settings = perLook[one]!;
    return { settings, light: rigLightOf(settings) };
  }
  const first = perLook[0]!;
  const mixed = {} as Record<keyof LightSettings, number>;
  for (const field of Object.keys(first) as (keyof LightSettings)[]) {
    mixed[field] = perLook.reduce(
      (acc, s, k) => acc + (weights[k] ?? 0) * s[field],
      0,
    );
  }
  // THE VISIBILITY ON ITS SLIDER'S STEP: it is the one field that rebuilds
  // every sky table (the rest ride the sun's re-render or a re-bake), and
  // golden hour's clearer air would send a new one with every sun step of a
  // blend touching it (31 ms against 17 on the measured phone).
  const { step } = LIGHT_SETTING_RANGES.hazeVisibilityKm;
  mixed.hazeVisibilityKm = Math.round(mixed.hazeVisibilityKm / step) * step;
  const settings: LightSettings = mixed;
  const gains = perLook.map(skyBalanceOf);
  const skyBalance = gains.every((g, k) => g === null || weights[k] === 0)
    ? null
    : ([0, 1, 2].map((c) =>
        gains.reduce((acc, g, k) => acc + (weights[k] ?? 0) * (g?.[c] ?? 1), 0),
      ) as [number, number, number]);
  return {
    settings,
    light: {
      exposure: {
        ev: settings.exposureEv,
        adaptation: settings.exposureAdaptation,
      },
      haze: hazeOf(settings),
      veil: blendVeils(
        perLook.map((s) => veilBlendOf(veilOf(s), TONE_MAPPING_EXPOSURE)),
        weights,
      ),
      skyBalance,
    },
  };
}
