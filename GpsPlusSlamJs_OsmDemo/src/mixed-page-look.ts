/**
 * The page's colours between the time-of-day looks: the ground, the slope
 * treatment, the plates and the mesh shader's trim weights for a set of
 * normalised look weights. Page only (three.js colour conversion); the
 * worker reads `look-choice.ts`, which stays free of three.
 *
 * @see mixed-page-look.ts.md
 */

import * as THREE from "three";

import { colourSchemeOf } from "./colour-schemes.js";
import type { GroundSlopeColours, LinearRgb } from "./ground-slope-colours.js";
import { TIME_OF_DAY_LOOKS } from "./look-choice.js";

/** The page's colours for a set of look weights (`mixedPageLook`). */
export interface MixedPageLook {
  /** The ground, sRGB `0xrrggbb`, mixed in linear light. */
  readonly ground: number;
  /** The slope treatment's colours (linear), mixed. */
  readonly slope: GroundSlopeColours;
  /** The landuse plates, sRGB `0xrrggbb`, mixed in linear light. */
  readonly plates: number;
  /**
   * The mesh shader's weights: each look weight times that look's
   * brightness trim (the material trim is then 1).
   */
  readonly trimWeights: readonly number[];
}

const scratch = new THREE.Color();

/** `sum(weights[k] * hex_k)` in linear light, back to sRGB hex. */
function mixHex(hexes: readonly number[], weights: readonly number[]): number {
  const sum: [number, number, number] = [0, 0, 0];
  for (const [k, hex] of hexes.entries()) {
    const w = weights[k] ?? 0;
    scratch.setHex(hex, THREE.SRGBColorSpace);
    sum[0] += w * scratch.r;
    sum[1] += w * scratch.g;
    sum[2] += w * scratch.b;
  }
  return scratch.setRGB(...sum, THREE.LinearSRGBColorSpace).getHex();
}

function mixLinear(
  colours: readonly LinearRgb[],
  weights: readonly number[],
): LinearRgb {
  const sum: [number, number, number] = [0, 0, 0];
  for (const [k, rgb] of colours.entries()) {
    const w = weights[k] ?? 0;
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + w * (rgb[c] ?? 0);
  }
  return sum;
}

/**
 * The page's colours for normalised look weights over
 * {@link TIME_OF_DAY_LOOKS}: what the ground, the slope, the plates and the
 * mesh trim show between the looks. At weight 1 on a look they are exactly
 * that look's (frame equality with its fixed build). RangeError for a
 * weight list of another length or a weight that is not finite and >= 0.
 */
export function mixedPageLook(lookWeights: readonly number[]): MixedPageLook {
  if (
    lookWeights.length !== TIME_OF_DAY_LOOKS.length ||
    !lookWeights.every((w) => Number.isFinite(w) && w >= 0)
  ) {
    throw new RangeError(
      `look weights need ${TIME_OF_DAY_LOOKS.length} finite values >= 0, got ${lookWeights.join(", ")}`,
    );
  }
  const looks = TIME_OF_DAY_LOOKS.map((name) => colourSchemeOf(name));
  const one = lookWeights.findIndex((w) => w === 1);
  // Exact at weight 1, without the round trip through linear light.
  const pick = one >= 0 ? looks[one] : undefined;
  const slope = (key: keyof GroundSlopeColours): LinearRgb =>
    mixLinear(
      looks.map((look) => look.ground.slope[key]),
      lookWeights,
    );
  return {
    ground:
      pick?.city.ground ??
      mixHex(
        looks.map((l) => l.city.ground),
        lookWeights,
      ),
    slope: pick?.ground.slope ?? {
      cool: slope("cool"),
      warm: slope("warm"),
      isoline: slope("isoline"),
      rim: slope("rim"),
    },
    plates:
      pick?.ground.plates ??
      mixHex(
        looks.map((l) => l.ground.plates),
        lookWeights,
      ),
    trimWeights: lookWeights.map((w, k) => w * (looks[k]?.brightnessTrim ?? 1)),
  };
}
