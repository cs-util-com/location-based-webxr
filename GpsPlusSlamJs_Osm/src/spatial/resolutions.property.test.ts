/**
 * Resolution-ladder property tests.
 *
 * Why these tests matter:
 * The example tests above pin one location (Cologne). These assert the ladder's
 * algebra holds ANYWHERE on the globe — including the high latitudes and the
 * antimeridian, where an implementation that quietly assumed a rectangular grid
 * (as the C# geohash reference had to) would break. The transitivity property
 * in particular is the one that would catch a well-meaning "optimisation" that
 * coarsened 13 -> 8 by two `cellToParent` hops through the wrong intermediate.
 *
 * @see resolutions.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { latLngToCell, getResolution, cellToParent, gridDistance } from "h3-js";
import {
  FETCH_RES,
  SCORE_CHUNK_RES,
  AFFORDANCE_RES,
  toFetchTile,
  toScoreChunk,
  fetchWorkingSet,
  scoreWorkingSet,
} from "./resolutions.js";

/** Any point on the globe, including poles and the antimeridian. */
const anyLatLng = fc.record({
  lat: fc.double({ min: -89.9, max: 89.9, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("resolution ladder properties", () => {
  it("coarsening always yields a cell at exactly the target resolution", () => {
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const cell = latLngToCell(lat, lng, AFFORDANCE_RES);
        expect(getResolution(toFetchTile(cell))).toBe(FETCH_RES);
        expect(getResolution(toScoreChunk(cell))).toBe(SCORE_CHUNK_RES);
      }),
    );
  });

  it("is transitive: 13 -> 11 -> 8 equals 13 -> 8 directly", () => {
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const cell = latLngToCell(lat, lng, AFFORDANCE_RES);
        const viaChunk = cellToParent(toScoreChunk(cell), FETCH_RES);
        expect(viaChunk).toBe(toFetchTile(cell));
      }),
    );
  });

  it("is idempotent: coarsening an already-coarse cell changes nothing", () => {
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const tile = latLngToCell(lat, lng, FETCH_RES);
        expect(toFetchTile(toFetchTile(tile))).toBe(tile);
      }),
    );
  });

  // ==========================================================================
  // THE H3 NON-NESTING PROPERTY — the most load-bearing test in this file.
  //
  // It is tempting to assume that coarsening a fine cell gives the same answer
  // as looking the position up directly at the coarse resolution. IT DOES NOT.
  // H3's hexagons do not tile hierarchically: a res-13 cell straddles the
  // boundary of its res-11 parent, so for a position near a boundary the
  // containing res-11 cell and the res-13 cell's parent are DIFFERENT cells.
  //
  // Measured over 200k uniform random positions: this happens for ~6% of
  // positions at both res 8 and res 11, and the two cells are always exactly
  // one grid step apart.
  //
  // Consequences this package must respect, and does:
  //   - `cellToChildren(chunk, 13)` is an INDEX-hierarchy partition, not a
  //     geometric one. Every res-13 cell belongs to exactly one chunk, which is
  //     what makes "score each chunk's children once" correct and duplicate-
  //     free — but those children are not all geometrically inside the chunk.
  //   - Coverage must therefore be computed per res-13 cell against the real
  //     feature geometry, never by assuming a cell is inside its parent.
  //   - The 1-step slop is absorbed by the working set: SCORE_DISK_RADIUS = 2
  //     rings means the user's own res-13 cell is always scored, even when its
  //     parent chunk differs from the chunk the user's position lands in.
  // ==========================================================================
  it("does NOT agree with a direct coarse lookup — H3 hexes are not hierarchically nested", () => {
    // Documents the failure mode explicitly: at least one position exists for
    // which parent != direct lookup. (If a future H3 ever made the hierarchy
    // exact, this test fails and the design notes above can be simplified.)
    const disagreements = fc.sample(anyLatLng, 5000).filter(({ lat, lng }) => {
      const cell = latLngToCell(lat, lng, AFFORDANCE_RES);
      return toScoreChunk(cell) !== latLngToCell(lat, lng, SCORE_CHUNK_RES);
    });
    expect(disagreements.length).toBeGreaterThan(0);
  });

  it("but the disagreement is never more than ONE grid step, at either level", () => {
    // This is the bound the working-set radii are chosen against. If it were
    // ever more than 1, SCORE_DISK_RADIUS = 2 would stop guaranteeing that the
    // user's own affordance cell is inside the scored set.
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const cell = latLngToCell(lat, lng, AFFORDANCE_RES);

        const chunkViaParent = toScoreChunk(cell);
        const chunkDirect = latLngToCell(lat, lng, SCORE_CHUNK_RES);
        expect(gridDistance(chunkViaParent, chunkDirect)).toBeLessThanOrEqual(
          1,
        );

        const tileViaParent = toFetchTile(cell);
        const tileDirect = latLngToCell(lat, lng, FETCH_RES);
        expect(gridDistance(tileViaParent, tileDirect)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("the user's own affordance cell is always inside the scored working set", () => {
    // The property that actually matters to a consumer: "what can I do where I
    // am standing?" must always be answerable. This holds because the working
    // set is built from the DIRECT chunk lookup and extends 2 rings, which
    // absorbs the 1-step parent/direct slop proved above.
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const myCell = latLngToCell(lat, lng, AFFORDANCE_RES);
        const scoredChunks = new Set(
          scoreWorkingSet(latLngToCell(lat, lng, SCORE_CHUNK_RES)),
        );
        expect(scoredChunks.has(toScoreChunk(myCell))).toBe(true);
      }),
    );
  });

  it("working sets always contain their own centre and have no duplicates", () => {
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const tile = latLngToCell(lat, lng, FETCH_RES);
        const chunk = latLngToCell(lat, lng, SCORE_CHUNK_RES);

        const tiles = fetchWorkingSet(tile);
        const chunks = scoreWorkingSet(chunk);

        expect(tiles).toContain(tile);
        expect(chunks).toContain(chunk);
        expect(new Set(tiles).size).toBe(tiles.length);
        expect(new Set(chunks).size).toBe(chunks.length);
      }),
    );
  });

  it("working sets are 7 and 19 everywhere EXCEPT around the 12 pentagons", () => {
    // gridDisk returns fewer cells near a pentagon (a pentagon has 5 rather
    // than 6 neighbours). This documents that the "7 tiles / 19 chunks" figures
    // quoted throughout the plan are the overwhelmingly common case, not a
    // guarantee — code must never index a fixed-size array off them.
    fc.assert(
      fc.property(anyLatLng, ({ lat, lng }) => {
        const tiles = fetchWorkingSet(latLngToCell(lat, lng, FETCH_RES));
        const chunks = scoreWorkingSet(latLngToCell(lat, lng, SCORE_CHUNK_RES));
        expect(tiles.length).toBeLessThanOrEqual(7);
        expect(chunks.length).toBeLessThanOrEqual(19);
        expect(tiles.length).toBeGreaterThan(0);
        expect(chunks.length).toBeGreaterThan(0);
      }),
    );
  });
});
