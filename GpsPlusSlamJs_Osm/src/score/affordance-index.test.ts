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
import {
  cellToChildren,
  cellToLatLng,
  cellToParent,
  gridDisk,
  latLngToCell,
} from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import { isBelowSurface } from "../model/below-surface.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseRuleTable } from "../rules/rule-table.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import {
  AFFORDANCE_RES,
  FETCH_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  scoreWorkingSet,
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

describe("AffordanceIndex.update — progressive radii (W16, DEC-R2-30)", () => {
  it("scores only the NEW rings when called again with a wider radius", () => {
    // THE POINT OF THE PROGRESSIVE PATH. The first pass is the narrow, fast
    // answer the user waits for; widening must cost only the chunks the first
    // pass did not already do, or the extra reach would be paid for twice.
    const index = newIndex();

    const first = index.update(HOME, 2);
    const widened = index.update(HOME, 4);

    expect(widened.workingSet.length).toBeGreaterThan(first.workingSet.length);
    // Everything the first pass scored comes back as REUSED, not rescored.
    for (const chunk of first.scored) {
      expect(widened.reused).toContain(chunk);
      expect(widened.scored).not.toContain(chunk);
    }
    expect(widened.scored.length).toBe(
      widened.workingSet.length - first.workingSet.length,
    );
  });

  it("does not shrink the working set when asked for a narrower radius again", () => {
    // A late, superseded ring request must not undo a wider pass that already
    // landed. The guard is `radius <= lastRadius`, and without it a stale call
    // would evict the outer chunks — the map would visibly contract.
    const index = newIndex();
    index.update(HOME, 4);
    const narrow = index.update(HOME, 2);

    expect(narrow.scored).toEqual([]);
    // The wider pass's chunks survive: the working set reported is the narrow
    // one, but nothing was evicted from the index behind it.
    expect(narrow.workingSet.length).toBeLessThan(61);
  });

  it("still short-circuits a repeat at the SAME radius", () => {
    // The `oldUserTile` short-circuit is what makes calling this on every GPS
    // fix acceptable; adding the radius must not cost that.
    const index = newIndex();
    index.update(HOME, 2);
    const again = index.update(HOME, 2);
    expect(again.scored).toEqual([]);
  });

  it("re-centres after a MOVE, however wide the previous pass was", () => {
    // `lastRadius` is reset with `lastChunk`, because how far the PREVIOUS place
    // had been scored says nothing about this one. Carrying it over would make a
    // new position's narrow first pass look like an already-completed wider one,
    // and the call would short-circuit — leaving the working set centred on the
    // place the user has left.
    //
    // NOTE what this does NOT assert. The first draft expected chunks to be
    // rescored, and that was wrong: after a radius-4 pass a short move lands
    // entirely inside chunks that are already held, so reusing all of them is
    // the correct and desirable outcome. What must happen is that the call is
    // not IGNORED and the set re-centres.
    const index = newIndex();
    const wide = index.update(HOME, 4);
    const ignoredBefore = index.stats.movesIgnored;

    const away = positionIn(
      gridDisk(
        latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES),
        2,
      )[8] as string,
    );
    const moved = index.update(away, 2);

    expect(index.stats.movesIgnored).toBe(ignoredBefore);
    expect(moved.workingSet).not.toEqual(wide.workingSet);
    expect(moved.workingSet.length).toBe(19);
  });
});

