/**
 * The haze veil as the atmosphere draws it, and its blend over colour looks:
 * a veil is a PREMULTIPLIED scene
 * colour with a strength in [0, 1], so a blend of looks sums `w_i * s_i *
 * c_i` with strength `sum(w_i * s_i)` and never divides the colour. A look
 * without a veil adds nothing, so the strength fades in from 0 rather than
 * jumping, and a blend of two veils moves continuously from one colour to
 * the other.
 *
 * WHY NOT A LERP OF THE VEIL'S LIGHTNESS. A look without a veil has no
 * lightness to lerp; treating it as 0 passes through dark veils on the way.
 *
 * @see veil-blend.ts.md
 */

import {
  veilDisplayLinear,
  veilSceneColour,
  type HazeVeil,
} from "./haze-veil.js";

type Rgb = readonly [number, number, number];

/** A veil as the atmosphere takes it. */
export interface VeilBlend {
  /** The scene-linear colour, premultiplied by `strength`. */
  readonly colour: Rgb;
  /** The display-linear colour, premultiplied likewise (the fallback's fog). */
  readonly display: Rgb;
  /** In (0, 1]: how much of the veil shows. */
  readonly strength: number;
  /** How far up the sky the veil reaches, degrees (`HazeVeil.riseDeg`). */
  readonly riseDeg: number;
}

/**
 * One look's veil at full strength, at the renderer's tone-mapping
 * `exposure` (`veilSceneColour`), or null for none. RangeError for a veil
 * `veilSceneColour` refuses.
 */
export function veilBlendOf(
  veil: HazeVeil | null,
  exposure: number,
): VeilBlend | null {
  if (veil === null) return null;
  return {
    colour: veilSceneColour(veil, exposure),
    display: veilDisplayLinear(veil),
    strength: 1,
    riseDeg: veil.riseDeg ?? 0,
  };
}

/** `sum(weights[i] * strength_i * pick(veil_i))`, channel by channel. */
function weightedSum(
  veils: readonly (VeilBlend | null)[],
  weights: readonly number[],
  pick: (veil: VeilBlend) => Rgb,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const [i, veil] of veils.entries()) {
    if (veil === null) continue;
    const w = weights[i] ?? 0;
    const rgb = pick(veil);
    for (let c = 0; c < 3; c++) out[c] = (out[c] ?? 0) + w * (rgb[c] ?? 0);
  }
  return out;
}

/**
 * The blend of each look's veil (`veils[i]`, null for a look without one)
 * by the normalised look weights (`weights[i]`, finite, >= 0, summing to
 * 1): the premultiplied colours summed by weight, the strength the summed
 * weight of the looks with a veil, and the rise their weighted mean. Null
 * when that strength is 0 (no look with a veil weighs anything): exactly
 * today's "no veil". RangeError for lists of different lengths or a weight
 * that is not finite and >= 0.
 */
export function blendVeils(
  veils: readonly (VeilBlend | null)[],
  weights: readonly number[],
): VeilBlend | null {
  if (veils.length !== weights.length) {
    throw new RangeError(
      `${veils.length} veils need as many weights, got ${weights.length}`,
    );
  }
  for (const w of weights) {
    if (!(Number.isFinite(w) && w >= 0)) {
      throw new RangeError(`look weights must be finite and >= 0, got ${w}`);
    }
  }
  let strength = 0;
  let rise = 0;
  for (const [i, veil] of veils.entries()) {
    if (veil === null) continue;
    const w = (weights[i] ?? 0) * veil.strength;
    strength += w;
    rise += w * veil.riseDeg;
  }
  if (!(strength > 0)) return null;
  return {
    // Each veil's colour is already premultiplied by its own strength.
    colour: weightedSum(veils, weights, (v) => v.colour),
    display: weightedSum(veils, weights, (v) => v.display),
    strength: Math.min(1, strength),
    riseDeg: rise / strength,
  };
}
