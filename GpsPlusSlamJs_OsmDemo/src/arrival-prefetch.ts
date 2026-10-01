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
 * WHY NOT SPECULATIVE: the globe's flight is paced on this (the user is
 * waiting, as for OsmDemo's own foreground fetch it replaces), so the
 * Overpass source may race a cold tile at two operators, as it does for
 * OsmDemo's first fetch. Two tiles at a time, as `DemoPipeline` does.
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
import {
  createOsmTileSource,
  openPersistentOsmStore,
} from "./osm-tile-cache.js";

/** Overpass tiles fetched at once: `DemoPipeline`'s pool, for its reasons. */
const OVERPASS_POOL = 2;

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
 * `invalid-target`: the target was not a latitude and longitude.
 */
export type ArrivalPrefetchOutcome =
  "settled" | "aborted" | "no-persistent-store" | "invalid-target";

export interface ArrivalPrefetchReport {
  readonly outcome: ArrivalPrefetchOutcome;
  readonly counts: ArrivalCounts;
  /** Characters written to the store (ASCII JSON and base64: bytes). */
  readonly bytesStored: number;
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

/** Runs `work` over `items`, `width` at a time, until done or aborted. */
async function pool<T>(
  items: readonly T[],
  width: number,
  signal: AbortSignal,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (!signal.aborted) {
      const item = items[next++];
      if (item === undefined) return;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: width }, lane));
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

    // Every write is counted, so a measurement can read what was stored.
    const store: OsmBlobStore = {
      get: (key) => found.get(key),
      put: async (key, value) => {
        await found.put(key, value);
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

    const overpass = pool(coldTiles, OVERPASS_POOL, signal, async (tile) => {
      inFlight += 1;
      try {
        const result = await source.fetchTile(tile, { signal });
        if (result.timings !== undefined) {
          overpassTimings.push({ ...result.timings, tile });
        }
        settle(counts.overpass, true);
      } catch {
        settle(counts.overpass, false);
      }
    });
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
          settle(counts.dem, response.status === 200);
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