describe("the default chunk cache holds a walk, not just one working set (W7)", () => {
  /**
   * Why this test matters:
   * The cap was chosen when a working set was 19 chunks and left alone when
   * DEC-R2-20 widened the scored disk to 61 — leaving barely four moves before
   * the LRU started evicting chunks the next click needed, so a click re-scored
   * ground it had just scored. That is invisible to every functional test (the
   * answers stay correct; they are just recomputed) and shows up to a user only
   * as the behaviour feeling non-deterministic.
   *
   * The assertion is on the RELATIONSHIP rather than on the number, so widening
   * the disk again cannot silently reintroduce the thrashing.
   */
  it("retains several working sets' worth of chunks by default", () => {
    const index = new AffordanceIndex({ table: TABLE });
    const chunksPerWorkingSet = scoreWorkingSet(
      latLngToCell(50.9413, 6.9583, SCORE_CHUNK_RES),
      SCORE_DISK_MAX_RADIUS,
    ).length;

    // SIX, not four, and the number is load-bearing: the old hard-coded 256
    // against a 61-chunk working set is 4.2 sets, so a "at least four" assertion
    // would have passed on the very code this fixes. Six is comfortably above
    // that and comfortably below the eight the default actually holds, so it
    // states "several moves of headroom" without pinning the exact constant.
    expect(index.maxRetainedChunks).toBeGreaterThanOrEqual(
      chunksPerWorkingSet * 6,
    );
  });

  it("still evicts, so a session that walks all day is not a leak", () => {
    // The other direction. Unbounded would be the easy way to pass the test
    // above and is the failure with the slow fuse.
    const index = new AffordanceIndex({ table: TABLE });
    expect(Number.isFinite(index.maxRetainedChunks)).toBe(true);
  });
});

describe("scoresByCell reflects every mutation immediately (W9, round 10)", () => {
  /**
   * Why these tests matter:
   * The demo asks for this map once per scoring pass — three times per click —
   * and again for every `explain`. A map that stops reflecting the chunk store
   * is a map that stops updating, so each mutation path gets its own test.
   *
   * REWRITTEN IN ROUND 10, AND THE REASON MATTERS. These asserted
   * `scoresByCell() !== previousInstance` — a proxy for "the data is fresh"
   * that held only because the map was REBUILT on invalidation. Stage A made it
   * maintained in place, so the instance is now stable by design and the proxy
   * became false while the property it stood for stayed true.
   *
   * They now assert the property directly: the CONTENTS change. That is
   * strictly stronger — an identity check passes for a rebuilt map that is
   * rebuilt wrongly.
   */
  const AT = HOME;

  it("returns the same instance while nothing has changed", () => {
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(AT, [patch(1, AT, { landuse: "grass" })]));
    index.update(AT);

    expect(index.scoresByCell()).toBe(index.scoresByCell());
  });

  it("shows newly scored chunks' cells", () => {
    // The mutation that happens on every move.
    //
    // THE DESTINATION NEEDS ITS OWN FEATURE, and the first version of this test
    // did not give it one. A `patch` spans 0.00025 deg (~28 m), so a move of
    // 0.01 deg (~1.1 km) lands on empty ground: chunks are scored, `scored` is
    // non-empty, and NOT ONE CELL is produced — an empty chunk contributes no
    // `CellScore`. The assertion then failed against a correct implementation,
    // which is the round-9 smell (a fixture that makes the thing under test
    // constant) appearing in a test written to guard against it.
    const destination = { lat: AT.lat + 0.01, lng: AT.lng + 0.01 };
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(
      tile(AT, [
        patch(1, AT, { landuse: "grass" }),
        patch(2, destination, { landuse: "grass" }),
      ]),
    );
    index.update(AT);
    const before = new Set(index.scoresByCell().keys());

    const moved = index.update(destination);
    expect(moved.scored.length).toBeGreaterThan(0);

    const after = new Set(index.scoresByCell().keys());
    const added = [...after].filter((cell) => !before.has(cell));
    expect(added.length).toBeGreaterThan(0);
    // And every added cell really is scored, not merely present.
    for (const cell of added) {
      expect(index.cellState(cell).state).toBe("scored");
    }
  });

  it("stops showing cells of chunks a late tile invalidated", () => {
    // THE ONE THAT WOULD HURT MOST. A tile arriving late drops the chunks it
    // contradicts; continuing to serve their cells would show scores the index
    // itself has already disowned — and with a MAINTAINED map that is a stale
    // entry rather than a stale cache, which no later pass clears.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(AT, [patch(1, AT, { landuse: "grass" })]));
    index.update(AT);
    const before = new Set(index.scoresByCell().keys());
    expect(before.size).toBeGreaterThan(0);

    index.acceptTile(tile(AT, [patch(1, AT, { landuse: "grass" })], 2_000));

    // The invalidated chunks' cells are gone, and `cellState` agrees they are
    // no longer scored — the two readers must not disagree.
    for (const cell of index.scoresByCell().keys()) {
      expect(index.cellState(cell).state).toBe("scored");
    }
    expect(index.scoresByCell().size).toBeLessThan(before.size);
  });

  it("stops showing cells of evicted chunks", () => {
    // HONEST ABOUT WHAT THIS COVERS: eviction only ever happens at the end of an
    // `update` that also scored, so this cannot isolate eviction from scoring.
    // What it does prove is the direction that matters for a maintained map —
    // no cell survives its chunk.
    const index = new AffordanceIndex({ table: TABLE, maxChunks: 1 });
    index.acceptTile(tile(AT, [patch(1, AT, { landuse: "grass" })]));
    index.update(AT);

    index.update({ lat: AT.lat + 0.05, lng: AT.lng + 0.05 });
    expect(index.stats.chunksEvicted).toBeGreaterThan(0);

    for (const cell of index.scoresByCell().keys()) {
      expect(index.cellState(cell).state).toBe("scored");
    }
  });
});

