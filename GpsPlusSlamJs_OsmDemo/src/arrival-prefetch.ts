/**
 * Warms OsmDemo's caches for a target while the globe flies there (round-5
 * plan 2026-10-01-0945 §3.6 step 1, DEC-GL5-8): at "pin", start this; when
 * the flight hands over to OsmDemo by URL, OsmDemo opens on a warm cache
 * instead of waiting 15-90 s for a cold Overpass tile.
 *
 * WHAT IT FETCHES: exactly `arrivalPlanFor(target)` - the Overpass tiles of
 * OsmDemo's default rings and the DEM tiles of its arrival terrain window -
 * through OsmDemo's own fetch-only paths: `createOsmTileSource` (the
 * `CachingSource` the worker fetches through) and the library's
 * `createCachingTileFetch` (the DEM provider's cache), into the store the
 * worker reads (`openPersistentOsmStore`). No mesh, no index, no parse
 * beyond what the cache itself stores.
 *
 * WHAT NEVER REACHES THE CALLER: an invalid target, a missing store, a
 * failing listing, a dead network, an HTTP error, a cancel. `finished`
 * always resolves; nothing throws out of `startArrivalPrefetch`.
 *
 * WHY NO MEMORY FALLBACK: a prefetch into memory dies with the page at the
 * hand-over, so it would cost the donated Overpass infrastructure ~21 MB a
 * tile for nothing. Without OPFS it declines (`no-persistent-store`) and
 * reads as done, so the flight does not wait for it.
 *
 * WHY NOT SPECULATIVE, AND ONE TILE AT A TIME: the globe's flight is paced
 * on this (the user is waiting, as for OsmDemo's own foreground fetch it
 * replaces), so the Overpass source may race a cold tile at two operators.
 * Like `DemoPipeline` (`FETCH_CONCURRENCY` 1), the tiles go one at a time
 * in plan order: the source's two slots race the tile under the target
 * first, and only one 21 MB tile is ever parsed in memory at once.
 *
 * WHY A WRITE PROBE: the OPFS store swallows a failed write by design (a
 * storage problem must not fail a fetch), so a store that exists but cannot
 * keep anything (quota, a revoked handle) would let the prefetch pull every
 * tile for nothing. A tiny put, get and delete first; if the value does not
 * come back, it declines (`store-unwritable`). A write that fails later is
 * counted (`writeFailures`) and its job reads as failed, not warmed.
 *
 * LAB-LOADABLE: the globe lab imports this as `/osm/arrival-prefetch.js`
 * (served TypeScript); see the sidecar for its import map.
 *
 * @see arrival-prefetch.ts.md
 */

import {
  createCachingTileFetch,
  type LatLng,
  type OsmBlobStore,
  type OsmTileTimings,
} from "gps-plus-slam-osm";

import { arrivalPlanFor, type ArrivalPlan } from "./arrival-plan.js";
import { arrivalProgress, type ArrivalCounts } from "./arrival-progress.js";
import { PRIMARY_DEM_TIMEOUT_MS } from "./dem-provider.js";
import { createOsmTileSource } from "./osm-tile-cache.js";
import { openPersistentOsmStore } from "gps-plus-slam-app-framework/osm-bridge";

/** The write probe's key: namespaced apart from `osm/`, `rules/` and URLs. */
const PROBE_KEY = "arrival-prefetch/probe";

export interface ArrivalPrefetchOptions {
  /**
   * The cache to warm. Default: OsmDemo's OPFS store. `null`: there is no
   * persistent store (the prefetch declines).
   */
  readonly store?: OsmBlobStore | null;
  /** The network, for both Overpass and DEM. Default: the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Aborts the prefetch, like {@link ArrivalPrefetch.abort}. */
  readonly signal?: AbortSignal;
}

/**
 * How it ended. `settled`: every job ended (the counts say how many warmed);
 * `aborted`: cancelled; `no-persistent-store`: nothing worth warming;
 * `store-unwritable`: the store did not keep a probe value;
 * `invalid-target`: the target was not a latitude and longitude.
 */
