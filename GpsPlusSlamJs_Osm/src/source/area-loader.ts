/**
 * The one code path that loads tiles — for both the explicit prefetch API and
 * the movement trigger.
 *
 * The plan states that "download this area for offline use" and "the user
 * walked into a new chunk" must share a code path, and the reason is not
 * tidiness: they are the two callers most likely to ask for the same tile at
 * the same moment, and two separate implementations would each need their own
 * de-duplication, their own rate-limit handling and their own abort plumbing.
 * One of them would get it wrong.
 *
 * What differs between the two is **policy, not mechanism**, so the difference
 * is a flag rather than a fork:
 *
 * - the movement trigger tolerates a rate limit — it serves whatever is cached
 *   and queues the rest, because a phone quietly showing slightly stale data
 *   beats a phone stalling;
 * - an explicit prefetch surfaces it — "download this area" must be able to
 *   tell the user it cannot right now.
 *
 * @see area-loader.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import { RateLimitedError } from "./overpass-source.js";
import {
  FETCH_RES,
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
  toScoreChunk,
} from "../spatial/resolutions.js";
import { latLngToCell, gridDisk, getHexagonEdgeLengthAvg, UNITS } from "h3-js";

export interface LoadProgress {
  readonly done: number;
  readonly total: number;
  readonly tile: string;
}

export interface EnsureAreaOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LoadProgress) => void;
  /** Refetch a cached tile older than this. Omitted = cache-first forever. */
  readonly maxAgeMs?: number;
  /**
   * What to do when the slot budget refuses a tile.
   *
   * `"throw"` (the prefetch default) surfaces a {@link RateLimitedError} so the
   * caller can tell the user. `"skip"` (the movement-trigger default) records
   * the tile as deferred and carries on, because the cached data already on the
   * device is a better answer than a stalled UI.
   */
  readonly onRateLimit?: "throw" | "skip";
}

export interface AreaLoadResult {
  /** Tiles that are now loaded, whether from cache or the network. */
  readonly loaded: readonly OsmTileResult[];
  /**
   * Tiles a rate limit deferred.
   *
   * **Not an error and not a silent drop.** These are the tiles a caller should
   * ask for again once `budget.msUntilAvailable()` has elapsed, and the reason
   * this is returned rather than logged: a caller that cannot see what is
   * missing cannot tell "no data here" from "not fetched yet", which is the
   * ambiguity the whole package works to avoid.
   */
  readonly deferred: readonly string[];
  /** Tiles that failed for any other reason, with the cause. */
  readonly failed: readonly {
    readonly tile: string;
    readonly error: unknown;
  }[];
}

/**
 * Loads every fetch tile within `radiusMetres` of `center`.
 *
 * `LatLng`, not the framework's `GpsCoord`: this package must not depend on the
 * framework (§4.2). The two are structurally identical, so a bridge passes one
 * straight through.
 */
export function ensureAreaLoaded(
  source: OsmDataSource,
  center: LatLng,
  radiusMetres: number,
  options: EnsureAreaOptions = {},
): Promise<AreaLoadResult> {
  return loadTiles(source, tilesWithin(center, radiusMetres), {
    onRateLimit: "throw",
    ...options,
  });
}

/**
 * Loads the tiles the scoring working set needs for a user at `position`.
 *
 * The movement trigger. Derives its tiles from the chunks about to be scored
 * (§4.4) rather than from a fixed ring, so coverage is exact rather than
 * estimated: 1 tile in a fetch cell's interior, 2 near an edge, 3 near a vertex.
 *
 * COVERS THE WIDEST SCORED DISK (W4), because this API has no notion of
 * progressive passes — it is "make this area usable", not "score this ring". A
 * consumer that does score ring by ring should call
 * {@link fetchTilesForScoreWorkingSet} with its own radius instead, so the first
 * ring is not made to wait for a tile only the outer ones need.
 */
export function ensureWorkingSetLoaded(
  source: OsmDataSource,
  position: LatLng,
  options: EnsureAreaOptions = {},
): Promise<AreaLoadResult> {
  const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
  return loadTiles(source, fetchTilesForScoreWorkingSet(chunk), {
    onRateLimit: "skip",
    ...options,
  });
}

/**
 * The shared mechanism.
 *
 * Sequential on purpose. `OverpassSource` already bounds concurrency and
 * de-duplicates in flight, so racing here would add nothing but would make the
 * rate-limit path harder to reason about: the first refusal is a signal that
 * the rest will be refused too, and a sequential loop can act on it.
 */
export async function loadTiles(
  source: OsmDataSource,
  tiles: readonly string[],
  options: EnsureAreaOptions = {},
): Promise<AreaLoadResult> {
  const loaded: OsmTileResult[] = [];
  const deferred: string[] = [];
  const failed: { tile: string; error: unknown }[] = [];

  let done = 0;
  for (const tile of tiles) {
    throwIfAborted(options.signal);
    try {
      loaded.push(await fetchOne(source, tile, options));
    } catch (error) {
      if (isAbort(error)) throw error;
      if (error instanceof RateLimitedError) {
        if (options.onRateLimit === "throw") throw error;
        deferred.push(tile);
      } else {
        // One bad tile must never fail the area: a relation that cannot be
        // closed, or one instance having a bad day, should cost that tile and
        // nothing else.
        failed.push({ tile, error });
      }
    }
    options.onProgress?.({ done: ++done, total: tiles.length, tile });
  }

  // Checked again after the loop, not only before each iteration. An abort
  // that lands during the LAST tile would otherwise resolve normally, so
  // whether an aborted load rejects would depend on how many tiles it happened
  // to have — and a caller aborting means "discard this work", not "keep it if
  // you were nearly done".
  throwIfAborted(options.signal);

  return { loaded, deferred, failed };
}

/** Routes through `ensureTile` when the source supports staleness policy. */
function fetchOne(
  source: OsmDataSource,
  tile: string,
  options: EnsureAreaOptions,
): Promise<OsmTileResult> {
  const withEnsure = source as OsmDataSource & {
    ensureTile?: (
      tile: string,
      opts: { signal?: AbortSignal; maxAgeMs?: number },
    ) => Promise<OsmTileResult>;
  };
  if (typeof withEnsure.ensureTile === "function") {
    return withEnsure.ensureTile(tile, {
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
    });
  }
  return source.fetchTile(tile, options.signal);
}

/**
 * Fetch tiles whose centres lie within `radiusMetres` of `center`, plus the one
 * containing it.
 *
 * Rings are added until the ring's inner edge is beyond the radius. Deliberately
 * generous — over-fetching is the stated preference (§2.3), and a prefetch that
 * came up one tile short at the edge of a downloaded area would be discovered
 * by a user standing in a field with no signal.
 */
export function tilesWithin(
  center: LatLng,
  radiusMetres: number,
): readonly string[] {
  if (!Number.isFinite(radiusMetres) || radiusMetres < 0) {
    throw new Error(`radiusMetres must be a non-negative number`);
  }
  const centreTile = latLngToCell(center.lat, center.lng, FETCH_RES);
  // Centre-to-centre spacing of adjacent hexagons is edge * sqrt(3).
  const step = getHexagonEdgeLengthAvg(FETCH_RES, UNITS.m) * Math.sqrt(3);
  const rings = Math.ceil(radiusMetres / step);
  return gridDisk(centreTile, Math.max(0, rings));
}

/** The res-11 chunk a position scores in. Re-exported for the movement trigger. */
export function chunkFor(position: LatLng): string {
  return toScoreChunk(
    latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES),
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }
}
