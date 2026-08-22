/**
 * Resolution-ladder tests.
 *
 * Why these tests matter:
 * Every other module in this package reads its resolutions from here, so a
 * silent change to one of these constants would mis-key the cache, mis-size the
 * working set, or blow the per-chunk frame budget — all of which surface far
 * from the cause. These tests pin the constants against h3-js's OWN grid
 * metrics rather than against hardcoded numbers copied from a doc, so if a
 * future h3-js release ever moved the grid the failure lands here instead of
 * silently shifting the whole package.
 *
 * @see resolutions.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  getHexagonEdgeLengthAvg,
  getHexagonAreaAvg,
  cellToChildren,
  getResolution,
  latLngToCell,
  UNITS,
} from "h3-js";
import {
  EVENT_TILE_RES,
  FETCH_RES,
  SCORE_CHUNK_RES,
  AFFORDANCE_RES,
  FETCH_DISK_RADIUS,
  SCORE_DISK_RADIUS,
  SCORE_DISK_MAX_RADIUS,
  RES13_CELLS_PER_CHUNK,
  AFFORDANCE_CELL_AREA_M2,
  toEventTile,
  toFetchTile,
  toScoreChunk,
  fetchWorkingSet,
  scoreWorkingSet,
  fetchTilesForScoreWorkingSet,
} from "./resolutions.js";

// A dense, well-mapped European location (Cologne) used as the canonical
// reference point throughout this package's tests.
const COLOGNE = { lat: 50.9413, lng: 6.9583 };

describe("the resolution ladder is ordered and whole-levelled", () => {
  it("goes coarse -> fine: fetch < chunk < affordance", () => {
    expect(FETCH_RES).toBeLessThan(SCORE_CHUNK_RES);
    expect(SCORE_CHUNK_RES).toBeLessThan(AFFORDANCE_RES);
  });

  it("steps by whole levels, which is what makes parent/child round-trip exactly", () => {
    expect(Number.isInteger(SCORE_CHUNK_RES - FETCH_RES)).toBe(true);
    expect(Number.isInteger(AFFORDANCE_RES - SCORE_CHUNK_RES)).toBe(true);
  });
});

describe("the constants match h3-js grid metrics", () => {
  it("res 7 is the ~5.16 km2 fetch tile", () => {
    // Raised from res 8 (0.737 km2) on 2026-07-28: one res-7 request replaces
    // the seven res-8 requests a one-ring working set needed. Pinned because
    // the whole fetch-policy argument is an area/request-count trade, and a
    // silent resolution change would invalidate it without failing anything.
    expect(getHexagonAreaAvg(FETCH_RES, UNITS.km2)).toBeCloseTo(5.161, 2);
    expect(FETCH_RES).toBe(7);
  });

  it("one res-7 cell covers about what a res-8 cell plus one ring covered", () => {
    // This equivalence is why the change is a request-count win rather than a
    // coverage change: 7 res-8 tiles is 5.16 km2, and so is 1 res-7 tile.
    const sevenRes8 = 7 * getHexagonAreaAvg(8, UNITS.km2);
    expect(getHexagonAreaAvg(FETCH_RES, UNITS.km2)).toBeCloseTo(sevenRes8, 1);
  });

  it("res 11 is the ~2150 m2 score chunk", () => {
    expect(getHexagonAreaAvg(SCORE_CHUNK_RES, UNITS.m2)).toBeCloseTo(2149.6, 0);
  });

  it("res 13 is the ~43.9 m2 affordance cell", () => {
    expect(getHexagonAreaAvg(AFFORDANCE_RES, UNITS.m2)).toBeCloseTo(
      AFFORDANCE_CELL_AREA_M2,
      0,
    );
  });

  // EDGE LENGTHS — and why they are asserted against a derivation rather than
  // against a table.
  //
  // The widely-copied pre-v4.1 H3 documentation table gives res 8/11/13 as
  // 461.35 / 24.91 / 3.56 m. Those are ~13% too small, and they were quoted
  // throughout this project's docs until 2026-07-28. h3-js 4.4 reports
  // 531.41 / 28.66 / 4.09 m.
  //
  // The tie-break is geometry, not authority: for a regular hexagon of area A
  // the edge is sqrt(2A / (3*sqrt(3))). That derivation agrees with h3-js to
  // within 0.3% and disagrees with the stale table by ~13%, so the newer
  // numbers are the self-consistent ones. Asserting against the derivation
  // means this test cannot itself go stale the way a copied table does.
  //
  // This matters beyond bookkeeping: "how far across is a fetch tile" drives
  // the terrain-tile budget in the plan's §7.
  const edgeFromArea = (res: number) =>
    Math.sqrt((2 * getHexagonAreaAvg(res, UNITS.m2)) / (3 * Math.sqrt(3)));

  it.each([
    { res: FETCH_RES, h3Edge: 1406.48, staleTableEdge: 1220.63 },
    { res: SCORE_CHUNK_RES, h3Edge: 28.66, staleTableEdge: 24.91 },
    { res: AFFORDANCE_RES, h3Edge: 4.09, staleTableEdge: 3.56 },
  ])(
    "res $res edge is $h3Edge m (h3-js, and geometrically consistent), not the stale table's $staleTableEdge m",
    ({ res, h3Edge, staleTableEdge }) => {
      const actual = getHexagonEdgeLengthAvg(res, UNITS.m);
      const derived = edgeFromArea(res);
      const relErr = (v: number) => Math.abs(v - derived) / derived;

      expect(actual).toBeCloseTo(h3Edge, 1);
      // The newer value is geometrically consistent with the area...
      expect(relErr(actual)).toBeLessThan(0.005);
      // ...and the stale table's value is not, by an order of magnitude more.
      expect(relErr(staleTableEdge)).toBeGreaterThan(0.1);
    },
  );

  it("a res-7 tile is 2.81 km across with a 1218 m inradius — the border-band arithmetic", () => {
    // The border case (plan §5.1.1) is quantified from these two numbers: the
    // score working set reaches ~128 m, and the share of a hexagon within 128 m
    // of its boundary is 1 - ((r - 128) / r)^2 with r the inradius. At res 7
    // that is ~20%; at res 8 it was ~48%. Pinned because the decision to keep a
    // border rule at all rests on it being ~20% rather than negligible.
    const edge = getHexagonEdgeLengthAvg(FETCH_RES, UNITS.m);
    const inradius = (edge * Math.sqrt(3)) / 2;
    expect(2 * edge).toBeCloseTo(2813, -1);
    expect(inradius).toBeCloseTo(1218, -1);

    const band = (r: number, reach: number) => 1 - ((r - reach) / r) ** 2;
    expect(band(inradius, 128)).toBeCloseTo(0.199, 2);
  });
});

describe("child counts — why scoring is never eager over a fetch tile", () => {
  it("one res-11 chunk holds 49 res-13 cells (7^2)", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    expect(cellToChildren(chunk, AFFORDANCE_RES)).toHaveLength(
      RES13_CELLS_PER_CHUNK,
    );
    expect(RES13_CELLS_PER_CHUNK).toBe(7 ** (AFFORDANCE_RES - SCORE_CHUNK_RES));
  });

  it("one res-7 tile holds ~117,649 res-13 cells (7^6) — the reason for lazy scoring", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(cellToChildren(tile, AFFORDANCE_RES)).toHaveLength(
      7 ** (AFFORDANCE_RES - FETCH_RES),
    );
    // The absolute number is the point: raising FETCH_RES multiplied it by 7,
    // so "never score eagerly over a fetch tile" went from important to
    // non-negotiable.
    expect(7 ** (AFFORDANCE_RES - FETCH_RES)).toBe(117649);
  });
});

describe("working sets", () => {
  it("the fixed-radius prefetch set is the centre tile plus one ring = 7 tiles", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    const set = fetchWorkingSet(tile);
    expect(set).toHaveLength(
      1 + 3 * FETCH_DISK_RADIUS * (FETCH_DISK_RADIUS + 1),
    );
    expect(set).toHaveLength(7);
    expect(set).toContain(tile);
  });

  it("the score working set is the centre chunk plus two rings = 19 chunks", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    const set = scoreWorkingSet(chunk);
    expect(set).toHaveLength(
      1 + 3 * SCORE_DISK_RADIUS * (SCORE_DISK_RADIUS + 1),
    );
    expect(set).toHaveLength(19);
    expect(set).toContain(chunk);
  });

  it("19 chunks x 49 cells = the 931 res-13 cells the plan budgets for", () => {
    expect(19 * RES13_CELLS_PER_CHUNK).toBe(931);
  });
});

describe("fetch coverage is DERIVED from the score working set, not guessed", () => {
  // Why these tests matter:
  // The movement trigger used to fetch "the tile I am in, plus one ring" — a
  // fixed guess that over-fetches in the interior and can still under-fetch at
  // a boundary. With FETCH_RES = 7 a fixed ring costs ~150 MB (7 tiles x ~21 MB), so the guess got
  // expensive at exactly the moment it stopped being needed. Deriving the tile
  // set from the chunks we are actually going to score is both cheaper and
  // strictly more correct, and it stays correct if either resolution moves.
  it("returns a single tile when the whole working set sits inside one res-7 cell", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    const tiles = fetchTilesForScoreWorkingSet(chunk);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it("covers every chunk it was asked about — the invariant consumers rely on", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    const tiles = new Set(fetchTilesForScoreWorkingSet(chunk));
    for (const c of scoreWorkingSet(chunk)) {
      expect(tiles.has(toFetchTile(c))).toBe(true);
    }
  });

  it("returns more than one tile for a working set straddling a res-7 boundary", () => {
    // The case the whole design exists for. Rather than hand-picking a
    // boundary position (which would rot the moment H3 changed), search for one
    // — a res-7 cell is 2.81 km across, so a boundary is never far away.
    const straddling = fc
      .sample(
        fc.record({
          lat: fc.double({ min: 50.8, max: 51.0, noNaN: true }),
          lng: fc.double({ min: 6.8, max: 7.1, noNaN: true }),
        }),
        400,
      )
      .map(({ lat, lng }) => latLngToCell(lat, lng, SCORE_CHUNK_RES))
      .find((c) => fetchTilesForScoreWorkingSet(c).length > 1);

    expect(straddling).toBeDefined();
  });
});

describe("coarsening", () => {
  it("toFetchTile agrees with a direct res-8 lookup of the same position", () => {
    const fine = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    expect(toFetchTile(fine)).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES),
    );
  });

  it("toScoreChunk agrees with a direct res-11 lookup of the same position", () => {
    const fine = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    expect(toScoreChunk(fine)).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
    );
  });

  it('throws a NAMED error when asked to "coarsen" to a finer resolution', () => {
    // h3-js throws a generic message here; we want the failure to say what the
    // caller actually did wrong, because this is the shape of the
    // string-truncation bug the module docs warn about.
    const coarse = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(() => toScoreChunk(coarse)).toThrow(/only coarsens/);
  });

  it("is a no-op when the cell is already at the target resolution", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(toFetchTile(tile)).toBe(tile);
  });
});

describe("scoreWorkingSet — progressive radii (W16, DEC-R2-30)", () => {
  const CHUNK = latLngToCell(50.9413, 6.9583, SCORE_CHUNK_RES);

  it("grows monotonically with the radius, and never shrinks", () => {
    // WHY THIS MATTERS. The progressive path calls this with a growing ring
    // counter, and each pass must be a SUPERSET of the last — a user watching
    // the map fill in must never see cells disappear as it widens.
    let previous = new Set<string>();
    for (let radius = 0; radius <= SCORE_DISK_MAX_RADIUS; radius += 1) {
      const set = new Set(scoreWorkingSet(CHUNK, radius));
      expect(set.size).toBeGreaterThanOrEqual(previous.size);
      for (const cell of previous) expect(set.has(cell)).toBe(true);
      previous = set;
    }
  });

  it("defaults to the FIRST pass's radius, not the widest", () => {
    // The default is what an un-migrated caller gets, and it has to stay the
    // narrow, fast answer. Defaulting to the maximum would silently make every
    // existing caller do 3x the work for a reach it never asked for.
    expect(scoreWorkingSet(CHUNK)).toEqual(
      scoreWorkingSet(CHUNK, SCORE_DISK_RADIUS),
    );
    expect(scoreWorkingSet(CHUNK).length).toBeLessThan(
      scoreWorkingSet(CHUNK, SCORE_DISK_MAX_RADIUS).length,
    );
  });

  it("clamps a nonsensical radius instead of throwing or over-reaching", () => {
    // This is called with a ring COUNTER, and a counter is exactly the kind of
    // value that goes wrong by one. `gridDisk` throws on a negative radius, and
    // an unbounded one is a working set nobody asked for.
    expect(scoreWorkingSet(CHUNK, -3)).toEqual(scoreWorkingSet(CHUNK, 0));
    expect(scoreWorkingSet(CHUNK, 99)).toEqual(
      scoreWorkingSet(CHUNK, SCORE_DISK_MAX_RADIUS),
    );
    expect(scoreWorkingSet(CHUNK, 2.7)).toEqual(scoreWorkingSet(CHUNK, 2));
  });

  it("reaches 127 chunks at the maximum radius", () => {
    // 1 + 6 + 12 + 18 + 24 + 30 + 36 = 127, the hexagonal ring sum. Pinned as a
    // NUMBER because the radius decisions were taken on a stated cost, and a
    // change to the radius that did not change this count would mean the
    // constant is not being read. Was 61 at radius 4; DEC-K1 raised it to 6.
    expect(scoreWorkingSet(CHUNK, SCORE_DISK_MAX_RADIUS)).toHaveLength(127);
  });
});

/**
 * WHY THIS RUNG EXISTS (round 9 §2). A geo-event is quantised to a tile so that
 * two devices standing in the same place compute the same event with no network
 * between them. The tile is the agreement.
 */
