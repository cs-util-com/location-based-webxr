/**
 * The `OsmDataSource` seam — the single most important abstraction in the
 * package, because it is what keeps the Overpass decision reversible.
 *
 * Everything downstream (caching, indexing, scoring, regions) consumes only
 * this interface. Swapping in a self-hosted Overpass instance, a PMTiles build,
 * or a pre-baked server index is therefore a configuration change rather than a
 * rewrite — which is the escape hatch the plan relies on if the public Overpass
 * quota ever becomes the binding constraint.
 *
 * @see osm-data-source.ts.md
 */

import type { OsmFeature } from "../model/osm-feature.js";
import type { SkippedElement } from "../model/overpass-parser.js";

/**
 * The result of loading one res-8 fetch tile.
 *
 * **Structured-cloneable**, like everything else that can cross a worker
 * boundary: plain objects and arrays only.
 */
export interface OsmTileResult {
  /** The res-8 H3 cell this result is for. */
  readonly tile: string;
  readonly features: readonly OsmFeature[];
  /**
   * Epoch milliseconds at which this data was retrieved from its origin.
   *
   * Provenance for the "stale-is-fine" contract: it survives caching (a cached
   * tile keeps the timestamp of its original fetch, NOT of the cache read), so
   * a consumer can show "OSM data from March 2026" or force a refresh. The
   * library never expires anything on its own — that policy is the consumer's.
   */
  readonly fetchedAt: number;
  /** e.g. `"overpass:overpass-api.de"` or `"fixture:cologne-park"`. */
  readonly sourceId: string;
  /**
   * The query schema this tile was produced under. Part of the cache key, so
   * that narrowing or widening the query never silently reuses old entries.
   */
  readonly schemaVersion: number;
  /** Elements the parser rejected, with reasons. Never silently discarded. */
  readonly skipped: readonly SkippedElement[];
  /** Overpass's `osm3s.timestamp_osm_base`, when the source supplies one. */
  readonly osmBaseTimestamp?: string;
}

export interface OsmDataSource {
  /**
   * Human-readable attribution that consumers MUST render.
   *
   * OSM data is ODbL; displaying this is a licence obligation, not a courtesy.
   * It lives on the source rather than as a module constant because a
   * self-hosted or blended source may owe different credit.
   */
  readonly attribution: string;

  /** Stable identifier for this source, recorded on every result. */
  readonly sourceId: string;

  /**
   * Fetches every OSM feature intersecting the given res-8 fetch tile.
   *
   * @param tile - a res-8 H3 cell id.
   * @param signal - aborts in-flight work when the user leaves the area.
   * @throws when the tile genuinely cannot be produced. Callers that must
   *   survive (the movement trigger) catch; callers that want to know (an
   *   explicit prefetch) propagate.
   */
  fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult>;
}

/** The attribution every OSM-derived source owes at minimum. */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
