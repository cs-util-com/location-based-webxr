/**
 * Area-loader tests.
 *
 * Why these tests matter:
 * This module is the only place tiles are loaded, so the two callers that used
 * to be imagined as separate — "download this area for offline use" and "the
 * user walked into a new chunk" — are proven here to share one mechanism. The
 * interesting assertions are about the ONE thing that legitimately differs
 * between them: what a rate limit means. The prefetch must be able to tell the
 * user it cannot download right now; the movement trigger must not stall a
 * walking user over it.
 *
 * The other load-bearing assertion is that a deferred tile is RETURNED rather
 * than logged. A caller that cannot see what is missing cannot distinguish
 * "nothing is mapped here" from "not fetched yet" — the ambiguity this whole
 * package works to avoid.
 *
 * @see area-loader.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { latLngToCell } from "h3-js";
import {
  ensureAreaLoaded,
  ensureWorkingSetLoaded,
  loadTiles,
  tilesWithin,
} from "./area-loader.js";
import { RateLimitedError } from "./overpass-source.js";
import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import {
  FETCH_RES,
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
} from "../spatial/resolutions.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

function result(tile: string): OsmTileResult {
  return {
    tile,
    features: [],
    fetchedAt: 1000,
    sourceId: "test",
    schemaVersion: 2,
    skipped: [],
  };
}

/** A source whose behaviour per tile is scripted by the test. */
function scriptedSource(
  behaviour: (tile: string) => Promise<OsmTileResult>,
): OsmDataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    attribution: "© OpenStreetMap contributors",
    sourceId: "scripted",
    calls,
    fetchTile(tile: string) {
      calls.push(tile);
      return behaviour(tile);
    },
  };
}

const alwaysOk = () => scriptedSource((tile) => Promise.resolve(result(tile)));

describe("both callers share one mechanism", () => {
  it("the movement trigger loads exactly the derived working-set tiles", async () => {
    const source = alwaysOk();
    await ensureWorkingSetLoaded(source, COLOGNE);

    const expected = fetchTilesForScoreWorkingSet(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
    );
    expect(source.calls.sort()).toEqual([...expected].sort());
  });

  it("a prefetch of radius 0 loads the single containing tile", async () => {
    const source = alwaysOk();
    await ensureAreaLoaded(source, COLOGNE, 0);
    expect(source.calls).toEqual([
      latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES),
    ]);
  });

  it("a wider prefetch radius loads strictly more tiles", async () => {
    const small = alwaysOk();
    const large = alwaysOk();
    await ensureAreaLoaded(small, COLOGNE, 1_000);
    await ensureAreaLoaded(large, COLOGNE, 6_000);
    expect(large.calls.length).toBeGreaterThan(small.calls.length);
    expect(new Set(large.calls)).toEqual(
      new Set([...large.calls]), // no duplicates
    );
  });
});

describe("what a rate limit means differs by caller — and only that", () => {
  const rateLimited = () =>
    scriptedSource((tile) =>
      Promise.reject(new RateLimitedError(`no slot for ${tile}`, 30_000)),
    );

  it("the movement trigger DEFERS rather than failing — a walking user must not stall", async () => {
    const source = rateLimited();
    const outcome = await ensureWorkingSetLoaded(source, COLOGNE);

    expect(outcome.loaded).toEqual([]);
    expect(outcome.deferred.length).toBeGreaterThan(0);
    expect(outcome.failed).toEqual([]);
  });

  it("an explicit prefetch SURFACES it, so the UI can say so", async () => {
    // "Download this area for offline use" silently doing nothing is the worst
    // possible outcome: the user walks into a field believing they have data.
    await expect(ensureAreaLoaded(rateLimited(), COLOGNE, 0)).rejects.toThrow(
      RateLimitedError,
    );
  });

  it("returns deferred tiles by NAME, not just a count", async () => {
    // A caller has to be able to retry exactly what was missed, and a consumer
    // has to be able to tell "unmapped" from "unfetched".
    const source = rateLimited();
    const outcome = await ensureWorkingSetLoaded(source, COLOGNE);
    expect(outcome.deferred).toEqual(source.calls);
  });

  it("keeps the tiles it DID get when only some are refused", async () => {
    // The partial case is the common one: the budget runs out mid-working-set.
    let served = 0;
    const source = scriptedSource((tile) =>
      served++ === 0
        ? Promise.resolve(result(tile))
        : Promise.reject(new RateLimitedError("no slot", 30_000)),
    );

    const outcome = await ensureWorkingSetLoaded(source, COLOGNE);
    expect(outcome.loaded).toHaveLength(1);
    expect(outcome.deferred.length).toBe(source.calls.length - 1);
  });
});

