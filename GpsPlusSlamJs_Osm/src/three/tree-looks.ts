/**
 * The CPU mix of a tree mesh's crown colours over a city's colour looks:
 * the linear colour of each look per instance, kept once at build, summed
 * by the look weights into the colour array three uploads. Shared by the
 * crown form (`city-objects.ts`) and the trunk form (`trunk-trees.ts`).
 *
 * @see tree-looks.ts.md
 */

import * as THREE from "three";

import { checkedWeightList } from "./look-colours.js";

const channel = new THREE.Color();

/**
 * Each look's sRGB 0-1 channels (`TreeInstances.lookColours`) converted to
 * three's linear working space, as `setColorAt` would store them.
 */
export function linearTreeLooks(
  looks: readonly Float32Array[] | undefined,
): Float32Array[] | undefined {
  if (looks === undefined || looks.length === 0) return undefined;
  return looks.map((look) => {
    const out = new Float32Array(look.length);
    for (let i = 0; i < look.length; i += 3) {
      channel
        .setRGB(
          look[i] ?? 1,
          look[i + 1] ?? 1,
          look[i + 2] ?? 1,
          THREE.SRGBColorSpace,
        )
        .toArray(out, i);
    }
    return out;
  });
}

/**
 * `weights` when it holds one finite weight >= 0 per look; RangeError
 * otherwise. They are the normalised look weights (no brightness trim: the
 * trim reaches buildings and roads only).
 */
export function checkedTreeLookWeights(
  weights: readonly number[],
  looks: number,
): readonly number[] {
  const list = checkedWeightList(weights, "look weights");
  if (list.length !== looks) {
    throw new RangeError(
      `the trees were baked in ${looks} looks, got ${list.length} weights`,
    );
  }
  return list;
}

/** Writes `sum(weights[k] * looks[k])` into `out`, item by item. */
export function mixTreeLooks(
  looks: readonly Float32Array[],
  weights: readonly number[],
  out: THREE.TypedArray,
): void {
  const n = Math.min(out.length, looks[0]?.length ?? 0);
  out.fill(0, 0, n);
  for (const [k, look] of looks.entries()) {
    const w = weights[k] ?? 0;
    if (w === 0) continue;
    for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + w * (look[i] ?? 0);
  }
}