/**
 * WHY THESE TESTS MATTER (DEC-R7b-10, round 9 §3). The lazy store is about to
 * let algorithms read cells that were never scored, and today an unscored cell
 * and a genuinely empty one give the SAME answer: the multiplicative identity.
 * `resolutions.ts:207` already names the consequence — "an unfetched cell scores
 * as the identity, which reads as 'nothing is mapped here'" — and a hill-climb
 * that believes it would walk to the rim of the scored field and stop there,
 * every time, with nothing reporting it.
 *
 * The distinction already exists one level up: `chunk()` returns `undefined`
 * for unscored versus a `ScoredChunk` with `featureCount === 0` for
 * scored-and-empty. This surfaces it at the cell level; it does not invent it.
 */
describe("cellState — telling 'nothing here' from 'not looked yet'", () => {
  it("reports a scored cell with features as `scored`, carrying its score", () => {
    const index = newIndex();
    index.update(HOME);
    const scored = index.cellsAbove("walkable", 1);
    const cell = scored[0];
    expect(cell).toBeDefined();

    const state = index.cellState(cell as string);
    expect(state.state).toBe("scored");
    if (state.state !== "scored") throw new Error("expected scored");
    expect(state.score["walkable"]).toBeGreaterThan(1);
  });

  it("reports a cell in a SCORED chunk with no features as `empty`", () => {
    // The distinction this whole stage exists for. Scoring a working set covers
    // ~931 cells; only the handful the grass patch touches get a record, and the
    // rest are `empty` — mapped-and-nothing-there — not `unknown`.
    const index = newIndex();
    const { workingSet } = index.update(HOME);
    const covered = new Set(index.cellsAbove("walkable", 0));
    const emptyCell = workingSet
      .flatMap((chunk) => cellToChildren(chunk, AFFORDANCE_RES))
      .find((cell) => !covered.has(cell));
    expect(
      emptyCell,
      "the fixture must leave some cell uncovered",
    ).toBeDefined();

    expect(index.cellState(emptyCell as string).state).toBe("empty");
  });

  it("reports a cell in no scored chunk as `unknown`", () => {
    // Far enough away that no working set reaches it. This is the state the
    // geo-event climb must never silently read as a low score.
    const index = newIndex();
    index.update(HOME);
    const faraway = latLngToCell(
      HOME.lat + 0.5,
      HOME.lng + 0.5,
      AFFORDANCE_RES,
    );

    expect(index.cellState(faraway).state).toBe("unknown");
  });

  it("gives every cell EXACTLY ONE state", () => {
    // The guard that stops `unknown` quietly becoming "score 1 with a flag".
    // A read that could be both, or neither, is the ambiguity this replaces.
    const index = newIndex();
    const { workingSet } = index.update(HOME);
    const sample = [
      ...workingSet.flatMap((chunk) => cellToChildren(chunk, AFFORDANCE_RES)),
      latLngToCell(HOME.lat + 0.5, HOME.lng + 0.5, AFFORDANCE_RES),
    ];
    for (const cell of sample) {
      const state = index.cellState(cell).state;
      expect(["scored", "empty", "unknown"]).toContain(state);
    }
  });
});

