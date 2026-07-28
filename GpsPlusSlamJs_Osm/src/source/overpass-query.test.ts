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

  it("emits the documented three-line Overpass QL", () => {
    expect(buildTileQuery(bbox)).toBe(
      [
        "[out:json][timeout:60][bbox:1,2,3,4];",
        'nwr[~"."~"."];',
        "out geom;",
      ].join("\n"),
    );
  });

  it("selects nodes, ways and relations in one statement", () => {
    expect(buildTileQuery(bbox)).toContain("nwr");
  });

  it("asks for at least one tag — untagged nodes carry no scoring information", () => {
    // Their coordinates arrive anyway, inline, via `out geom` on the parent way
    // or relation, so dropping them server-side is free.
    expect(buildTileQuery(bbox)).toContain('[~"."~"."]');
  });

  it("uses `out geom`, so no node-reference resolution is ever needed", () => {
    // The client-side reference resolution this avoids is exactly the fragile
    // part of the C# reference's `.ToComplete()` step.
    expect(buildTileQuery(bbox)).toContain("out geom;");
  });

  it("honours a custom timeout", () => {
    expect(buildTileQuery(bbox, 180)).toContain("[timeout:180]");
  });
});

describe("schema version", () => {
  it("is a positive integer, because it is part of every cache key", () => {
    expect(Number.isInteger(OVERPASS_SCHEMA_VERSION)).toBe(true);
    expect(OVERPASS_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
