/**
 * Merge property tests.
 *
 * Why these tests matter:
 * The example tests cover the overlaps someone thought of. In production the
 * inputs are whatever a walking user's fetch history produced — tiles fetched
 * concurrently (identical timestamps), tiles months apart, the same element in
 * one tile or three, empty ocean tiles mixed in. Order-independence in
 * particular cannot be established by example: it is a statement about ALL
 * permutations, and it is the property that makes a merged index reproducible
 * across sessions rather than dependent on the order OPFS happened to return
 * blobs in.
 *
 * @see merge-tiles.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeTiles } from "./merge-tiles.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import type { OsmFeature } from "../model/osm-feature.js";

/** A way whose tags and geometry both vary with `variant`. */
const wayArb = fc
  .record({
    id: fc.integer({ min: 1, max: 6 }),
    variant: fc.integer({ min: 0, max: 9 }),
  })
  .map(
    ({ id, variant }): OsmFeature => ({
      type: "way",
      id,
      geometry: [{ lat: 50 + variant / 100, lng: 6.9 }],
      tags: { variant: String(variant) },
    }),
  );

const tileArb = fc
  .record({
    tile: fc.constantFrom("a", "b", "c", "d"),
    features: fc.array(wayArb, { maxLength: 6 }),
    fetchedAt: fc.integer({ min: 1_000, max: 1_010 }), // deliberately collision-prone
  })
  .map(
    ({ tile, features, fetchedAt }): OsmTileResult => ({
      tile,
      features,
      fetchedAt,
      sourceId: "test",
      schemaVersion: 2,
      skipped: [],
    }),
  );

const snapshot = (tiles: readonly OsmTileResult[]) =>
  JSON.stringify([...mergeTiles(tiles).features.entries()].sort());

/**
 * The tiles that actually contribute, mirroring the supersession rule.
 *
 * A newer result for the SAME tile id replaces an older one outright rather
 * than merging with it — a tile covers a fixed bbox, so absence within it is
 * genuine deletion. The properties below are stated against this effective set
 * rather than the raw input, because otherwise they would assert that a
 * demolished building must survive its own tile's refresh.
 */
function effectiveTiles(tiles: readonly OsmTileResult[]): OsmTileResult[] {
  const byTile = new Map<string, OsmTileResult>();
  for (const tile of tiles) {
    const existing = byTile.get(tile.tile);
    if (existing === undefined || supersedesInTest(tile, existing)) {
      byTile.set(tile.tile, tile);
    }
  }
  return [...byTile.values()];
}

/**
 * Mirrors the production tie-break, including the content-comparison last
 * resort.
 *
 * Deliberately duplicated rather than imported: these properties are meant to
 * pin the RULE, and a test that reused the implementation's own comparator
 * would pass for any comparator at all — including the non-total one this
 * duplication caught.
 */
function supersedesInTest(a: OsmTileResult, b: OsmTileResult): boolean {
  if (a.fetchedAt !== b.fetchedAt) return a.fetchedAt > b.fetchedAt;
  if (a.features.length !== b.features.length) {
    return a.features.length > b.features.length;
  }
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId;
  return JSON.stringify(a.features) < JSON.stringify(b.features);
}

describe("merge properties", () => {
  it("is order-independent over ANY permutation of the same tiles", () => {
    // The property that makes a merged index reproducible. Timestamps collide
    // on purpose (1000..1010 over up to 6 tiles), because that is exactly when
    // an implementation that relied on array order would produce a different
    // answer on a different run — and the store gives no ordering guarantee.
    fc.assert(
      fc.property(
        fc.array(tileArb, { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer(), { maxLength: 6 }),
        (tiles, shuffleKeys) => {
          const shuffled = [...tiles]
            .map((tile, i) => ({ tile, key: shuffleKeys[i] ?? i }))
            .sort((x, y) => x.key - y.key)
            .map(({ tile }) => tile);

          expect(snapshot(shuffled)).toBe(snapshot(tiles));
        },
      ),
    );
  });

  it("never invents, drops or splits an element", () => {
    // The output key set is exactly the union of the input key sets: nothing
    // appears that was not fetched, and nothing fetched is silently discarded
    // (which would read downstream as unmapped ground).
    fc.assert(
      fc.property(fc.array(tileArb, { maxLength: 6 }), (tiles) => {
        const expected = new Set(
          effectiveTiles(tiles).flatMap((t) =>
            t.features.map((f) => `${f.type}/${f.id}`),
          ),
        );
        const merged = mergeTiles(tiles);

        expect(new Set(merged.features.keys())).toEqual(expected);
        expect(merged.features.size).toBe(expected.size);
      }),
    );
  });

  it("every merged element is byte-identical to one it was given", () => {
    // Rule 1, as a property: TOTAL records. A field-by-field merge (the C#
    // behaviour) would produce a record matching no input — new tags on old
    // geometry — and this is the assertion that catches it however it creeps in.
    fc.assert(
      fc.property(fc.array(tileArb, { maxLength: 6 }), (tiles) => {
        const inputs = new Set(
          tiles.flatMap((t) => t.features.map((f) => JSON.stringify(f))),
        );
        // Deliberately the RAW inputs: every output must be byte-identical to
        // something we were given, whichever tile survived supersession.
        for (const feature of mergeTiles(tiles).features.values()) {
          expect(inputs.has(JSON.stringify(feature))).toBe(true);
        }
      }),
    );
  });

  it("provenance always points at a tile that really contained the element", () => {
    fc.assert(
      fc.property(fc.array(tileArb, { maxLength: 6 }), (tiles) => {
        const merged = mergeTiles(tiles);
        for (const [key, prov] of merged.provenance) {
          // Matched on tile AND fetchedAt, and across ALL candidates rather
          // than the first: a tile id alone is not unique (a refetch of the
          // same tile is a legitimate second result), and two results can share
          // both id and timestamp, in which case supersession picks the richer
          // one rather than the earliest in the array.
          const candidates = tiles.filter(
            (t) => t.tile === prov.tile && t.fetchedAt === prov.fetchedAt,
          );
          expect(candidates.length).toBeGreaterThan(0);
          expect(
            candidates.some((t) =>
              t.features.some((f) => `${f.type}/${f.id}` === key),
            ),
          ).toBe(true);
        }
      }),
    );
  });

  it("the winner is always a tile at the maximum fetchedAt for that element", () => {
    // Rule 2, as a property: newest wins. Stated per-element rather than
    // globally, because different elements legitimately come from different
    // tiles within one merge.
    fc.assert(
      fc.property(fc.array(tileArb, { maxLength: 6 }), (tiles) => {
        const merged = mergeTiles(tiles);
        for (const [key, prov] of merged.provenance) {
          const candidates = effectiveTiles(tiles).filter((t) =>
            t.features.some((f) => `${f.type}/${f.id}` === key),
          );
          const newest = Math.max(...candidates.map((t) => t.fetchedAt));
          expect(prov.fetchedAt).toBe(newest);
        }
      }),
    );
  });

  it("staleness is bounded by the oldest contributing tile", () => {
    fc.assert(
      fc.property(
        fc.array(tileArb, { minLength: 1, maxLength: 6 }),
        (tiles) => {
          const merged = mergeTiles(tiles);
          const times = effectiveTiles(tiles).map((t) => t.fetchedAt);
          expect(merged.oldestFetchedAt).toBe(Math.min(...times));
          expect(merged.newestFetchedAt).toBe(Math.max(...times));
        },
      ),
    );
  });
});
