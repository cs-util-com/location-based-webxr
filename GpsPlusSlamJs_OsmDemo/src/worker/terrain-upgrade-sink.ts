/**
 * Where the DEM race's better heights land, in the worker.
 *
 * @see terrain-upgrade-sink.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

/** Just the part of the terrain field this needs, so tests need no field. */
export interface ReplaceablePosts {
  replacePosts(
    positions: readonly LatLng[],
    heights: readonly (number | undefined)[],
  ): boolean;
}

/**
 * Wires `racingProvider`'s `onUpgrade` to the post lattice.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN `demo-worker.ts`, where it began.
 * Nothing in the demo's test suite imports the worker script — it is a
 * side-effect module that installs an `onmessage` handler — so a version of
 * these three lines that did nothing at all passed every test in the repo. That
 * was verified by mutation, not assumed: replacing the body with a no-op left
 * 16 of 16 related tests green, because each layer's own tests prove only its
 * own half. The lattice knows how to replace posts and the provider knows when
 * better heights arrived; this is the one place that knows they belong to each
 * other, and it was the only unguarded link in the chain.
 *
 * **The return value of `replacePosts` is load-bearing.** It refuses a batch
 * that would leave the window standing on two different DEMs at once, and a
 * refused upgrade must NOT be reported as a change: the page rebuilds its mesh
 * whenever the terrain stamp moves, so bumping on a refusal costs a full
 * rebuild that produces a pixel-identical result.
 */
export function createTerrainUpgradeSink(
  field: ReplaceablePosts,
  /** Called only when the lattice actually changed. Bumps the terrain stamp. */
  onChanged: () => void,
): (
  positions: readonly LatLng[],
  heights: readonly (number | undefined)[],
) => boolean {
  return (positions, heights) => {
    const applied = field.replacePosts(positions, heights);
    if (applied) onChanged();
    // RETURNED to the provider, which withholds its `servedBy` claim on a
    // refusal — an attribution committed before this verdict named a source
    // the field is not standing on (PR #332 review).
    return applied;
  };
}
