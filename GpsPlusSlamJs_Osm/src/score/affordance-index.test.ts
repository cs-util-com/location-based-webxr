/**
 * Lifecycle tests for `AffordanceIndex`.
 *
 * WHY THESE TESTS MATTER. Everything below this class is a pure function, and
 * pure functions are trivially correct and expensive to run continuously. This
 * class exists to make a walking user cheap, and every claim in that sentence
 * is a behaviour that can silently stop being true without any pure-function
 * test noticing:
 *
 * - a move that does not leave the current res-11 chunk must do NO work;
 * - a move to an adjacent chunk must reuse the 12 chunks that overlap;
 * - a tile arriving late must invalidate exactly the chunks it can affect,
 *   notify, and force a recompute even though the user has not moved;
 * - geometry must be converted once per feature ever, not once per chunk;
 * - published results must not be mutable behind a consumer's back.
 *
 * Every assertion here is a COUNT or an identity, never a wall clock — a timing
 * assertion inside a parallel suite measures the machine, which this repo has
 * already learned the expensive way.
 */

import { describe, expect, it, vi } from "vitest";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseRuleTable } from "../rules/rule-table.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import {
  FETCH_RES,
  SCORE_CHUNK_RES,
  toFetchTile,
} from "../spatial/resolutions.js";

const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable,battleArea",
    "landuse_grass,landuse,grass,9,10",
    "surface_sand,surface,sand,5,5",
    "building_house,building,house,0,0",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const HOME = { lat: 50.9413, lng: 6.9583 };

/** A small square area feature centred on a position. */
function patch(
  id: number,
  at: { lat: number; lng: number },
  tags: Record<string, string>,
): OsmFeature {
  const d = 0.00025;
  return {
    type: "way",
    id,
    geometry: [
      { lat: at.lat - d, lng: at.lng - d },
      { lat: at.lat - d, lng: at.lng + d },
      { lat: at.lat + d, lng: at.lng + d },
      { lat: at.lat + d, lng: at.lng - d },
      { lat: at.lat - d, lng: at.lng - d },
    ],
    tags,
  };
}

function tile(
  at: { lat: number; lng: number },
  features: OsmFeature[],
  fetchedAt = 1_000,
): OsmTileResult {
  return {
    tile: latLngToCell(at.lat, at.lng, FETCH_RES),
    features,
    fetchedAt,
    sourceId: "test",
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    skipped: [],
  };
}

/** A position inside a given res-11 chunk. */
const positionIn = (chunk: string) => {
  const [lat, lng] = cellToLatLng(chunk);
  return { lat, lng };
};

function newIndex() {
  const index = new AffordanceIndex({ table: TABLE });
  index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
  return index;
}

describe("the move short-circuit", () => {
  it("does no work when the user has not left the res-11 chunk", () => {
    const index = newIndex();
    const first = index.update(HOME);
    expect(first.scored.length).toBeGreaterThan(0);

    // A metre away is the same chunk (res-11 edge is 28.7 m).
    const nudged = { lat: HOME.lat + 0.000005, lng: HOME.lng };
    expect(latLngToCell(nudged.lat, nudged.lng, SCORE_CHUNK_RES)).toBe(
      latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES),
    );

    const before = index.stats.chunksScored;
    const second = index.update(nudged);

    // THE POINT: this is the reference's `oldUserTile` guard, and it is what
    // makes calling update() on every GPS fix acceptable rather than reckless.
    expect(second.scored).toEqual([]);
    expect(index.stats.chunksScored).toBe(before);
    expect(index.stats.movesIgnored).toBe(1);
  });

  it("reuses the overlapping chunks when the user steps to a neighbour", () => {
    const index = newIndex();
    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    index.update(HOME);
    const afterFirst = index.stats.chunksScored;

    const neighbour = gridDisk(home, 1).find((c) => c !== home);
    const result = index.update(positionIn(neighbour as string));

    // The two 19-chunk working sets overlap heavily, so most of the second one
    // must come from cache. Without the chunk cache this number would be 19.
    expect(result.reused.length).toBeGreaterThan(result.scored.length);
    expect(index.stats.chunksScored).toBe(afterFirst + result.scored.length);
  });
});

describe("geometry is converted once per feature, ever", () => {
  it("does not re-convert a feature for each chunk that reaches it", () => {
    const index = newIndex();
    index.update(HOME);

    // One feature was supplied, so geometry conversion must have happened
    // exactly once no matter how many of the 19 chunks its bbox touches. This
    // is `OsmGeoSpatialIndexer`'s geometryLookup/envelopeLookup pair, which is
    // the reference's single best performance idea.
    expect(index.stats.geometryBuilt).toBe(1);
    expect(index.stats.geometryReused).toBeGreaterThan(1);
  });

  it("keeps converted geometry across a move", () => {
    const index = newIndex();
    index.update(HOME);
    const built = index.stats.geometryBuilt;

    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const neighbour = gridDisk(home, 2).find((c) => c !== home) as string;
    index.update(positionIn(neighbour));

    expect(index.stats.geometryBuilt).toBe(built);
  });
});