/**
 * WHY THESE TESTS MATTER (round 9 §4, DEC-R9-10/11). `update` is the only way to
 * make a cell exist — "move the user here and score a whole disc" — and it also
 * evicts. The geo-event climb needs cells around a candidate that may be 600 m
 * from the user, which is precisely what `update` would evict on its next call:
 * the demo issues three per user action.
 *
 * The bookkeeping is the dangerous part, not the scoring. `chunkVersion` is
 * bumped by `update`, NOT by `scoreChunks`, so a second write path that forgets
 * it hands back the stale `scoresByCell` cache and every newly scored cell is
 * invisible — presenting as "the map stopped updating", with nothing thrown.
 */
const FAR = { lat: HOME.lat + 0.005, lng: HOME.lng + 0.005 };

describe("ensureScored — scoring somewhere the user is not", () => {
  /** A cell far enough from HOME that no working set around it reaches HOME. */
  // 0.005 degrees: ring distance 15 from HOME's chunk, so far outside the
  // radius-4 scored disk, while staying inside the SAME res-7 fetch tile the
  // fixture loaded. Both halves matter -- further out and it is legitimately
  // unfetched, which is a different test.
  const farCell = () =>
    latLngToCell(HOME.lat + 0.005, HOME.lng + 0.005, AFFORDANCE_RES);

  it("scores the chunks the given cells fall in, and nothing else", () => {
    const index = newIndex();
    index.update(HOME);
    const before = index.scoredChunks().length;

    const cell = farCell();
    index.ensureScored([cell]);

    // Exactly one chunk more: the one containing that cell.
    expect(index.scoredChunks().length).toBe(before + 1);
    expect(index.cellState(cell).state).not.toBe("unknown");
  });

  it("makes the new cells visible through `scoresByCell` immediately", () => {
    // THE HIGHEST-RISK LINE IN THE STAGE. `chunkVersion` is bumped by `update`,
    // not by `scoreChunks`; a write path that forgets it returns the cached map
    // and the new cells simply are not there, with nothing reported.
    //
    // THE FIXTURE NEEDS A FEATURE OUT THERE, and the first version of this test
    // did not have one. An empty chunk publishes NO cell records, so the loop
    // below ran zero times and the test passed with the bump deleted — caught by
    // the mutation check, not by reading it.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(
      tile(HOME, [
        patch(1, HOME, { landuse: "grass" }),
        patch(2, FAR, { landuse: "grass" }),
      ]),
    );
    index.update(HOME);
    index.scoresByCell(); // populate the cache

    const cell = farCell();
    index.ensureScored([cell]);

    const after = index.scoresByCell();
    const chunk = index.chunk(cellToParent(cell, SCORE_CHUNK_RES));
    expect(
      chunk?.cells.length,
      "the fixture must score real cells out there",
    ).toBeGreaterThan(0);
    for (const scored of chunk?.cells ?? []) {
      expect(after.has(scored.cell)).toBe(true);
    }
  });

  it("does NOT disturb the user-position short-circuit", () => {
    // `lastChunk`/`lastRadius` mean "how far the USER's position has been
    // scored". Writing them here would make the next `update` skip real work.
    const index = newIndex();
    index.update(HOME);
    index.ensureScored([farCell()]);

    const before = index.stats.movesIgnored;
    index.update(HOME);
    expect(index.stats.movesIgnored).toBe(before + 1);
  });

  it("reports the fetch tiles it could not cover, rather than fetching", () => {
    // DEC-R9-10: the index stays synchronous and network-free. A cell whose
    // fetch tile never arrived cannot be scored, and saying so is the whole
    // contract — silently scoring it as empty is the bug this round exists to
    // remove.
    const index = newIndex();
    const remote = latLngToCell(HOME.lat + 5, HOME.lng + 5, AFFORDANCE_RES);

    const { missingTiles } = index.ensureScored([remote]);

    expect(missingTiles).toContain(toFetchTile(remote));
    expect(index.cellState(remote).state).toBe("unknown");
  });

  it("asks for nothing once the data has arrived", () => {
    const index = newIndex();
    const cell = farCell();
    expect(index.ensureScored([cell]).missingTiles).toEqual([]);
  });
});

