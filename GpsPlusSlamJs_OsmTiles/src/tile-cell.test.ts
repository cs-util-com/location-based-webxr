import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cellToParent, latLngToCell } from "h3-js";
import { parseTileCell, tileObjectKey, TILE_RESOLUTION } from "./tile-cell";

// Why these tests matter: the cell in the URL is the only client input that
// becomes an R2 key and an Overpass query. A key built from an unvalidated
// path segment could write outside the tile prefix or fill a cell nobody can
// ask for; a non-canonical spelling (upper case) would store the same tile
// twice. So nothing reaches a key before it passed this check.

const COLOGNE = latLngToCell(50.9384, 6.9598, TILE_RESOLUTION);

describe("parseTileCell", () => {
  it("accepts a canonical res-7 cell", () => {
    expect(parseTileCell(COLOGNE)).toBe(COLOGNE);
  });

  it("refuses an upper-case spelling of a valid cell (one tile, one key)", () => {
    expect(parseTileCell(COLOGNE.toUpperCase())).toBeUndefined();
  });

  it("refuses cells of every other resolution", () => {
    const fine = latLngToCell(50.9384, 6.9598, 10);
    expect(parseTileCell(fine)).toBeUndefined();
    expect(parseTileCell(cellToParent(COLOGNE, 6))).toBeUndefined();
  });

  it("refuses path tricks and garbage", () => {
    for (const raw of [
      "",
      "../state/daily",
      `${COLOGNE}/..`,
      `${COLOGNE}.json`,
      " " + COLOGNE,
      "871fa0000000000",
      "zzzzzzzzzzzzzzz",
    ]) {
      expect(parseTileCell(raw), raw).toBeUndefined();
    }
  });

  it("property: every res-7 cell of a point on Earth is accepted", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        (lat, lng) => {
          const cell = latLngToCell(lat, lng, TILE_RESOLUTION);
          expect(parseTileCell(cell)).toBe(cell);
        },
      ),
    );
  });

  it("property: anything else of the cell's length is refused unless it is a valid res-7 cell", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 20 }), (raw) => {
        const parsed = parseTileCell(raw);
        if (parsed !== undefined) {
          expect(parsed).toBe(raw);
          expect(raw).toMatch(/^[0-9a-f]{15}$/);
        }
      }),
    );
  });
});

describe("tileObjectKey", () => {
  it("names the schema-versioned gzip object, mirroring the client cache key", () => {
    expect(tileObjectKey(COLOGNE)).toBe(`osm/v3/${COLOGNE}.json.gz`);
  });

  it("property: keys stay inside the tile prefix", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        (lat, lng) => {
          const key = tileObjectKey(latLngToCell(lat, lng, TILE_RESOLUTION));
          expect(key).toMatch(/^osm\/v3\/[0-9a-f]{15}\.json\.gz$/);
        },
      ),
    );
  });
});
