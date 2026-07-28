/**
 * Property tests for the incremental lifecycle.
 *
 * WHY THESE MATTER, and why they are properties rather than examples.
 *
 * A cache is only ever a bet that recomputing would give the same answer. The
 * example tests next door check that the cache HITS; these check that it is
 * allowed to. The failure mode of an incremental index is not a crash — it is a
 * cell that keeps a score computed from data that has since changed, which
 * reads as a confident wrong answer and is invisible in any single run.
 *
 * So the properties are all forms of one claim: **the incremental path and a
 * from-scratch path agree, whatever route the user took to get there.**
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseRuleTable } from "../rules/rule-table.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { FETCH_RES, SCORE_CHUNK_RES } from "../spatial/resolutions.js";

const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable",
    "landuse_grass,landuse,grass,9",
    "surface_sand,surface,sand,5",
    "natural_beach,natural,beach,7",
    "building_house,building,house,0",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const HOME = { lat: 50.9413, lng: 6.9583 };
const HOME_CHUNK = latLngToCell(HOME.lat, HOME.lng, SCORE_CHUNK_RES);

const TAGSETS: Record<string, string>[] = [
  { landuse: "grass", area: "yes" },
  { surface: "sand", area: "yes" },
  { natural: "beach", area: "yes" },
  { building: "house" },
  { amenity: "bench" },
];

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

function tile(features: OsmFeature[], fetchedAt: number): OsmTileResult {
  return {
    tile: latLngToCell(HOME.lat, HOME.lng, FETCH_RES),
    features,
    fetchedAt,
    sourceId: "test",
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    skipped: [],
  };
}

const positionIn = (chunk: string) => {
  const [lat, lng] = cellToLatLng(chunk);
  return { lat, lng };
};

/** Chunk id → its cells' walkable scores, as a comparable snapshot. */
function snapshot(index: AffordanceIndex, chunks: readonly string[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const chunk of chunks) {
    const scored = index.chunk(chunk);
    if (scored === undefined) continue;
    const cells: Record<string, number> = {};
    for (const cell of scored.cells)
      cells[cell.cell] = cell.scores["walkable"] ?? 1;
    out[chunk] = cells;
  }
  return out;
}

/** The features arbitrary: a handful of patches around HOME. */
const featuresArb = fc.array(
  fc
    .tuple(
      fc.integer({ min: 0, max: TAGSETS.length - 1 }),
      fc.integer({ min: -3, max: 3 }),
      fc.integer({ min: -3, max: 3 }),
    )
    .map(([tagIndex, dx, dy]) => ({ tagIndex, dx, dy })),
  { minLength: 1, maxLength: 3 },
);

function buildFeatures(
  specs: { tagIndex: number; dx: number; dy: number }[],
): OsmFeature[] {
  return specs.map((spec, i) =>
    patch(
      i + 1,
      { lat: HOME.lat + spec.dy * 0.0003, lng: HOME.lng + spec.dx * 0.0003 },
      TAGSETS[spec.tagIndex] as Record<string, string>,
    ),
  );
}

describe("the incremental path agrees with a from-scratch path", () => {
  it("gives the same scores however the user walked there", () => {
    // THE CENTRAL PROPERTY. Walking A→B→C and jumping straight to C must leave
    // the same scores for C's working set. If chunk reuse ever leaked state
    // between positions — a cached chunk scored under a different feature set,
    // a geometry cache not cleared on merge — this is what would catch it.
    fc.assert(
      fc.property(
        featuresArb,
        fc.array(fc.integer({ min: 0, max: 6 }), {
          minLength: 1,
          maxLength: 4,
        }),
        (specs, hops) => {
          const features = buildFeatures(specs);
          const ring = gridDisk(HOME_CHUNK, 1);

          const walked = new AffordanceIndex({ table: TABLE });
          walked.acceptTile(tile(features, 1_000));
          let last = HOME_CHUNK;
          for (const hop of hops) {
            last = ring[hop % ring.length] as string;
            walked.update(positionIn(last));
          }

          const direct = new AffordanceIndex({ table: TABLE });
          direct.acceptTile(tile(features, 1_000));
          direct.update(positionIn(last));

          const chunks = gridDisk(last, 2);
          expect(snapshot(walked, chunks)).toEqual(snapshot(direct, chunks));
        },
      ),
      { numRuns: 6 },
    );
  }, 30_000);

  it("a late tile leaves the index as if that tile had always been there", () => {
    // The invalidation's correctness condition, stated exactly. "Serve cache
    // now, queue the fetch" is only safe if the eventual state is independent
    // of WHEN the tile arrived — otherwise a rate-limited phone and a fast one
    // would disagree about the same ground, permanently and silently.
    fc.assert(
      fc.property(featuresArb, featuresArb, (firstSpecs, secondSpecs) => {
        const first = buildFeatures(firstSpecs);
        const second = buildFeatures(secondSpecs).map((f, i) => ({
          ...f,
          id: 100 + i,
        })) as OsmFeature[];

        const late = new AffordanceIndex({ table: TABLE });
        late.acceptTile(tile(first, 1_000));
        late.update(HOME);
        late.acceptTile(tile([...first, ...second], 2_000));
        late.update(HOME);

        const upfront = new AffordanceIndex({ table: TABLE });
        upfront.acceptTile(tile([...first, ...second], 2_000));
        upfront.update(HOME);

        const chunks = gridDisk(HOME_CHUNK, 2);
        expect(snapshot(late, chunks)).toEqual(snapshot(upfront, chunks));
      }),
      { numRuns: 5 },
    );
  }, 30_000);

  it("never scores the same chunk twice without an invalidation between", () => {
    // The claim that makes the whole class worth having. Any number of updates
    // within one area must score each chunk at most once — if this drifts, the
    // cache has quietly stopped working and only a counter would ever say so.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 6 }), {
          minLength: 2,
          maxLength: 8,
        }),
        (hops) => {
          const index = new AffordanceIndex({ table: TABLE });
          index.acceptTile(
            tile(buildFeatures([{ tagIndex: 0, dx: 0, dy: 0 }]), 1_000),
          );

          const ring = gridDisk(HOME_CHUNK, 1);
          const visited = new Set<string>();
          for (const hop of hops) {
            const chunk = ring[hop % ring.length] as string;
            visited.add(chunk);
            index.update(positionIn(chunk));
          }

          // Union of the working sets visited bounds how many distinct chunks
          // could legitimately have been scored.
          const reachable = new Set<string>();
          for (const chunk of visited) {
            for (const c of gridDisk(chunk, 2)) reachable.add(c);
          }
          expect(index.stats.chunksScored).toBeLessThanOrEqual(reachable.size);
        },
      ),
      { numRuns: 8 },
    );
  }, 30_000);
});
