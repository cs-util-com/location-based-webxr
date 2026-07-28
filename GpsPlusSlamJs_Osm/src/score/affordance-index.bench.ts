import { bench, describe } from "vitest";
import { latLngToCell } from "h3-js";
import { AffordanceIndex } from "./affordance-index.js";
import { scoreCells } from "./affordance-scorer.js";
import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import { cellsOfChunks } from "../spatial/chunk-cells.js";
import { scoreWorkingSet, SCORE_CHUNK_RES } from "../spatial/resolutions.js";
import { snapshotRuleTable } from "../rules/rule-table-loader.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { mergeTiles } from "../spatial/merge-tiles.js";
import { loadFixture } from "../test-utils/load-fixtures.js";
import type { OsmTileResult } from "../source/osm-data-source.js";

/**
 * Benchmark for the PRODUCTION affordance path: `AffordanceIndex.update`.
 *
 * Why this bench matters (2026-07-29 perf loop, OSM iteration 1). Profiling the
 * whole pipeline over the four captured fixtures ranked the stages
 * unambiguously, and `update` is not merely first — it is an order of magnitude
 * clear of everything else (medians of 5, devbox-win11):
 *
 * - `AffordanceIndex.update` (cold chunk) — 72 / 226 / 445 / 742 ms
 * - `buildFeatureIndex` with `restrictTo` — 23 / 52 / 53 / 114 ms
 * - `scoreCells` 0.9-4.4 ms · `parseOverpassJson` 0.2-5 ms
 * - `buildBuildings` 0-1.3 ms · `mergeTiles` ~0.1 ms
 *
 * `update` is also the one a user waits on: it is what the movement trigger
 * calls when they walk into a new res-11 chunk, and what runs on the first fix
 * after data lands. A CPU profile puts ~75 % of its self time inside h3-js, so
 * the target is the NUMBER of h3 calls, not their cost.
 *
 * The `buildFeatureIndex` case below is deliberately kept alongside as the
 * reference point rather than as a target in its own right: it covers the same
 * 931 cells as a cold `update`, in one pass, which is what makes the gap
 * between the two the measure of how much `update` repeats itself.
 */

const table = snapshotRuleTable();

/** The largest captured fixture: 242 features over a dense city block. */
function fixtureTile(slug: string): {
  tile: OsmTileResult;
  centre: { lat: number; lng: number };
} {
  const fixture = loadFixture(slug);
  const parsed = parseOverpassJson(fixture.payload);
  return {
    tile: {
      tile: fixture.tile,
      features: parsed.features,
      fetchedAt: fixture.capturedAt,
      sourceId: "bench",
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: [],
    },
    centre: fixture.centre,
  };
}

describe("AffordanceIndex.update — cold working set", () => {
  for (const slug of ["park", "street-corner", "building-block"]) {
    const { tile, centre } = fixtureTile(slug);

    // A fresh index per iteration on purpose: the cold path (nothing cached,
    // all 19 chunks of the working set scored) is the one the user waits on.
    // Re-using a warm index would measure the `chunksReused` short-circuit,
    // which is already free.
    bench(`${slug} (${tile.features.length} features)`, () => {
      const index = new AffordanceIndex({ table });
      index.acceptTile(tile);
      index.update(centre);
    });
  }
});

describe("reference: one batched pass over the same cells", () => {
  for (const slug of ["park", "street-corner", "building-block"]) {
    const { tile, centre } = fixtureTile(slug);
    const merged = mergeTiles([tile]);
    const features = [...merged.features.values()];
    const cells = cellsOfChunks(
      scoreWorkingSet(latLngToCell(centre.lat, centre.lng, SCORE_CHUNK_RES)),
    );

    // Same 931 cells, same features, same scoring — but the coverage work is
    // done once instead of once per chunk. The gap to the case above is the
    // headroom.
    bench(`${slug} (${cells.length} cells)`, () => {
      scoreCells(buildFeatureIndex(features, { restrictTo: cells }), table);
    });
  }
});
