/**
 * The package's one median.
 *
 * There were two: `elevation/elevation-provider.ts` exported this body, and
 * `regions/region-builder.ts` had a private copy under the same name. Both
 * averaged the two middles for even-length input, so they never disagreed —
 * but nothing held them to that, and the unqualified name `median` says
 * nothing about which of the two middles it returns. That is precisely the
 * silent-drift shape the workspace paid to remove from the framework in
 * 2026-07 (see `GpsPlusSlamJs_AppFramework/src/utils/median.ts`, which
 * replaced six copies carrying two different rules).
 *
 * This package deliberately does NOT depend on the framework, so per the
 * helper-unification rule (DEC-H3) it keeps its own copy — ONE of them,
 * which `tests/repo-config/duplicate-helpers.test.js` now enforces.
 */

/**
 * Interpolating median: the mean of the two middle values for even-length
 * input, so the result may be a value that was never observed. That is the
 * right rule for the continuous quantities this package medians (DEM
 * elevations, affordance scores) and the wrong one for picking a
 * representative real sample.
 *
 * `undefined` for empty input rather than a numeric sentinel: callers with a
 * domain default state it themselves (`median(scores) ?? 1`), where it is
 * visible, instead of burying it in an arithmetic helper.
 */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (low === undefined || high === undefined) return undefined;
  return (low + high) / 2;
}