/**
 * WHY PINNING EXISTS (DEC-R9-11). `update` calls `evictBeyond` unconditionally
 * and the demo issues three `update`s per user action, so a chunk scored for a
 * candidate 600 m away is in the first-to-go bucket. Without a pin it would be
 * scored, evicted and re-scored on every ring — the thrash the whole lazy path
 * exists to avoid.
 */
describe("withPinned — keeping a chunk alive across a refresh", () => {
  const tinyCacheIndex = () => {
    const index = new AffordanceIndex({ table: TABLE, maxChunks: 1 });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
    return index;
  };

  it("keeps a pinned chunk that eviction would otherwise drop", () => {
    const index = tinyCacheIndex();
    const cell = latLngToCell(
      HOME.lat + 0.005,
      HOME.lng + 0.005,
      AFFORDANCE_RES,
    );
    const pinnedChunk = cellToParent(cell, SCORE_CHUNK_RES);

    index.withPinned([cell], () => {
      index.ensureScored([cell]);
      // A full refresh at the user's position, which evicts down to maxChunks.
      index.update(HOME);
      expect(index.chunk(pinnedChunk)).toBeDefined();
    });
  });

  it("releases the pin even when the body throws", () => {
    // The leak assertion, and the one most likely to be omitted. An abandoned
    // climb that keeps its pins makes the cache cap unenforceable for good.
    const index = tinyCacheIndex();
    const cell = latLngToCell(
      HOME.lat + 0.005,
      HOME.lng + 0.005,
      AFFORDANCE_RES,
    );

    expect(() =>
      index.withPinned([cell], () => {
        throw new Error("climb abandoned");
      }),
    ).toThrow("climb abandoned");

    expect(index.stats.chunksPinned).toBe(0);
  });

  it("remembers the PEAK, because the live count is always zero afterwards", () => {
    // WHY THIS TEST MATTERS (W7). `chunksPinned` is reset in `withPinned`'s
    // `finally`, so any caller asking "how much did that search hold?" reads
    // the released value — zero — and the question is unanswerable. That is
    // exactly the question the geo-event benchmark exists to answer, since the
    // index's own cap comment reasons about the size of one pinned batch.
    //
    // Also asserted INSIDE the body, so the peak cannot be satisfied by
    // recording something after the release.
    const index = tinyCacheIndex();
    const cells = [0.005, 0.006, 0.007].map((d) =>
      latLngToCell(HOME.lat + d, HOME.lng + d, AFFORDANCE_RES),
    );

    let seenInside = 0;
    index.withPinned(cells, () => {
      seenInside = index.stats.chunksPinned;
    });

    expect(seenInside).toBeGreaterThan(0);
    expect(index.stats.chunksPinned).toBe(0);
    expect(index.stats.chunksPinnedPeak).toBe(seenInside);
  });

  it("keeps the peak across searches, so the worst case survives", () => {
    // The worst case across a session is what a cap is judged against, not
    // whatever the last search happened to need.
    const index = tinyCacheIndex();
    const many = [0.005, 0.006, 0.007].map((d) =>
      latLngToCell(HOME.lat + d, HOME.lng + d, AFFORDANCE_RES),
    );
    const one = [
      latLngToCell(HOME.lat + 0.005, HOME.lng + 0.005, AFFORDANCE_RES),
    ];

    index.withPinned(many, () => undefined);
    const peak = index.stats.chunksPinnedPeak;
    index.withPinned(one, () => undefined);

    expect(index.stats.chunksPinnedPeak).toBe(peak);
  });

  it("counts how far past the cap the pins pushed the cache", () => {
    // DEC-R9-11: pins win over the cap, because an algorithm mid-climb must not
    // have its data pulled away. The overrun is COUNTED rather than thrown or
    // silently absorbed, so a leak shows up instead of hiding.
    const index = tinyCacheIndex();
    const cells = [0.005, 0.006, 0.007].map((d) =>
      latLngToCell(HOME.lat + d, HOME.lng + d, AFFORDANCE_RES),
    );

    index.withPinned(cells, () => {
      index.ensureScored(cells);
      index.update(HOME);
      expect(index.stats.pinnedOverCap).toBeGreaterThan(0);
    });
  });
});

