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

    // STRONGER than the `geometryReused > 1` this replaced, and deliberately
    // so. That assertion counted cache HITS, which only exist if something
    // asks repeatedly — it was really measuring that `update` walked the
    // features once per chunk. Since the working set is now scored in one
    // batch (see `scoreChunks`), the feature is consulted exactly once for the
    // whole cold working set: zero repeat lookups rather than 18 cheap ones.
    // Reuse across separate updates is still pinned by the test below.
    expect(index.stats.geometryBuilt + index.stats.geometryReused).toBe(1);
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

  it("HITS the cache when a later batch covers the same ground", () => {
    // The counterpart the two above need. Both of them assert a NON-event
    // (`geometryBuilt` not growing), and since the working set is scored in a
    // single batch, a feature is consulted exactly ONCE per cold update — so
    // deleting the cache entirely would leave both of them passing. This is
    // the positive case: a second batch over the same ground must find the
    // converted geometry already there.
    //
    // The trigger is the realistic one: a `maxAgeMs` refetch returning the
    // same data. `acceptTile` invalidates the overlapping chunks and clears
    // `lastChunk`, but leaves the unchanged feature record's geometry alone,
    // so the re-score must reuse it.
    const feature = patch(1, HOME, { landuse: "grass" });
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [feature]));

    index.update(HOME);
    expect(index.stats.geometryBuilt).toBe(1);
    expect(index.stats.geometryReused).toBe(0);

    index.acceptTile(tile(HOME, [feature], 2_000));
    index.update(HOME);

    expect(index.stats.geometryBuilt).toBe(1);
    expect(index.stats.geometryReused).toBeGreaterThan(0);
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

  it("does not invalidate everything when a KNOWN distant tile is refetched", () => {
    /**
     * WHY THIS MATTERS, and why the test above does not cover it.
     *
     * `acceptTile` invalidates a chunk when the tile overlaps it OR when the
     * chunk names the tile in `ScoredChunk.tiles` — documented as "fetch tiles
     * whose data contributed". The distance test above only ever accepts a tile
     * the index has never seen, so it exercises the overlap branch alone.
     *
     * Take the other branch and the guarantee collapses: once a tile is held,
     * EVERY chunk scored afterwards names it, so refetching it drops the whole
     * chunk cache regardless of geography. That is precisely the "prefetched a
     * route" case the overlap test exists to protect, reached from the other
     * side — and a refetch of a held tile is the normal path, since §5.2's
     * `maxAgeMs` refresh re-fetches tiles the index already has.
     */
    const index = newIndex();

    const far = { lat: 51.4, lng: 7.6 };
    index.acceptTile(tile(far, [patch(9, far, { landuse: "grass" })], 3_000));

    index.update(HOME);
    const held = index.scoredChunks().length;
    expect(held).toBeGreaterThan(0);

    // The same tile again, newer — a routine `maxAgeMs` refresh.
    const invalidated = index.acceptTile(
      tile(far, [patch(9, far, { landuse: "grass" })], 4_000),
    );

    expect(invalidated).toEqual([]);
    expect(index.scoredChunks()).toHaveLength(held);
  });

  it("records only the tiles that actually contributed to a chunk", () => {
    // The field's own docstring says "fetch tiles whose data contributed", and
    // the invalidation test above depends on that meaning being true. Storing
    // every held tile asserts a precision it does not have.
    const index = newIndex();
    const far = { lat: 51.4, lng: 7.6 };
    index.acceptTile(tile(far, [patch(9, far, { landuse: "grass" })], 3_000));
    index.update(HOME);

    const homeTile = latLngToCell(HOME.lat, HOME.lng, FETCH_RES);
    const farTile = latLngToCell(far.lat, far.lng, FETCH_RES);
    const chunks = index.scoredChunks();

    // The far tile fed nothing here, so no chunk may name it.
    expect(chunks.flatMap((c) => c.tiles).filter((t) => t === farTile)).toEqual(
      [],
    );
    // ...and every chunk that did get features must name the tile they came from.
    const fed = chunks.filter((c) => c.featureCount > 0);
    expect(fed.length).toBeGreaterThan(0);
    expect(fed.filter((c) => !c.tiles.includes(homeTile))).toEqual([]);
  });

  it("still invalidates a chunk fed by a feature that reaches beyond its tile", () => {
    /**
     * The reason `tiles` cannot simply be deleted in favour of the bbox test.
     * A single OSM way — a river, a motorway, a landuse multipolygon — can be
     * held by one tile and still cover ground far outside that tile's bbox. A
     * chunk scored from it names a tile it does not overlap, and when that tile
     * is refetched the chunk genuinely is stale.
     */
    const index = new AffordanceIndex({ table: TABLE });
    const far = { lat: 51.4, lng: 7.6 };
    // A way anchored in the far tile whose geometry stretches back to HOME.
    const sprawling: OsmFeature = {
      type: "way",
      id: 42,
      tags: { landuse: "grass" },
      geometry: [
        { lat: far.lat, lng: far.lng },
        { lat: HOME.lat - 0.0003, lng: HOME.lng - 0.0003 },
        { lat: HOME.lat + 0.0003, lng: HOME.lng + 0.0003 },
        { lat: far.lat, lng: far.lng },
      ],
    };
    index.acceptTile(tile(far, [sprawling], 1_000));
    index.update(HOME);
    const fed = index
      .scoredChunks()
      .filter((c) => c.featureCount > 0)
      .map((c) => c.chunk);
    expect(fed.length).toBeGreaterThan(0);

    const invalidated = index.acceptTile(tile(far, [sprawling], 2_000));
    for (const chunk of fed) expect(invalidated).toContain(chunk);
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

describe("a chunk's score does not depend on what was scored alongside it", () => {
  /**
   * Why this test matters: `update` scores every not-yet-held chunk of the
   * working set in ONE pass over the features, because covering a feature once
   * per chunk it touches was 84 % of the class's cost (perf loop, 2026-07-29).
   * Batching is only sound if a chunk's result is a function of the chunk
   * alone — the moment coverage, `kept`, or the contributing-tile list leaks
   * between chunks in the batch, scores start depending on the route the user
   * walked, which is both wrong and invisible.
   *
   * The two indexes below score the SAME chunks in deliberately different
   * groupings: one in a single 19-chunk batch, the other in two overlapping
   * batches, so the shared chunks are scored in a batch of a different size
   * and composition.
   */
  const spread = [
    patch(1, HOME, { landuse: "grass" }),
    patch(2, { lat: HOME.lat + 0.0012, lng: HOME.lng }, { surface: "sand" }),
    patch(3, { lat: HOME.lat, lng: HOME.lng + 0.0012 }, { landuse: "grass" }),
    patch(
      4,
      { lat: HOME.lat - 0.0012, lng: HOME.lng - 0.0012 },
      { building: "house" },
    ),
  ];

  function indexWith() {
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, spread));
    return index;
  }

  it("scores a chunk identically in a big batch and in a small one", () => {
    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const neighbour = gridDisk(home, 2).find((c) => c !== home);
    expect(neighbour).toBeDefined();

    // One batch: everything in the home working set at once.
    const oneBatch = indexWith();
    oneBatch.update(HOME);

    // Two batches: a neighbouring working set first, so the chunks the two
    // have in common are scored in a smaller, differently-composed batch.
    const twoBatches = indexWith();
    twoBatches.update(positionIn(neighbour!));
    twoBatches.update(HOME);

    const shared = oneBatch
      .scoredChunks()
      .map((c) => c.chunk)
      .filter((c) => twoBatches.chunk(c) !== undefined);
    expect(shared.length).toBeGreaterThan(5); // the comparison must be real

    for (const chunk of shared) {
      expect(twoBatches.chunk(chunk)).toStrictEqual(oneBatch.chunk(chunk));
    }
  });

  it("gives every working-set chunk a result, including empty ones", () => {
    // Batching must not quietly skip a chunk no feature reaches: a missing
    // entry and an empty entry mean different things to `acceptTile`'s
    // invalidation, which keys on the chunks it holds.
    const index = indexWith();
    const { workingSet } = index.update(HOME);

    for (const chunk of workingSet) {
      expect(index.chunk(chunk)).toBeDefined();
    }
    expect(index.scoredChunks().some((c) => c.cells.length === 0)).toBe(true);
  });

  it("keeps the contributing-tile list per chunk, not per batch", () => {
    // `tiles` drives invalidation. If the batch's union leaked into each
    // chunk, a chunk no tile actually fed would be invalidated by that tile.
    const index = indexWith();
    index.update(HOME);

    // Partitioned up front rather than branched inside the loop: a chunk fed
    // by no feature must name no tile, and a chunk fed by one must name only
    // the tile that fed it.
    const all = index.scoredChunks();
    const fed = all.filter((scored) => scored.featureCount > 0);
    const empty = all.filter((scored) => scored.featureCount === 0);
    expect(fed.length).toBeGreaterThan(0);
    expect(empty.length).toBeGreaterThan(0);

    const homeTile = latLngToCell(HOME.lat, HOME.lng, FETCH_RES);
    expect(fed.map((scored) => scored.tiles)).toEqual(
      fed.map(() => [homeTile]),
    );
    expect(empty.map((scored) => scored.tiles)).toEqual(empty.map(() => []));
  });
});