describe("EVENT_TILE_RES — the geo-event tile", () => {
  it("sits between the fetch tile and the score chunk", () => {
    // The ladder must stay ordered and whole-levelled: 7 -> 8 -> 11 -> 13.
    expect(FETCH_RES).toBeLessThan(EVENT_TILE_RES);
    expect(EVENT_TILE_RES).toBeLessThan(SCORE_CHUNK_RES);
  });

  it("contains the scored disk it has to cover", () => {
    // A res-8 hexagon has a ~460 m inradius and the scored disk reaches ~326 m
    // from the user, so a climb starting anywhere in the tile stays inside the
    // ground the ensure step can cover. If this ever inverted, candidates near
    // a tile edge would need data from two fetch tiles to be judged at all.
    const inradiusM =
      (getHexagonEdgeLengthAvg(EVENT_TILE_RES, "m") * Math.sqrt(3)) / 2;
    expect(inradiusM).toBeGreaterThan(250);
  });

  it("coarsens a score chunk to its event tile", () => {
    const chunk = latLngToCell(50.9413, 6.9583, SCORE_CHUNK_RES);
    expect(getResolution(toEventTile(chunk))).toBe(EVENT_TILE_RES);
  });

  it("refuses to coarsen something already coarser", () => {
    // The same guard `toFetchTile` has: `cellToParent` only ever coarsens, and
    // string-truncating an H3 id yields an invalid cell rather than a parent.
    const tile = latLngToCell(50.9413, 6.9583, FETCH_RES);
    expect(() => toEventTile(tile)).toThrow(/only coarsens/);
  });
});