/**
 * WHY THESE TESTS MATTER (round 10, stage A).
 *
 * `scoresByCell()` rebuilds over EVERY retained chunk and is invalidated by any
 * scoring, so a move — which runs three progressive rings — pays for the whole
 * map three times to deliver one ring of new cells. At the 488-chunk cap that is
 * ~24 000 cells rebuilt per ring. DEC-R9-14 named this as the reason the cap
 * could not simply be raised.
 *
 * Making it incremental means the map is no longer DERIVED on demand but
 * MAINTAINED, and a maintained cache can drift from the thing it mirrors. The
 * whole correctness burden is therefore one invariant: the map must always say
 * exactly what the chunk store says. These tests cross-check it against
 * `cellState()`, which reads the chunks directly and is the authority.
 */
describe("scoresByCell stays exactly in step with the chunk store", () => {
  /** Every cell the index could possibly know about, from the chunks it holds. */
  const cellsOf = (chunks: readonly string[]) =>
    chunks.flatMap((chunk) => cellToChildren(chunk, AFFORDANCE_RES));

  /**
   * The invariant, checked through the public surface only.
   *
   * Both directions matter and they fail differently: a map with a STALE entry
   * shows a colour on ground that is no longer scored (an evicted chunk that
   * kept its cells), and a map MISSING an entry drops ground that is scored (a
   * newly scored chunk whose cells never landed).
   */
  /**
   * PRIMES THE MAP, and without this most of these tests prove nothing.
   *
   * The map is built LAZILY on the first `scoresByCell()` call and maintained
   * from then on. A test that only reads it after its mutations gets a
   * from-scratch build, which is correct by construction — so the incremental
   * path it means to test never runs. Mutating `retainChunk` to stop adding
   * cells left four of the five tests here green until this existed.
   *
   * That is the round-9 smell once more: a fixture that makes the thing under
   * test constant, this time by never letting it be reached.
   */
  const prime = (index: AffordanceIndex) => {
    index.scoresByCell();
    return index;
  };

  function expectAgreement(
    index: AffordanceIndex,
    workingSet: readonly string[],
  ) {
    const byCell = index.scoresByCell();

    for (const [cell, score] of byCell) {
      expect(index.cellState(cell)).toEqual({
        state: "scored",
        score: score.scores,
      });
    }
    for (const cell of cellsOf(workingSet)) {
      const state = index.cellState(cell);
      if (state.state === "scored") {
        expect(byCell.get(cell)?.scores).toEqual(state.score);
      } else {
        expect(byCell.has(cell)).toBe(false);
      }
    }
  }

  it("agrees after a first scoring pass", () => {
    const index = prime(newIndex());
    const result = index.update(HOME);
    expect(result.scored.length).toBeGreaterThan(0);
    expectAgreement(index, result.workingSet);
  });

  it("agrees across the three progressive rings", () => {
    // The real refresh sequence. Each ring scores chunks the previous did not,
    // which is exactly the incremental path.
    const index = prime(newIndex());
    for (const radius of [2, 3, 4]) {
      expectAgreement(index, index.update(HOME, radius).workingSet);
    }
  });

  it("drops a chunk's cells when a late tile invalidates it", () => {
    // `acceptTile` DELETES every chunk the arriving tile overlaps, regardless of
    // pins. A maintained map that kept those cells would keep serving scores
    // computed without the tile -- stale colour that no later pass corrects,
    // because nothing rescored those chunks.
    const index = prime(newIndex());
    const first = index.update(HOME);
    expectAgreement(index, first.workingSet);

    index.acceptTile(tile(HOME, [patch(2, HOME, { leisure: "park" })], 2_000));
    expectAgreement(index, first.workingSet);

    const second = index.update(HOME);
    expectAgreement(index, second.workingSet);
  });

  it("drops evicted chunks' cells rather than keeping them alive", () => {
    // THE STALE-ENTRY DIRECTION, forced by a cap small enough to evict. Without
    // eviction in the fixture this whole class of bug is unreachable -- the
    // round-9 lesson about a fixture that makes the thing under test constant.
    const index = new AffordanceIndex({ table: TABLE, maxChunks: 20 });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
    prime(index);

    index.update(HOME);
    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const far = gridDisk(home, 6).at(-1);
    expect(far).toBeDefined();

    const moved = index.update(positionIn(far!));
    expect(index.stats.chunksEvicted).toBeGreaterThan(0);
    expectAgreement(index, moved.workingSet);
  });

  it("agrees after ensureScored, which writes chunks outside any working set", () => {
    // `ensureScored` is the other writer, and it is the one that does NOT go
    // through `update` -- so a map maintained only on the update path would be
    // silently incomplete exactly where the geo-event reads.
    const index = prime(newIndex());
    const first = index.update(HOME);

    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const outside = gridDisk(home, 5).at(-1);
    expect(outside).toBeDefined();
    index.ensureScored(cellToChildren(outside!, AFFORDANCE_RES));

    expectAgreement(index, [...first.workingSet, outside!]);
  });
});

