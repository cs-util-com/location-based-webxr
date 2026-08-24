/**
 * The obstacle index, built at most once per feature set (DEC-R11-16/19).
 *
 * WHY THIS IS ITS OWN MODULE. `buildObstacleIndex` runs `coverCells` at res-13
 * over every barrier and every building in the working set — the expensive part
 * of routing by a wide margin — and `planRouteWithIndex` exists precisely so one
 * index can serve many clicks. That makes "when do we rebuild?" a decision, and
 * a decision that lives inside `demo-worker.ts` cannot be tested: that file
 * registers a `self` message listener at import time, so a unit test cannot
 * import it to ask how many times it built anything.
 *
 * **THE KEY IS THE FEATURE SET, NOT THE MESH BUILD.** The obvious wiring is to
 * build the index inside `buildMesh`, which attaches it to `needsFullBuild` —
 * whose inputs include `terrainStamp`. Terrain does not change what blocks an
 * agent, so that would re-run a res-13 sweep for a DEM refresh. `DemoPipeline`'s
 * `loadedTileCount()` documents itself as "a faithful signature of the FEATURE
 * SET" because tiles are only ever added, never removed or replaced — so a count
 * that has not changed means features that have not changed.
 *
 * **BUILT ON DEMAND, which is DEC-R11-19's shape rather than DEC-R11-16's.** The
 * index appears on the first route request and survives until the feature set
 * moves, so a session where nobody orders a route pays nothing. Every property
 * DEC-R11-16 asked for still holds — one build per feature set, in the worker,
 * off the main thread — and the publish path is left alone. See the plan's §7.
 *
 * ONE ENTRY, NOT A MAP. Keys are monotonic (tiles only accumulate), so a
 * previous key is a key that will never be asked for again; caching more than
 * the current one would hold the whole session's features alive for nothing.
 *
 * @see obstacle-index-cache.ts.md
 */

import type { ObstacleIndex, OsmFeature } from "gps-plus-slam-osm";

export interface ObstacleIndexCache {
  /**
   * The index for `key`, building it only when `key` has moved.
   *
   * `features` is a THUNK so a cache hit does not have to materialise them. It
   * is called at most once per call, and only on a miss.
   */
  get(key: number, features: () => Iterable<OsmFeature>): ObstacleIndex;
  /**
   * How many times the index has actually been built.
   *
   * Exposed for the assertion this module exists to make possible — that two
   * route requests over one publish build it once, and that a publish which
   * moves the feature set builds it again. A counter rather than a spy, so the
   * claim survives the builder being called from somewhere new.
   */
  buildCount(): number;
  /**
   * What the last build cost, in milliseconds; `undefined` before the first.
   *
   * DEC-G7 asks for a measurement before an optimisation, and this is the only
   * place that can take one against the REAL working set rather than against a
   * corpus fixture. Reported rather than logged, so the caller decides whether
   * anybody sees it.
   */
  lastBuildMs(): number | undefined;
}

/**
 * A cache over `build`, keyed on a feature-set signature.
 *
 * `build` is injected rather than imported so the two lifetime assertions can
 * count builds without constructing a real index over real features — the cost
 * this module exists to avoid paying twice is also the cost that would make its
 * own tests slow.
 */
export function createObstacleIndexCache(
  build: (features: Iterable<OsmFeature>) => ObstacleIndex,
): ObstacleIndexCache {
  let held: { key: number; index: ObstacleIndex } | undefined;
  let builds = 0;
  let lastMs: number | undefined;

  return {
    get(key, features) {
      if (held !== undefined && held.key === key) return held.index;
      const started = performance.now();
      const index = build(features());
      lastMs = performance.now() - started;
      builds += 1;
      held = { key, index };
      return index;
    },
    buildCount: () => builds,
    lastBuildMs: () => lastMs,
  };
}
