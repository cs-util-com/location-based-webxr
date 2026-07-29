/**
 * Which contributing element to show first.
 *
 * THE BUG THIS REPLACES. The provenance list sorted contributors descending by
 * factor and cut at eight. A hard veto has factor `0`, so it sorted **last** and
 * was the first entry dropped — meaning "why is this cell zero?", the question
 * the provenance map exists to answer, was the one question the list was worst
 * at. On a cemetery tile next to the cathedral, the `landuse=cemetery` rule that
 * zeroed everything was exactly the row that fell off the end.
 *
 * WHY NOT "DISTANCE FROM 1". It is the obvious repair and it fails the same case
 * more quietly: a veto scores `|0 - 1| = 1`, so one `5x` contributor outranks it
 * and the veto is dropped again — this time by a rule that looks principled.
 *
 * WHY `|log(factor)|`. The model is multiplicative, so the size of a claim is
 * its RATIO to the identity, not its distance from it. `log` turns that ratio
 * into a magnitude: `0` goes to infinity and always leads; `0.5` and `2` rank
 * equally, because halving and doubling are the same size of statement; and `1`
 * goes to zero and sinks to the bottom without being removed. It is also the
 * same transform `heat-colours.ts` already applies to the same numbers, so the
 * list and the map agree about what "a big contribution" means.
 *
 * @see contributor-order.ts.md
 */

/** One contributing element, with the magnitude that ordered it. */
export interface RankedContributor {
  /** The provenance key, `type/id` — what `debugUrlForKey` takes. */
  readonly key: string;
  /** The factor this element contributed to the cell's product. */
  readonly factor: number;
  /** `|log(factor)|`; `Infinity` for a veto, `-1` for a nonsensical factor. */
  readonly rank: number;
}

/**
 * How interesting a factor is, as a magnitude.
 *
 * A negative multiplier is nonsense the rule sheet can nevertheless contain, and
 * `Math.log` of a negative is `NaN`. A `NaN` from a comparator is not a local
 * problem: it makes `Array.sort` produce an arbitrary order for the WHOLE list,
 * so one bad sheet row would scramble every other element's position rather than
 * just its own. `-1` sorts it last and keeps the rest correct.
 */
function magnitudeOf(factor: number): number {
  if (factor === 0) return Number.POSITIVE_INFINITY;
  const magnitude = Math.abs(Math.log(factor));
  return Number.isFinite(magnitude) ? magnitude : -1;
}

/**
 * Orders contributors most-interesting first.
 *
 * Returns **every** contributor. Truncation is a presentation decision and
 * belongs to the caller — and wherever a caller does truncate it has to say so,
 * because a silently shortened provenance list reads as a complete one.
 *
 * Ties break on the key so a redraw cannot reshuffle the list under the reader's
 * cursor.
 */
export function rankContributors(
  contributors: Readonly<Record<string, number>>,
): RankedContributor[] {
  return Object.entries(contributors)
    .map(([key, factor]) => ({ key, factor, rank: magnitudeOf(factor) }))
    .sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));
}