describe("one bad tile never fails the area", () => {
  it("records the failure and keeps going", async () => {
    // A relation that cannot be closed, or one instance having a bad day,
    // should cost that tile and nothing else — the alternative is that a single
    // unusual element anywhere in a 5 km² area blanks the whole working set.
    let first = true;
    const source = scriptedSource((tile) => {
      if (first) {
        first = false;
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(result(tile));
    });

    const outcome = await ensureWorkingSetLoaded(source, COLOGNE);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.loaded.length).toBe(source.calls.length - 1);
  });

  it("keeps the cause, so a failure can actually be diagnosed", async () => {
    const source = scriptedSource(() =>
      Promise.reject(new Error("upstream exploded")),
    );
    const outcome = await ensureWorkingSetLoaded(source, COLOGNE);
    expect((outcome.failed[0]!.error as Error).message).toBe(
      "upstream exploded",
    );
  });
});

describe("abort", () => {
  it("stops promptly and does NOT swallow the abort", async () => {
    // Leaving an area must stop work. An abort reported as a per-tile failure
    // would look like a data problem and would let the loop keep fetching.
    // Uses a multi-tile prefetch so the mid-loop check is what fires.
    const controller = new AbortController();
    const source = scriptedSource((tile) => {
      controller.abort();
      return Promise.resolve(result(tile));
    });

    await expect(
      ensureAreaLoaded(source, COLOGNE, 6_000, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(source.calls).toHaveLength(1);
  });

  it("rejects even when the abort lands on the very LAST tile", async () => {
    // Otherwise whether an aborted load rejects would depend on how many tiles
    // it happened to have — and a caller aborting means "discard this work",
    // not "keep it if you were nearly done".
    const controller = new AbortController();
    const source = scriptedSource((tile) => {
      controller.abort();
      return Promise.resolve(result(tile));
    });

    await expect(
      ensureAreaLoaded(source, COLOGNE, 0, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(source.calls).toHaveLength(1);
  });

  it("does not start at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = alwaysOk();

    await expect(
      ensureWorkingSetLoaded(source, COLOGNE, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(source.calls).toHaveLength(0);
  });
});

describe("progress reporting", () => {
  it("reports monotonically and ends at total", async () => {
    // The demo app's "download this area" button needs this for its in-progress
    // state (repo UI-feedback policy).
    const onProgress = vi.fn();
    const source = alwaysOk();
    await ensureAreaLoaded(source, COLOGNE, 3_000, { onProgress });

    const calls = onProgress.mock.calls.map(([p]) => p as { done: number });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map((c) => c.done)).toEqual(
      calls.map((_, i) => i + 1), // 1, 2, 3, ...
    );
    expect(onProgress.mock.lastCall![0].done).toBe(
      onProgress.mock.lastCall![0].total,
    );
  });

  it("reports deferred and failed tiles as progress too", async () => {
    // Otherwise a rate-limited download stalls its own progress bar at 20% and
    // looks hung, which is worse than reporting an honest partial result.
    const onProgress = vi.fn();
    const source = scriptedSource(() =>
      Promise.reject(new RateLimitedError("no slot", 1000)),
    );
    await ensureWorkingSetLoaded(source, COLOGNE, { onProgress });

    expect(onProgress.mock.lastCall![0].done).toBe(
      onProgress.mock.lastCall![0].total,
    );
  });
});

describe("tilesWithin", () => {
  it("always includes the tile containing the centre", () => {
    for (const radius of [0, 1, 500, 5_000]) {
      expect(tilesWithin(COLOGNE, radius)).toContain(
        latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES),
      );
    }
  });

  it("grows with radius and never shrinks", () => {
    const counts = [0, 1_000, 3_000, 9_000].map(
      (r) => tilesWithin(COLOGNE, r).length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it("rejects a negative or non-finite radius rather than fetching nothing", () => {
    // Silently loading zero tiles would present as "this area has no OSM data".
    expect(() => tilesWithin(COLOGNE, -1)).toThrow(/non-negative/);
    expect(() => tilesWithin(COLOGNE, Number.NaN)).toThrow(/non-negative/);
  });
});

describe("loadTiles is the shared primitive", () => {
  it("de-duplicates nothing itself — that is the source's job", async () => {
    // Documents the layering deliberately: OverpassSource already has an
    // in-flight map keyed by tile, and a second de-dup here would be a second
    // place to get it wrong.
    const source = alwaysOk();
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    await loadTiles(source, [tile, tile]);
    expect(source.calls).toHaveLength(2);
  });

  it("returns an empty result for an empty tile list", async () => {
    const outcome = await loadTiles(alwaysOk(), []);
    expect(outcome).toEqual({ loaded: [], deferred: [], failed: [] });
  });
});
