/**
 * How much of what `acceptTile` throws away could not possibly have changed?
 *
 * WHY THIS EXISTS. The AR derive-growth walk found the retained score cache
 * collapsing at a res-7 tile boundary — 12 495 cells to 9 408 with nothing
 * happening but a neighbour tile being merged. `acceptTile` drops every chunk
 * whose bbox intersects the accepted tile's, and a res-7 bounding box is ~2.4 km
 * across, so it discards scored ground the user has already walked over. The
 * owner asked for the size of the waste **and explicitly not for a fix**: an
 * invalidation bug presents as a stale map rather than as an error, so the
 * narrower rule needs a number in front of it.
 *
 * ## The answer: 91.3 % of it cannot change
 *
 * Measured over the real res-11 children of the res-7 tile containing Cologne
 * Cathedral, against each of its six neighbours: **1 084 chunks invalidated,
 * 990 of them already fully covered by the tile the index was already
 * holding.** Per neighbour it runs 58 % on the two that meet the tile at a
 * corner and 96–98 % on the four that share an edge.
 *
 * ## Why "already covered" means "cannot change"
 *
 * The Overpass query for a tile covers the tile's BOUNDING BOX, not its hexagon
 * — `overpass-query.ts` says so, and names the consequence: "the bbox is larger
 * than the hexagon, so adjacent tiles overlap". So if a chunk lies entirely
 * inside a bbox the index has already fetched, that fetch already returned every
 * element touching the chunk, and a neighbour whose bbox also covers it returns
 * the same elements. Re-scoring produces the same answer.
 *
 * That is an argument, so the first test below checks it against real data
 * instead of asserting it. **The 91.3 % is only worth what that premise is
 * worth**, and the check has a control precisely because a fixture that covers
 * exactly one tile would otherwise let it pass on an index that ignored the
 * second tile entirely.
 *
 * ## What the remaining 8.7 % is, and why the rule is not simply wrong
 *
 * Chunks the held tile did NOT fully cover — ground near the boundary that the
 * arriving tile genuinely completes. Those are exactly the case the method's own
 * comment describes: "a chunk scored before this tile arrived recorded its
 * absence." The rule is right; it is ~11× wider than it needs to be.
 *
 * The other arm of the condition, `scored.tiles.includes(tile.tile)`, does a
 * different job — a freshness refetch of a tile already merged in, where the
 * data really may have changed underneath. Narrowing the bbox arm leaves it
 * untouched.
 *
 * ## The candidate rule, NOT implemented
 *
 * Drop a chunk only when the accepted tile's bbox intersects it AND the chunk is
 * not already fully inside the bbox of some tile already held. The index knows
 * every held tile, so the extra test is a handful of bbox containments per chunk
 * on a path that already runs one bbox intersection per chunk behind a network
 * fetch. Cheap — but not free of risk, and the owner's call.
 *
 * @see affordance-index.ts.md
 */

import { describe, expect, it } from "vitest";
import { cellToBoundary, cellToChildren, gridDisk, latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { boundsOf, bboxesIntersect, padBbox } from "../spatial/clip.js";
import type { Bbox } from "../spatial/clip.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import { SCORE_CHUNK_RES } from "../spatial/resolutions.js";

const TABLE = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "snapshot",
  fetchedAt: 0,
});

/**
 * The same margin `affordance-index.ts` pads a chunk's bbox by before selecting
 * features. Containment has to be tested against the PADDED box, because that is
 * the area a chunk's score can actually draw from — a feature 55 m outside the
 * chunk still reaches it.
 */
const CHUNK_MARGIN_DEG = 0.0005;

function cellBbox(cell: string): Bbox {
  const bbox = boundsOf(
    cellToBoundary(cell).map(([lat, lng]) => ({ lat, lng })),
  );
  if (bbox === undefined) throw new Error(`no boundary for ${cell}`);
  return bbox;
}

/** Whether `inner` lies entirely within `outer`. */
function within(inner: Bbox, outer: Bbox): boolean {
  return (
    inner.south >= outer.south &&
    inner.north <= outer.north &&
    inner.west >= outer.west &&
    inner.east <= outer.east
  );
}

/** Area of the intersection of two bboxes, in square degrees. */
function overlapArea(a: Bbox, b: Bbox): number {
  return (
    Math.max(0, Math.min(a.north, b.north) - Math.max(a.south, b.south)) *
    Math.max(0, Math.min(a.east, b.east) - Math.max(a.west, b.west))
  );
}