export type ArrivalPrefetchOutcome =
  | "settled"
  | "aborted"
  | "no-persistent-store"
  | "store-unwritable"
  | "invalid-target";

export interface ArrivalPrefetchReport {
  readonly outcome: ArrivalPrefetchOutcome;
  readonly counts: ArrivalCounts;
  /** Characters written to the store (ASCII JSON and base64: bytes). */
  readonly bytesStored: number;
  /** Writes the store failed (thrown, or counted in its `stats.errors`). */
  readonly writeFailures: number;
  readonly elapsedMs: number;
  /**
   * The Overpass source's own timings per fetched tile. `decodeMs` (the
   * JSON parse), `parseMs` (features) and `storeMs` (serialise and write)
   * run on the calling thread: on the globe page they are the main-thread
   * cost of the prefetch, the number a phone measurement reads.
   */
  readonly overpassTimings: readonly (OsmTileTimings & { tile: string })[];
}

export interface ArrivalPrefetch {
  /**
   * 0 to 1 from the real signals (`arrival-progress.ts`): 0 until the cache
   * has been looked at, 1 when every job settled. Frozen by an abort.
   */
  progress(): number;
  /** True once it settled, declined or was aborted. */
  readonly done: boolean;
  /** Resolves once, never rejects. */
  readonly finished: Promise<ArrivalPrefetchReport>;
  /** Cancels every request; `finished` resolves `aborted` at once. */
  abort(): void;
  /** The live counters, for a status line or a measurement. */
  stats(): {
    readonly counts: ArrivalCounts;
    readonly inFlight: number;
    readonly bytesStored: number;
  };
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Mutable job counts. */
interface Tally {
  total: number;
  warm: number;
  fetched: number;
  failed: number;
}

const tally = (total: number): Tally => ({
  total,
  warm: 0,
  fetched: 0,
  failed: 0,
});

/** The store's own error counter, when it keeps one (`OpfsOsmBlobStore`). */
function storeErrors(store: OsmBlobStore): number {
  const stats = (store as { stats?: { errors?: unknown } }).stats;
  return typeof stats?.errors === "number" ? stats.errors : 0;
}

/** Whether the store keeps a value: put, read back, delete. Never throws. */
async function storeKeepsWrites(store: OsmBlobStore): Promise<boolean> {
  const value = `probe-${Date.now()}`;
  try {
    await store.put(PROBE_KEY, value);
    const back = await store.get(PROBE_KEY);
    await store.delete(PROBE_KEY);
    return back === value;
  } catch {
    return false;
  }
}

/**
 * Starts warming OsmDemo's caches for `target`. Never throws; see the
 * module header for what it fetches and what it never does.
 */
export function startArrivalPrefetch(
  target: LatLng,
  options: ArrivalPrefetchOptions = {},
): ArrivalPrefetch {
  const startedAt = now();
  const controller = new AbortController();
  const counts = { overpass: tally(0), dem: tally(0) };
  let looked = false;
  let inFlight = 0;
  let bytesStored = 0;
  let writeFailures = 0;
  const overpassTimings: (OsmTileTimings & { tile: string })[] = [];
  let outcome: ArrivalPrefetchOutcome | undefined;
  let frozen = 0;
  let resolveFinished!: (report: ArrivalPrefetchReport) => void;
  const finished = new Promise<ArrivalPrefetchReport>((resolve) => {
    resolveFinished = resolve;
  });

  const snapshot = (): ArrivalCounts => ({
    overpass: { ...counts.overpass },
    dem: { ...counts.dem },
  });
  const progress = (): number => {
    if (outcome === "aborted") return frozen;
    if (outcome !== undefined) return 1;
    return looked ? arrivalProgress(snapshot()) : 0;
  };
  const finish = (result: ArrivalPrefetchOutcome): void => {
    if (outcome !== undefined) return;
    frozen = progress();
    outcome = result;
    resolveFinished({
      outcome: result,
      counts: snapshot(),
      bytesStored,
      writeFailures,
      elapsedMs: Math.max(0, now() - startedAt),
      overpassTimings: [...overpassTimings],
    });
  };
  const abort = (): void => {
    if (outcome !== undefined) return;
    finish("aborted");
    controller.abort();
  };

  const external = options.signal;
  if (external?.aborted === true) {
    abort();
  } else {
    external?.addEventListener("abort", abort, { once: true });
  }

  const run = async (): Promise<void> => {
    let plan: ArrivalPlan;
    try {
      plan = arrivalPlanFor(target);
    } catch {
      finish("invalid-target");
      return;
    }
    const found =
      options.store === undefined
        ? await openPersistentOsmStore()
        : (options.store ?? undefined);
    if (found === undefined) {
      finish("no-persistent-store");
      return;
    }
    if (outcome !== undefined) return;
    if (!(await storeKeepsWrites(found))) {
      finish("store-unwritable");
      return;
    }
    if (outcome !== undefined) return;

    // Every write is counted, so a measurement can read what was stored, and
    // a failed one (thrown, or swallowed and counted by the store) marks its
    // key so the job reads as failed rather than warmed.
    const failedKeys = new Set<string>();
    const store: OsmBlobStore = {
      get: (key) => found.get(key),
      put: async (key, value) => {
        const before = storeErrors(found);
        try {
          await found.put(key, value);
        } catch (error) {
          failedKeys.add(key);
          writeFailures += 1;
          throw error;
        }
        if (storeErrors(found) > before) {
          failedKeys.add(key);
          writeFailures += 1;
          return;
        }
        bytesStored += value.length;
      },
      delete: (key) => found.delete(key),
      keys: () => found.keys(),
    };
    const fetchOptions =
      options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl };
    const source = createOsmTileSource(store, fetchOptions);
    const tileFetch = createCachingTileFetch({ store, ...fetchOptions });

    // WARM IS A KEY THAT EXISTS: one listing, no read of a 20 MB entry.
    let keys: ReadonlySet<string>;
    try {
      keys = new Set(await found.keys());
    } catch {
      keys = new Set();
    }
    if (outcome !== undefined) return;
    const coldTiles = plan.overpassTiles.filter(
      (tile) => !keys.has(source.cacheKey(tile)),
    );
    const coldUrls = plan.demUrls.filter((url) => !keys.has(url));
    counts.overpass.total = plan.overpassTiles.length;
    counts.overpass.warm = plan.overpassTiles.length - coldTiles.length;
    counts.dem.total = plan.demUrls.length;
    counts.dem.warm = plan.demUrls.length - coldUrls.length;
    looked = true;

    const signal = controller.signal;
    const settle = (job: Tally, ok: boolean): void => {
      inFlight -= 1;
      if (outcome !== undefined) return;
      if (ok) job.fetched += 1;
      else job.failed += 1;
    };

    const overpass = (async (): Promise<void> => {
      for (const tile of coldTiles) {
        if (signal.aborted) return;
        inFlight += 1;
        try {
          const result = await source.fetchTile(tile, { signal });
          if (result.timings !== undefined) {
            overpassTimings.push({ ...result.timings, tile });
          }
          settle(counts.overpass, !failedKeys.has(source.cacheKey(tile)));
        } catch {
          settle(counts.overpass, false);
        }
      }
    })();
    const dem = Promise.all(
      coldUrls.map(async (url) => {
        inFlight += 1;
        try {
          const response = await tileFetch(url, {
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(PRIMARY_DEM_TIMEOUT_MS),
            ]),
          });
          // The caching fetch stored a clone; the body itself is not needed.
          await response.body?.cancel().catch(() => undefined);
          settle(counts.dem, response.status === 200 && !failedKeys.has(url));
        } catch {
          settle(counts.dem, false);
        }
      }),
    );
    await Promise.all([overpass, dem]);
    finish("settled");
  };

  if (outcome === undefined) {
    void run().catch(() => {
      // Defensive: `run` handles its own failures; anything left is a bug
      // that must still not reach the caller or hold the flight.
      finish("settled");
    });
  }

  return {
    progress,
    get done() {
      return outcome !== undefined;
    },
    finished,
    abort,
    stats: () => ({ counts: snapshot(), inFlight, bytesStored }),
  };
}