describe("a tile arriving late", () => {
  it("invalidates the chunks it overlaps and notifies", () => {
    const index = newIndex();
    index.update(HOME);
    const scoredBefore = index.scoredChunks().length;
    expect(scoredBefore).toBeGreaterThan(0);

    const listener = vi.fn();
    index.onChanged(listener);

    const invalidated = index.acceptTile(
      tile(HOME, [patch(2, HOME, { surface: "sand" })], 2_000),
    );

    // The seam the plan called for and nothing consumed: "serve cache now,
    // queue the fetch" means a tile can land minutes after ensureAreaLoaded
    // resolved, and stale scores must not survive it silently.
    expect(invalidated.length).toBe(scoredBefore);
    expect(listener).toHaveBeenCalledWith(invalidated);
  });

  it("forces a re-score even though the user has not moved", () => {
    const index = newIndex();
    index.update(HOME);

    index.acceptTile(tile(HOME, [patch(2, HOME, { surface: "sand" })], 2_000));

    // The short-circuit is about the USER's position; here the world changed.
    // Without clearing it, update() would return "nothing to do" and the new
    // tile would never be scored — the exact silent staleness this guards.
    const result = index.update(HOME);
    expect(result.scored.length).toBeGreaterThan(0);
  });

  it("does not invalidate chunks a distant tile cannot affect", () => {
    const index = newIndex();
    index.update(HOME);
    const held = index.scoredChunks().length;

    // A tile 70 km away shares no ground with anything scored. Invalidating on
    // "a tile arrived" rather than "a tile arrived HERE" would throw away the
    // whole cache every time the user prefetched a route.
    const far = { lat: 51.4, lng: 7.6 };
    const invalidated = index.acceptTile(
      tile(far, [patch(9, far, { landuse: "grass" })], 3_000),
    );

    expect(invalidated).toEqual([]);
    expect(index.scoredChunks()).toHaveLength(held);
  });

  it("never converts geometry for a feature no chunk reaches", () => {
    const index = newIndex();
    index.update(HOME);
    const built = index.stats.geometryBuilt;

    // The two-stage funnel: a cheap raw-position bbox test runs for every
    // feature, and only survivors are ring-stitched and classified. At res 7 a
    // fetch tile holds ~21,800 features and a chunk needs a handful, so
    // converting all of them would be the cost this class exists to avoid.
    const far = { lat: 51.4, lng: 7.6 };
    index.acceptTile(tile(far, [patch(9, far, { landuse: "grass" })], 3_000));

    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    index.update(positionIn(gridDisk(home, 1)[1] as string));

    expect(index.stats.geometryBuilt).toBe(built);
  });

  it("re-scores to a DIFFERENT value when the late tile adds a feature", () => {
    const index = newIndex();
    index.update(HOME);
    const chunk = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const cellId = index.chunk(chunk)?.cells[0]?.cell as string;
    const before = index.chunk(chunk)?.cells.find((c) => c.cell === cellId);
    expect(before?.scores["walkable"]).toBe(9);

    // The same tile refetched, now carrying both features. `area=yes` makes the
    // second one an AREA rather than a closed line — without it the way is a
    // linestring and covers only its own outline, so the interior cell this
    // test reads would legitimately never see it. (That is what the first run
    // of this test proved, and it is a property of `polygonFeatures`, not a
    // bug: `surface` is not an area-implying key.)
    index.acceptTile(
      tile(
        HOME,
        [
          patch(1, HOME, { landuse: "grass" }),
          patch(2, HOME, { surface: "sand", area: "yes" }),
        ],
        2_000,
      ),
    );
    index.update(HOME);

    const after = index.chunk(chunk)?.cells.find((c) => c.cell === cellId);
    // 9 × 5 — the arithmetic proves the new tile actually reached the kernel,
    // where "the chunk was invalidated" only proves it was thrown away.
    expect(after?.scores["walkable"]).toBe(45);
  });
});

describe("published results are frozen", () => {
  it("refuses an in-place edit of a scored chunk", () => {
    const index = newIndex();
    index.update(HOME);
    const chunk = index.scoredChunks()[0];

    // The reference freezes a heat tile before dispatching it into its
    // immutable store (`MakeAllTilesImmutable`) precisely because a late tile
    // re-scores while a consumer may still hold the previous result. An
    // in-place update would present as a stale UI, never as an error.
    expect(Object.isFrozen(chunk)).toBe(true);
    expect(Object.isFrozen(chunk?.cells)).toBe(true);
  });
});

describe("eviction", () => {
  it("drops chunks furthest from the user, never the working set", () => {
    const index = new AffordanceIndex({ table: TABLE, maxChunks: 20 });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));

    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    index.update(HOME);
    // Walk two chunks away, which brings in new chunks and pushes past the cap.
    const far = gridDisk(home, 2).at(-1) as string;
    const result = index.update(positionIn(far));

    expect(index.stats.chunksEvicted).toBeGreaterThan(0);
    // Whatever was evicted, everything the user currently needs is still held.
    for (const chunk of result.workingSet) {
      expect(index.chunk(chunk)).toBeDefined();
    }
  });
});

describe("queries over the held chunks", () => {
  it("reports cells above a threshold across every chunk", () => {
    const index = newIndex();
    index.update(HOME);

    const above = index.cellsAbove("walkable", 1);
    expect(above.length).toBeGreaterThan(0);

    const byCell = index.scoresByCell();
    for (const cell of above) {
      expect(byCell.get(cell)?.scores["walkable"]).toBe(9);
    }
  });

  it("knows which fetch tile a chunk needs", () => {
    // Sanity check that the class and the resolution ladder agree about which
    // tile covers the user — a mismatch here would mean acceptTile() and
    // update() are talking about different ground.
    const chunk = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    expect(toFetchTile(chunk)).toBe(
      latLngToCell(HOME.lat, HOME.lng, FETCH_RES),
    );
  });
});