/**
 * The neighbour of `tile` whose bbox reaches furthest into it.
 *
 * The premise test needs a chunk that is BOTH touched by the neighbour and
 * already fully covered by `tile` with the feature-selection margin — which only
 * exists where the neighbour reaches ≥80 m in. The two corner-adjacent
 * neighbours do not, so picking one arbitrarily makes the test vacuous.
 */
function deepestNeighbour(tile: string, box: Bbox): string | undefined {
  let best: string | undefined;
  let bestArea = 0;
  for (const candidate of gridDisk(tile, 1)) {
    if (candidate === tile) continue;
    const area = overlapArea(cellBbox(candidate), box);
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}

/** Whether a bbox contains a point. */
function contains(box: Bbox, point: LatLng): boolean {
  return (
    point.lat >= box.south &&
    point.lat <= box.north &&
    point.lng >= box.west &&
    point.lng <= box.east
  );
}

function positionsOfFeature(feature: OsmFeature): LatLng[] {
  if (feature.type === "node") return [feature.position];
  if (feature.type === "way") return [...feature.geometry];
  return feature.members.flatMap((member) => [...(member.geometry ?? [])]);
}

/**
 * The features an Overpass query for `bbox` would return.
 *
 * Selection is by intersection and the geometry comes back WHOLE, which is what
 * `out geom` does: a way reaching out of the box is returned in full. That
 * detail is the reason the premise below holds at all.
 */
function featuresIn(features: readonly OsmFeature[], bbox: Bbox): OsmFeature[] {
  return features.filter((feature) => {
    const bounds = boundsOf(positionsOfFeature(feature));
    return bounds !== undefined && bboxesIntersect(bounds, bbox);
  });
}

function tileResult(
  tile: string,
  features: readonly OsmFeature[],
): OsmTileResult {
  return {
    tile,
    features,
    fetchedAt: 0,
    sourceId: `fixture:${tile}`,
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    skipped: [],
  };
}

describe("the premise: a fully covered chunk cannot change", () => {
  it("re-scores identically when an overlapping neighbour tile arrives", () => {
    // THE LOAD-BEARING CHECK. Everything the 91.3 % figure claims rests on this
    // one behaviour, so it is measured against real Cologne data rather than
    // argued from the Overpass docs.
    //
    // RES-9 TILES, not res-7, and that is a limitation worth naming: the corpus
    // fixture covers a ~365 m patch — exactly one res-9 cell's bbox — so no
    // res-7 neighbour's bbox reaches it. The INVALIDATION LOGIC does not look at
    // resolution, and adjacent-hexagon bbox overlap is self-similar across
    // resolutions, so the behaviour transfers even though the fixture cannot be
    // stretched to production scale.
    const site = loadSite("cologne-cathedral");
    const all = parseOverpassJson(site.payload).features;

    const tileA = site.tile;
    const boxA = cellBbox(tileA);

    const tileB = deepestNeighbour(tileA, boxA);
    expect(tileB).toBeDefined();
    if (tileB === undefined) return;
    const boxB = cellBbox(tileB);

    // SCORED FROM NEAR THE BOUNDARY, not from the site centre, because that is
    // when a neighbour tile is fetched at all — the working set has to reach
    // into B before anything asks for it. From the centre the radius-2 disc
    // stops ~100 m short of A's edge, and then no chunk is both "touched by B"
    // and "already fully covered by A", which is the pair this test is about.
    const position: LatLng = {
      lat: boxA.north - 0.0004,
      lng: site.centre.lng,
    };
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tileResult(tileA, featuresIn(all, boxA)));
    index.update(position, 4);

    // A chunk that (a) B's bbox touches, so `acceptTile` will drop it, and
    // (b) A's bbox already fully covers WITH the feature-selection margin, so
    // A's fetch already returned everything that can reach it.
    const candidates = index
      .scoredChunks()
      .map((scored) => scored.chunk)
      .filter((chunk) => {
        const raw = cellBbox(chunk);
        return (
          bboxesIntersect(boxB, raw) &&
          within(padBbox(raw, CHUNK_MARGIN_DEG), boxA)
        );
      });
    // Guards the guard: with no such chunk the assertions below are vacuous.
    expect(candidates.length).toBeGreaterThan(0);

    const before = new Map(
      candidates.map((chunk) => [chunk, index.chunk(chunk)?.cells]),
    );

    // THE CONTROL, and without it this test proves nothing. The corpus fixture
    // covers exactly A's bbox, so B would otherwise arrive carrying a SUBSET of
    // what A already delivered — every chunk in the index would come back
    // identical, fully covered or not, and the assertion below would pass on an
    // index that had simply ignored B. That is the fixture trap this package
    // keeps finding, so the instrument gets checked here rather than assumed.
    //
    // One synthetic way, placed in ground B covers and A does not, is the
    // smallest thing that makes a change detectable at all. It is deliberately
    // NOT in the overlap: a real neighbour cannot carry something A lacked
    // there, because both queries return the same elements over the same ground.
    // Just past A's edge on the scoring position's own meridian, so it is well
    // inside the radius-4 disc — and inside B, outside A, so B carrying it is
    // realistic rather than constructed.
    const outsideA: LatLng = { lat: boxA.north + 0.0002, lng: position.lng };
    expect(contains(boxB, outsideA)).toBe(true);
    expect(contains(boxA, outsideA)).toBe(false);
    const controlChunk = latLngToCell(
      outsideA.lat,
      outsideA.lng,
      SCORE_CHUNK_RES,
    );
    const d = 0.0002;
    const controlFeature: OsmFeature = {
      type: "way",
      id: 999_000_001,
      geometry: [
        { lat: outsideA.lat - d, lng: outsideA.lng - d },
        { lat: outsideA.lat - d, lng: outsideA.lng + d },
        { lat: outsideA.lat + d, lng: outsideA.lng + d },
        { lat: outsideA.lat - d, lng: outsideA.lng - d },
      ],
      tags: { leisure: "park" },
    };
    // The control chunk must NOT be one of the fully-covered ones, or the two
    // halves of this test would be asserting opposite things about it.
    expect(candidates).not.toContain(controlChunk);

    const invalidated = index.acceptTile(
      tileResult(tileB, [...featuresIn(all, boxB), controlFeature]),
    );

    // The rule under investigation really does throw these away.
    for (const chunk of candidates) {
      expect(invalidated).toContain(chunk);
    }

    // Wide enough to reach the control chunk, which sits outside A entirely.
    index.update(position, 4);

    // THE CONTROL FIRES: ground only B covers really does get new scores, so the
    // comparison below is capable of seeing a difference.
    expect(index.chunk(controlChunk)?.cells.length ?? 0).toBeGreaterThan(0);

    // AND THE WORK WAS WASTED: every fully-covered chunk comes back with the
    // same scores it had. Compared by value rather than by identity — `publish`
    // freezes a fresh object each time, so identity would fail for a correct
    // result.
    for (const chunk of candidates) {
      expect(index.chunk(chunk)?.cells).toStrictEqual(before.get(chunk));
    }
  });
});