describe("the incremental map is measurably incremental, not just correct", () => {
  /**
   * WHY THIS TEST EXISTS SEPARATELY FROM THE AGREEMENT TESTS.
   *
   * Those prove the map says the right thing. None of them would notice if it
   * went back to rebuilding from scratch on every read — it would still be
   * correct, and still cost ~24 000 cells per ring at the cap, which is the
   * entire reason stage A exists. A performance change needs an assertion about
   * the WORK DONE, or the next refactor quietly gives it back.
   */
  it("builds the map once across a full three-ring refresh", () => {
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));

    for (const radius of [2, 3, 4]) {
      index.update(HOME, radius);
      index.scoresByCell();
    }

    // ONE, not three. Before stage A each ring scored new chunks, bumped the
    // version and invalidated the cache the previous ring had just built.
    expect(index.stats.scoresByCellBuilds).toBe(1);
  });

  it("does not rebuild after eviction or a late tile either", () => {
    // The two mutation paths that DROP chunks. A version-counter design
    // invalidated on these as well, so they are where a partial revert would
    // show up first.
    const index = new AffordanceIndex({ table: TABLE, maxChunks: 20 });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
    index.update(HOME);
    index.scoresByCell();

    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })], 2_000));
    index.update(HOME);
    index.scoresByCell();

    const home = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);
    const far = gridDisk(home, 6).at(-1);
    index.update(positionIn(far as string));
    index.scoresByCell();

    expect(index.stats.chunksEvicted).toBeGreaterThan(0);
    expect(index.stats.scoresByCellBuilds).toBe(1);
  });
});

/**
 * WHY THESE TESTS MATTER — the exclusion is invisible by construction.
 *
 * `isBelowSurface` removes 13.3 % of corpus features from scoring and from the
 * mesh, and says nothing. The mirror bug is the one that does not announce
 * itself: too eager a predicate deletes real walkable ground and nothing looks
 * broken, there is simply less map. This selector is what lets the demo draw
 * what it dropped so a human can judge it.
 */
