/**
 * Query-construction and bbox tests.
 *
 * Why these tests matter:
 * The bbox is derived from the H3 cell, and it is LARGER than the hexagon. That
 * is deliberate and harmless (dedup happens by element id at index time) but it
 * makes "features in a tile" and "features returned for a tile" different sets
 * — which is exactly the sort of thing that gets forgotten and then misread as
 * a coverage bug. The overlap property below states it as an assertion.
 *
 * @see overpass-query.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell, cellToBoundary, gridDisk } from "h3-js";
import {
  buildTileQuery,
  cellToBoundingBox,
  AntimeridianCellError,
  OVERPASS_SCHEMA_VERSION,
  OVERPASS_SELECT_KEYS,
} from "./overpass-query.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const TILE = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);

describe("cellToBoundingBox", () => {
  it("contains every vertex of the cell boundary", () => {
    const bbox = cellToBoundingBox(TILE);
    for (const [lat, lng] of cellToBoundary(TILE)) {
      expect(lat).toBeGreaterThanOrEqual(bbox.south);
      expect(lat).toBeLessThanOrEqual(bbox.north);
      expect(lng).toBeGreaterThanOrEqual(bbox.west);
      expect(lng).toBeLessThanOrEqual(bbox.east);
    }
  });

  it("is well-ordered: south < north and west < east", () => {
    const bbox = cellToBoundingBox(TILE);
    expect(bbox.south).toBeLessThan(bbox.north);
    expect(bbox.west).toBeLessThan(bbox.east);
  });

  it('OVERLAPS its neighbours — "in a tile" and "returned for a tile" differ', () => {
    // A hexagon's bbox is bigger than the hexagon, so adjacent fetch tiles
    // overlap and some features come back more than once. Accepted (dedup by
    // element id at index time), but it must be documented, because otherwise
    // a fixture's element count reads as a coverage bug.
    const bbox = cellToBoundingBox(TILE);
    const neighbour = gridDisk(TILE, 1).find((c) => c !== TILE)!;
    const other = cellToBoundingBox(neighbour);

    const overlaps =
      bbox.west < other.east &&
      other.west < bbox.east &&
      bbox.south < other.north &&
      other.south < bbox.north;
    expect(overlaps).toBe(true);
  });

  it("works at high latitude, where longitude spans widen sharply", () => {
    const arctic = latLngToCell(78.22, 15.65, FETCH_RES); // Longyearbyen
    const bbox = cellToBoundingBox(arctic);
    expect(bbox.south).toBeLessThan(bbox.north);
    expect(bbox.west).toBeLessThan(bbox.east);
  });

  it("throws a NAMED error for a cell straddling the antimeridian", () => {
    // Overpass's bbox is south,west,north,east with west < east and simply
    // cannot express a wrap. Failing loudly beats emitting a bbox that silently
    // covers the whole globe the wrong way round.
    //
    // The disk is scanned rather than one cell hardcoded, because exactly which
    // cells straddle ±180 is an H3 implementation detail we should not pin.
    const straddling = gridDisk(latLngToCell(0, 179.99, FETCH_RES), 3).filter(
      (cell) => {
        const lngs = cellToBoundary(cell).map(([, lng]) => lng);
        return Math.max(...lngs) - Math.min(...lngs) > 180;
      },
    );

    expect(straddling.length).toBeGreaterThan(0);
    for (const cell of straddling) {
      expect(() => cellToBoundingBox(cell)).toThrow(AntimeridianCellError);
    }
  });
});

describe("buildTileQuery", () => {
  const bbox = { south: 1, west: 2, north: 3, east: 4 };

  // ==========================================================================
  // THE MEASUREMENT THIS SECTION ENCODES (2026-07-28, findings doc):
  //
  //   (the 28.31 MB / 21,847-element payload figures from this run are
  //    RETRACTED — see `resolutions.ts` FETCH_RES; the 200-vs-504 verdict is
  //    what this section encodes and it does not rest on them)
  //
  //   res-7 tile, union of 32 exact keys  -> 200 OK, 18.2 s
  //   res-7 tile, REGEX over the same 32  -> 504 after 8 s, empty body
  //   res-7 tile, regex over 3 keys       -> 200 OK
  //
  // `nwr[~"^(k1|k2|...)$"~"."]` makes Overpass evaluate a regex against every
  // key of every element in the bbox, and the cost grows with the alternation
  // count. Exact-key statements use the key index instead. The whole reason the
  // project believed public Overpass was saturated was this one query form.
  // ==========================================================================

  it("emits a UNION of exact-key statements, not a key regex", () => {
    const q = buildTileQuery(bbox);
    expect(q).toContain('nw["highway"];');
    expect(q).not.toMatch(/\[~"\^\(/); // the regex form that 504s
  });

  it("wraps the statements in one union block with ONE trailing out", () => {
    // A single trailing `out` is what makes the union deduplicate: the union is
    // a set, so each element is returned once. The measurement that recorded
    // "union duplicates elements" was running the statements as separate
    // queries; measured properly, every element came back exactly once.
    //
    // The element COUNT that run reported (21,847) is retracted — see
    // `resolutions.ts` FETCH_RES. Uniqueness is a property of the union, not of
    // the count, so the conclusion here is untouched by the withdrawal.
    const q = buildTileQuery(bbox);
    expect(q).toMatch(/^\(/m);
    expect(q).toMatch(/\);$/m);
    expect(q.match(/^out /gm)).toHaveLength(1);
  });

  it("covers every key in the pinned list, once each, on BOTH statements", () => {
    const q = buildTileQuery(bbox);
    for (const key of OVERPASS_SELECT_KEYS) {
      expect(q).toContain(`nw["${key}"];`);
      expect(q).toContain(
        `relation["${key}"]["type"~"^(multipolygon|boundary)$"];`,
      );
    }
    expect(q.match(/nw\[/g)).toHaveLength(OVERPASS_SELECT_KEYS.length);
    expect(q.match(/relation\[/g)).toHaveLength(OVERPASS_SELECT_KEYS.length);
  });

  it("takes only AREAL relations, which is the F32 saving", () => {
    // THIS REPLACES "selects nodes, ways and relations in each statement", and
    // the reversal is deliberate rather than a loosening. That rule came from
    // the `nwr` form, which fetched every relation touching the bbox —
    // including the route, waterway and power relations that make a res-7 tile
    // 68.0 MB instead of 21.1 MB.
    //
    // `buildFeatureIndex` has ALWAYS refused a relation whose `type` is not
    // areal, so those bytes were fetched, parsed and discarded on the next line.
    // `score/areal-only-differential.test.ts` pins the consequence against a
    // captured companion fixture: over the Cologne extract — the corpus's worst
    // case at 85 dropped relations — 0 of 86 172 cell-category scores change,
    // and buildings, plates and roads come out bit-identical.
    const q = buildTileQuery(bbox);
    expect(q).not.toContain("nwr[");
    expect(q).toContain('["type"~"^(multipolygon|boundary)$"]');
  });

  it("uses `out geom`, so no node-reference resolution is ever needed", () => {
    // The client-side reference resolution this avoids is exactly the fragile
    // part of the C# reference's `.ToComplete()` step.
    expect(buildTileQuery(bbox)).toContain("out geom;");
  });

  it("defaults to a generous timeout, because Overpass only charges time used", () => {
    // `timeout:` bounds EXECUTION, not queue wait, and is only charged for what
    // is actually consumed — so a high ceiling costs nothing on a fast query
    // and avoids killing a slow one in a denser city. The old default of 60 had
    // never completed a full-size fetch.
    expect(buildTileQuery(bbox)).toContain("[timeout:180]");
  });

  it("honours a custom timeout", () => {
    expect(buildTileQuery(bbox, 90)).toContain("[timeout:90]");
  });

  it("accepts an overridden key list, for a self-hosted or narrowed instance", () => {
    const q = buildTileQuery(bbox, 180, ["building", "highway"]);
    expect(q).toContain('nw["building"];');
    expect(q).toContain('nw["highway"];');
    expect(q).not.toContain('nw["landuse"];');
  });

  it("rejects an empty key list rather than fetching the whole planet's tags", () => {
    // An empty union would emit `();` which Overpass rejects — but worse, a
    // well-meaning "fall back to unfiltered" would restore exactly the query
    // that 504s. Fail loudly instead.
    expect(() => buildTileQuery(bbox, 180, [])).toThrow(/at least one key/i);
  });

  it("rejects a key containing a quote, which would break out of the statement", () => {
    // The key list is normally a checked-in constant, but it is overridable, so
    // it is an injection surface. An escaped quote could append arbitrary
    // Overpass QL — including an `out` that dumps far more than intended.
    expect(() => buildTileQuery(bbox, 180, ['building"];out meta;//'])).toThrow(
      /invalid/i,
    );
  });
});

describe("OVERPASS_SELECT_KEYS", () => {
  it("is the 32-key list proven to fetch real data", () => {
    // Narrower lists were printed in the plan at various points (23 and 24
    // keys). Every key dropped is scoring signal that can never arrive, and the
    // symptom is silent: an element that never arrives scores the
    // multiplicative identity, which reads as "nothing is mapped here".
    expect(OVERPASS_SELECT_KEYS).toHaveLength(32);
  });

  it("includes historic, which the C# scoring oracle depends on", () => {
    // "a historic way contributing 3" is one of the pinned oracle values, and
    // the 23-key list that was measured first had dropped it.
    expect(OVERPASS_SELECT_KEYS).toContain("historic");
  });

  it("has no duplicates", () => {
    expect(new Set(OVERPASS_SELECT_KEYS).size).toBe(
      OVERPASS_SELECT_KEYS.length,
    );
  });

  it("contains only characters that are safe unquoted in Overpass QL", () => {
    for (const key of OVERPASS_SELECT_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_:]*$/);
    }
  });
});

describe("schema version", () => {
  it("is a positive integer, because it is part of every cache key", () => {
    expect(Number.isInteger(OVERPASS_SCHEMA_VERSION)).toBe(true);
    expect(OVERPASS_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it("is at least 2 — the res-8→7 and regex→union changes both invalidate v1", () => {
    // Either change alone makes a v1 cache entry a lie: a res-8 tile is not a
    // res-7 tile, and a regex-fetched tile holds a different element set from a
    // union-fetched one. This constant exists for exactly this moment.
    expect(OVERPASS_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});
