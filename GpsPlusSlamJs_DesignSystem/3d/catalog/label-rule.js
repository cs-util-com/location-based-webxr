/**
 * Which catalog labels show, and how strongly (W5 plan 2026-09-26-0549, M1):
 * only the nearest K, each faded by its distance. Pure, so `node --test`
 * runs it; the page applies the result to its CSS2D labels every frame.
 *
 * @see label-rule.js.md
 */

/** Defaults from the research: K 8-24, fade near 10-30 m, far 40-100 m. */
export const LABEL_RULE = { k: 16, fadeNearM: 25, fadeFarM: 70 };

/**
 * The opacity of each label, in the input's order: the K nearest (ties by
 * index) get `1` up to `fadeNearM`, falling linearly to `0` at `fadeFarM`;
 * every other label gets `0`. Non-finite distances are hidden.
 *
 * @throws RangeError for a K that is not a non-negative integer, or fade
 *   distances that are not `0 <= near < far`.
 */
export function labelOpacities(distances, rule = LABEL_RULE) {
  const { k, fadeNearM, fadeFarM } = rule;
  if (!(Number.isInteger(k) && k >= 0)) {
    throw new RangeError(`k must be a non-negative integer, got ${k}`);
  }
  if (!(fadeNearM >= 0 && fadeFarM > fadeNearM)) {
    throw new RangeError(
      `fade distances must be 0 <= near < far, got ${fadeNearM}, ${fadeFarM}`,
    );
  }
  const order = distances
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => Number.isFinite(d))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, k);
  const out = new Array(distances.length).fill(0);
  for (const { d, i } of order) {
    const t = (d - fadeNearM) / (fadeFarM - fadeNearM);
    out[i] = Math.min(1, Math.max(0, 1 - t));
  }
  return out;
}
