/**
 * The smallest and largest of a list of numbers, by a fold rather than a
 * spread.
 *
 * @see min-max.ts.md
 */

/**
 * `[min, max]` of `values`, exactly what `Math.min(...values)` and
 * `Math.max(...values)` return (NaN anywhere gives NaN, -0 is below +0, an
 * empty list gives `[Infinity, -Infinity]`), for any length: a spread passes
 * one argument per element and overflows the stack past about 100 000.
 */
export function minMaxOf(values: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}
