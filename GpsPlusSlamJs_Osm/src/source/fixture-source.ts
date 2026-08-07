/**
 * A source backed by checked-in Overpass responses.
 *
 * This is what makes the whole package testable offline and deterministically:
 * every downstream test (indexing, scoring, regions) runs against real OSM data
 * without a single network request, and CI never depends on donated
 * infrastructure being up.
 *
 * @see fixture-source.ts.md
 */

import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import { OSM_ATTRIBUTION } from "./osm-data-source.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";

/** A captured Overpass response plus the provenance needed to regenerate it. */
export interface OsmFixture {
  /** Short slug, e.g. `"cologne-park"`. */
  readonly name: string;
  /** The H3 cell the capture covers. Fixtures are res-10; production tiles are `FETCH_RES` (res 7). */
  readonly tile: string;
  /** Epoch ms at which the capture was taken. */
  readonly capturedAt: number;
  /** The raw Overpass JSON payload, exactly as returned. */
  readonly payload: unknown;
}

export interface FixtureSourceOptions {
  /**
   * What to do when a tile has no fixture.
   *
   * `'empty'` (default) returns a tile with no features, which is what a real
   * source does for genuinely unmapped ocean and keeps working-set tests simple.
   * `'throw'` is for tests that must prove a specific tile was requested.
   */
  readonly onMissing?: "empty" | "throw";
}

export class FixtureSource implements OsmDataSource {
  readonly attribution = OSM_ATTRIBUTION;
  readonly sourceId = "fixture";

  private readonly byTile: ReadonlyMap<string, OsmFixture>;
  private readonly onMissing: "empty" | "throw";

  /** Records which tiles were asked for, so tests can assert fetch policy. */
  readonly requested: string[] = [];

  constructor(
    fixtures: readonly OsmFixture[],
    options: FixtureSourceOptions = {},
  ) {
    this.byTile = new Map(fixtures.map((fixture) => [fixture.tile, fixture]));
    this.onMissing = options.onMissing ?? "empty";
  }

  fetchTile(tile: string): Promise<OsmTileResult> {
    this.requested.push(tile);

    const fixture = this.byTile.get(tile);
    if (fixture === undefined) {
      if (this.onMissing === "throw") {
        return Promise.reject(
          new Error(
            `No fixture for tile ${tile}. Known: ${[...this.byTile.keys()].join(", ")}`,
          ),
        );
      }
      return Promise.resolve({
        tile,
        features: [],
        // Epoch 0, not `Date.now()`: a fixture result must be byte-identical
        // across runs or snapshot comparisons downstream become time-dependent.
        fetchedAt: 0,
        sourceId: `${this.sourceId}:empty`,
        schemaVersion: OVERPASS_SCHEMA_VERSION,
        skipped: [],
      });
    }

    const parsed = parseOverpassJson(fixture.payload);
    return Promise.resolve({
      tile,
      features: parsed.features,
      fetchedAt: fixture.capturedAt,
      sourceId: `${this.sourceId}:${fixture.name}`,
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: parsed.skipped,
      ...(parsed.osmBaseTimestamp !== undefined
        ? { osmBaseTimestamp: parsed.osmBaseTimestamp }
        : {}),
    });
  }
}