describe("the magnitude, at production resolution", () => {
  it("shows 9 of 10 invalidated chunks already fully covered", () => {
    // PURE GEOMETRY, no data needed — which is why it can run at res 7 where the
    // fixture cannot. It counts what `acceptTile` would drop and how much of
    // that the premise above says cannot change.
    //
    // The two figures per neighbour are 58 % and 96–98 %, and the split is
    // structural rather than noise: a hexagon's bbox meets two of its neighbours
    // only near a corner and the other four along an edge.
    //
    // INTERSECTION IS TESTED UNPADDED AND CONTAINMENT PADDED, which is not an
    // inconsistency — it is what the two questions are. `acceptTile` drops a
    // chunk on the raw bbox, so that is what "invalidated" must count; a chunk's
    // score can draw on features up to the margin outside it, so that is what
    // "already covered" must require. Padding both (the first cut of this
    // measurement did) inflates the invalidated count to 1 318 and the ratio to
    // 92.4 % — measuring a rule the code does not have.
    const tileA = latLngToCell(50.9413, 6.9583, 7);
    const boxA = cellBbox(tileA);
    const chunkBoxes = cellToChildren(tileA, SCORE_CHUNK_RES).map((chunk) =>
      cellBbox(chunk),
    );
    expect(chunkBoxes.length).toBe(2401);

    let invalidated = 0;
    let unchangeable = 0;
    for (const neighbour of gridDisk(tileA, 1)) {
      if (neighbour === tileA) continue;
      const boxB = cellBbox(neighbour);
      for (const box of chunkBoxes) {
        if (!bboxesIntersect(boxB, box)) continue;
        invalidated += 1;
        if (within(padBbox(box, CHUNK_MARGIN_DEG), boxA)) unchangeable += 1;
      }
    }

    // The absolute counts are pinned so a change in H3 geometry or in the margin
    // shows up here rather than silently moving a figure two documents quote.
    expect(invalidated).toBe(1084);
    expect(unchangeable).toBe(990);
    expect(unchangeable / invalidated).toBeGreaterThan(0.9);
  });
});
