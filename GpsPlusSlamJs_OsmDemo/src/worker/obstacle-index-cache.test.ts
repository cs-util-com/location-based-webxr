/**
 * The index lifetime — both halves of it.
 *
 * WHY THESE TESTS MATTER, AND WHY THERE ARE TWO. The stage-4 plan proposed one
 * assertion: two route requests over one publish build the index **once**. That
 * assertion is passed perfectly by a cache that is built once and NEVER
 * invalidated — which then routes an agent around a wall that is no longer in
 * the working set, or straight through one that is. The mirror ("a publish that
 * moves the feature set builds it again") is what makes the first one mean
 * anything, and it is the one a naive implementation fails silently.
 *
 * The builder is a counting stub rather than the real `buildObstacleIndex`: the
 * claim under test is about WHEN the build happens, and building a real res-13
 * index here would make the test pay exactly the cost the cache exists to avoid.
 */

import { describe, expect, it } from "vitest";
import type { ObstacleIndex, OsmFeature } from "gps-plus-slam-osm";

import { createObstacleIndexCache } from "./obstacle-index-cache.js";

/** A stand-in index; nothing here reads it, only counts how often it was made. */
function stubIndex(marker: string): ObstacleIndex {
  return { obstaclesIn: () => [], cells: new Set([marker]) };
}

function countingCache() {
  const featureCalls: number[] = [];
  let made = 0;
  const cache = createObstacleIndexCache(() => {
    made += 1;
    return stubIndex(`index-${made}`);
  });
  const features = (id: number) => () => {
    featureCalls.push(id);
    return [] as OsmFeature[];
  };
  return { cache, features, featureCalls };
}

describe("the worker's obstacle index cache", () => {
  it("builds ONCE for many requests over one publish", () => {
    // The assertion DEC-R11-16's whole reasoning rests on: `planRouteWithIndex`
    // is split out from `planRoute` so a click does not pay for a res-13 sweep,
    // and that saving is only real if the index actually survives the click.
    const { cache, features } = countingCache();

    const first = cache.get(7, features(7));
    const second = cache.get(7, features(7));
    const third = cache.get(7, features(7));

    expect(cache.buildCount()).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("builds AGAIN when the feature set moves", () => {
    // THE MIRROR, and the one that makes the test above worth having. Without
    // it, "never invalidates" scores full marks — and a stale index is not a
    // performance bug, it is an agent walking through a wall the user can see,
    // or refusing to cross open ground where a wall used to be.
    const { cache, features } = countingCache();

    const atSeven = cache.get(7, features(7));
    const atEight = cache.get(8, features(8));

    expect(cache.buildCount()).toBe(2);
    expect(atEight).not.toBe(atSeven);
  });

  it("does not materialise the features on a hit", () => {
    // The thunk is not decoration. `pipeline.features()` reaches through the
    // affordance index for the merged map, and a cache that asked for it on
    // every request would put that work back on the click it exists to keep
    // cheap.
    const { cache, features, featureCalls } = countingCache();

    cache.get(1, features(1));
    cache.get(1, features(1));
    cache.get(1, features(1));

    expect(featureCalls).toStrictEqual([1]);
  });

  it("holds ONE entry, so returning to an older key rebuilds", () => {
    // Pinned as the deliberate trade rather than left to be discovered. Keys are
    // monotonic in production — `loadedTileCount` only ever grows — so an older
    // key is one that will not be asked for again, and keeping it would hold a
    // whole superseded feature set alive. A test that asserted LRU behaviour
    // here would be asserting a promise this module does not make.
    const { cache, features } = countingCache();

    cache.get(1, features(1));
    cache.get(2, features(2));
    cache.get(1, features(1));

    expect(cache.buildCount()).toBe(3);
  });

  it("reports what the last build cost, and nothing before the first", () => {
    // DEC-G7 wants the publish-path cost measured rather than guessed, and this
    // is the only place that can see it against the real working set. Asserting
    // the SHAPE (undefined until built, a finite number after) rather than a
    // duration, because a timing threshold in a unit test is a flake.
    const { cache, features } = countingCache();

    expect(cache.lastBuildMs()).toBeUndefined();
    cache.get(1, features(1));
    const measured = cache.lastBuildMs();
    expect(measured).toBeTypeOf("number");
    expect(Number.isFinite(measured)).toBe(true);
  });
});