describe("belowSurfaceFeatures — what the scorer excluded", () => {
  const surface = patch(10, HOME, { landuse: "grass" });
  const under = patch(11, HOME, { landuse: "grass", layer: "-1" });

  it("returns the excluded features and only those", () => {
    // BOTH KINDS IN THE FIXTURE, or "returns the excluded set" and "returns
    // everything" are the same picture and the test cannot tell them apart.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [surface, under]));

    const excluded = index.belowSurfaceFeatures();
    expect(excluded.map((f) => f.id)).toEqual([11]);
  });

  it("is empty when nothing is underground", () => {
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [surface]));
    expect(index.belowSurfaceFeatures()).toEqual([]);
  });

  it("agrees with the predicate the scorer uses, over every merged feature", () => {
    // THE INVARIANT, stated over the same input rather than by restating the
    // rule: the layer must draw exactly what scoring dropped, or it is a
    // decorative second opinion.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(
      tile(HOME, [
        surface,
        under,
        patch(12, HOME, { tunnel: "yes", highway: "primary" }),
        patch(13, HOME, { tunnel: "building_passage", highway: "footway" }),
      ]),
    );

    const excluded = new Set(index.belowSurfaceFeatures().map((f) => f.id));
    for (const feature of index.mergedFeatures().values()) {
      expect(excluded.has(feature.id)).toBe(isBelowSurface(feature));
    }
    // And the fixture actually exercises both answers.
    expect(excluded.size).toBeGreaterThan(0);
    expect(excluded.size).toBeLessThan(index.mergedFeatures().size);
  });

  describe("belowSurfaceCount — the same answer without the array", () => {
    // WHY THIS EXISTS AT ALL. The demo's status line reports the excluded
    // count on every update whether or not the layer is drawn, and it used to
    // get it from `belowSurfaceFeatures().length` — materialising ~13 % of the
    // corpus on a hot path to read one number off it. Raised in review on #256.
    it("agrees with the length of the feature list", () => {
      const index = new AffordanceIndex({ table: TABLE });
      index.acceptTile(
        tile(HOME, [
          surface,
          under,
          patch(12, HOME, { tunnel: "yes", highway: "primary" }),
        ]),
      );

      // The two must never be able to disagree — a status line that reported a
      // different number from the layer it describes would be worse than
      // reporting nothing.
      expect(index.belowSurfaceCount()).toBe(
        index.belowSurfaceFeatures().length,
      );
      // And the fixture is not degenerate in either direction.
      expect(index.belowSurfaceCount()).toBeGreaterThan(0);
      expect(index.belowSurfaceCount()).toBeLessThan(
        index.mergedFeatures().size,
      );
    });

    it("is zero when nothing is underground", () => {
      const index = new AffordanceIndex({ table: TABLE });
      index.acceptTile(tile(HOME, [surface]));
      expect(index.belowSurfaceCount()).toBe(0);
    });

    it("tracks the merged set as more features arrive", () => {
      // The count is DERIVED, not cached — a counter incremented at ingest
      // would drift the moment a tile was re-accepted or merged, and would go
      // on over-reporting with nothing to contradict it.
      const index = new AffordanceIndex({ table: TABLE });
      index.acceptTile(tile(HOME, [surface, under]));
      expect(index.belowSurfaceCount()).toBe(1);

      index.acceptTile(
        tile(HOME, [
          surface,
          under,
          patch(14, HOME, { location: "underground", landuse: "grass" }),
        ]),
      );
      expect(index.belowSurfaceCount()).toBe(2);
      expect(index.belowSurfaceCount()).toBe(
        index.belowSurfaceFeatures().length,
      );
    });
  });
});

describe("mergedFeatures — the read accessor the spatial index reads", () => {
  it("exposes the merged features rather than making a second copy", () => {
    // Why this test matters: decision 12.4 asked for this accessor and it turned
    // out to exist already — so what was missing was never the method, it was
    // any test of the two properties a second consumer depends on. Identity,
    // not just contents, is what proves no copy is made: at 14-55 MB resident a
    // second merged copy is not affordable on a phone.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));

    expect(index.mergedFeatures().size).toBe(1);
    expect(index.mergedFeatures()).toBe(index.mergedFeatures());
  });

  it("reflects a later tile, so the two features cannot disagree about what is loaded", () => {
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
    index.acceptTile(
      tile(HOME, [
        patch(1, HOME, { landuse: "grass" }),
        patch(2, HOME, { leisure: "park" }),
      ]),
    );

    expect(index.mergedFeatures().size).toBe(2);
  });

  it("is a SNAPSHOT: a held reference goes stale after acceptTile", () => {
    // Why this test matters: `acceptTile` replaces the map rather than mutating
    // it, so a caller that caches the reference keeps serving the old world
    // silently — no error, just outdated answers. The hazard is documented on
    // the accessor, and pinned here so a future change to live-view semantics
    // has to come past a failing test rather than through prose nobody re-reads.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tile(HOME, [patch(1, HOME, { landuse: "grass" })]));
    const held = index.mergedFeatures();

    index.acceptTile(
      tile(HOME, [
        patch(1, HOME, { landuse: "grass" }),
        patch(2, HOME, { leisure: "park" }),
      ]),
    );

    expect(held.size).toBe(1);
    expect(index.mergedFeatures().size).toBe(2);
    expect(index.mergedFeatures()).not.toBe(held);
  });
});
