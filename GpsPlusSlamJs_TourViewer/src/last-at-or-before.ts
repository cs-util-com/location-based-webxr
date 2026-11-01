/**
 * The one binary search the read-along asks on every frame: the last
 * element of a list sorted by a key whose key is at or before a value.
 * The voice's segment at a time (`read-along.ts`), the sentence and the
 * caption word holding an offset (`long-text-sentences.ts`,
 * `caption-chunks.ts`) are all this search.
 *
 * @see last-at-or-before.ts.md
 */

/**
 * The index of the last element of `items` whose `keyOf` is `<= x`, or
 * -1 when there is none (`x` before the first key, an empty list, or `x`
 * NaN). `items` must be sorted by `keyOf`, ascending (ties allowed: the
 * last of them is found). O(log n); never throws.
 */
export function lastAtOrBefore<T>(
  items: readonly T[],
  keyOf: (item: T) => number,
  x: number,
): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = items[mid];
    if (item !== undefined && keyOf(item) <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
