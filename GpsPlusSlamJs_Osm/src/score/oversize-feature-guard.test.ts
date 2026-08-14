/**
 * What bounds `scoreChunks` when a feature is larger than the map?
 *
 * WHY THIS TEST EXISTS. `buildFeatureIndex` carries an explicit oversize guard —
 * `MAX_CELLS_PER_FEATURE` with `estimateCellCount` in front of it — and its
 * docstring says why: unbounded covering "fails two different ways on real
 * data", a merely-huge feature grinding (measured there: an unrestricted index
 * over the building-block fixture did not finish in TEN MINUTES) and a
 * genuinely continental one THROWING out of `polygonToCellsExperimental`.
 *
 * `AffordanceIndex.scoreChunks` is the path production actually runs, and it
 * does **not** go through `buildFeatureIndex`. It clips each feature to the
 * batch's union bounding box and calls `coverCells` directly — no estimate, no
 * budget, no `failed` list. Nothing had ever fed it an oversize feature: the
 * bench and the index tests use `park`, `street-corner` and `building-block`,
 * while `beach` — a single relation holding the entire North Sea, and per
 * `testdata/README.md` a shape that "will recur on every coastal tile" — was
 * only ever pointed at the guarded path. The absence was invisible by
 * construction, which is the only reason it is worth a test.
 *
 * ## The answer: the CLIP is the bound, and it holds
 *
 * Measured 2026-08-13 on the `beach` fixture (i7-1185G7). Scoring a radius-4
 * disc around the fixture centre with the North Sea as the only feature:
 *
 * - the batch's selection box is **488 m** across, ~131 000 m² of chunk against
 *   ~238 000 m² of box — a ratio of **1.812**, which is what a hexagonal disc's
 *   bounding box plus a shared margin costs, and is the amortisation
 *   `scoreChunks` claims in as many words;
 * - that box holds **5 417** res-13 cells. Covering the North Sea clipped to it
 *   produces **4 409** — the coast crosses the box, so the water is ~81 % of it
 *   — of which **2 177** land in a scored chunk and are kept;
 * - `update` completes in **93 ms**, geometry converted once.
 *
 * The three cell counts are different quantities and an earlier draft of this
 * header used one figure for all of them. 5 417 is the box's CAPACITY, 4 409 is
 * the cover actually computed (`stats.cellsCovered`), 2 177 is what survives the
 * per-chunk filter. Only the middle one is work done and then discarded.
 *
 * So the guard's absence is survivable **because the clip is doing the guard's
 * job**, not because the case cannot arise. That distinction is the finding:
 * the bound is a consequence of the scored disc's size, and nothing states it.
 *
 * ## A retracted figure, recorded rather than quietly fixed
 *
 * The first version of this file computed the box's cell count against
 * **0.895 m²** and reported 265 726 res-13 cells and a ~89× waste ratio. That
 * is the res-**15** average area; res 13 is `AFFORDANCE_CELL_AREA_M2` = 43.9 m².
 * The real count is ~5 400 and the real ratio ~1.8×, so the alarming version of
 * this test was wrong by 49× and its conclusion — an unguarded blow-up on the
 * live path — does not hold. Kept here because the mistake is one step from
 * repeatable: the H3 area table shifts by two resolutions between "cells per
 * chunk" (49) and "area per cell", and 49 is also the ratio being looked for.
 *
 * ## What is NOT settled
 *
 * `ensureScored` takes an arbitrary cell set and hands all of it to one
 * `planBatch`, so its selection box grows with the batch's SPREAD while the
 * useful output grows with its chunk COUNT. The geo-event reach is seeded
 * across an event tile and its admitted neighbours, so that box can be
 * kilometres rather than metres, and the ~1.8× above is a property of the disc
 * rather than of the batching. Not measured here — it needs a fixture holding
 * several adjacent fetch tiles, because `ensureScored` refuses any chunk whose
 * fetch tile is not held and a single-tile fixture therefore scores nothing.
 * See the follow-up doc.
 *
 * @see affordance-index.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";

import { AffordanceIndex, selectionBoxFor } from "./affordance-index.js";
import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import { type Bbox } from "../spatial/clip.js";
import {
  AFFORDANCE_CELL_AREA_M2,
  RES13_CELLS_PER_CHUNK,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  scoreWorkingSet,
} from "../spatial/resolutions.js";
import { snapshotRuleTable } from "../rules/rule-table-loader.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { loadFixture } from "../test-utils/load-fixtures.js";
import type { OsmTileResult } from "../source/osm-data-source.js";

const METRES_PER_DEGREE = 111_320;

/** Average area of one res-11 scoring chunk — 49 res-13 children. */
const CHUNK_AREA_M2 = AFFORDANCE_CELL_AREA_M2 * RES13_CELLS_PER_CHUNK;

const table = snapshotRuleTable();

function beachTile(): {
  tile: OsmTileResult;
  centre: { lat: number; lng: number };
} {
  const fixture = loadFixture("beach");
  const parsed = parseOverpassJson(fixture.payload);
  return {
    tile: {
      tile: fixture.tile,
      features: parsed.features,
      fetchedAt: fixture.capturedAt,
      sourceId: "test",
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: [],
    },
    centre: fixture.centre,
  };
}

function areaM2(box: Bbox): number {
  const midLat = ((box.north + box.south) / 2) * (Math.PI / 180);
  const height = (box.north - box.south) * METRES_PER_DEGREE;
  const width = (box.east - box.west) * METRES_PER_DEGREE * Math.cos(midLat);
  return Math.abs(height * width);
}

describe("scoring a feature larger than the batch", () => {
  it("has a continental feature in the corpus at all, or nothing below is tested", () => {
    // Why this test matters: it is the control. Everything here is only
    // interesting if `beach` genuinely holds a feature no bounded cover can
    // handle, and unrestricted `buildFeatureIndex` is the existing, documented
    // detector for exactly that — it RECORDS the refusal rather than throwing,
    // which is the contract this test relies on to stay fast.
    const { tile } = beachTile();

    const index = buildFeatureIndex(tile.features);

    expect(
      index.failed.filter((failure) => failure.reason === "coverage-too-large")
        .length,
    ).toBeGreaterThan(0);
    // One element, per `testdata/README.md` — the payload IS the North Sea.
    expect(tile.features.length).toBe(1);
  });

  it("scores it on the UNGUARDED path, because the clip bounds the cover", () => {
    // Why this test matters: `AffordanceIndex` reaches `coverCells` with no
    // estimate in front of it, so what keeps the call finite is only the clip
    // to the batch's box. This pins that the arrangement works AND that it is
    // the clip doing it — a change that widens the batch has to come past here.
    const { tile, centre } = beachTile();
    const index = new AffordanceIndex({ table });
    index.acceptTile(tile);

    index.update(centre, SCORE_DISK_MAX_RADIUS);

    // Real coverage, not an empty result that would pass for the wrong reason:
    // the fixture centre is on the Sylt coast, so most of the disc is water.
    const cells = index
      .scoredChunks()
      .reduce((total, chunk) => total + chunk.cells.length, 0);
    expect(cells).toBeGreaterThan(1_000);

    // Converted ONCE despite 61 chunks in the batch — the geometry cache is
    // what makes a 1 MB multipolygon affordable at all.
    expect(index.stats.geometryBuilt).toBe(1);

    // THE ACTUAL CLAIM, and until the r514 review it was the one thing here
    // that nothing checked. Every assertion above counts cells that were KEPT,
    // and kept cells are capped at 61 x 49 = 2 989 by construction — the
    // per-chunk filter in `distribute` enforces that with or without the clip.
    // Delete the clip and all of them still pass; the only signal left is the
    // suite grinding, which is the failure mode this file exists NOT to rely on.
    //
    // `cellsCovered` is the input side of that filter, so it sees the cover
    // itself. A continental feature clipped to a ~488 m box is a few thousand
    // res-13 cells; unclipped it is the whole North Sea and this number would
    // be astronomically larger — or `polygonToCellsExperimental` would throw.
    // Measured 4 409, against 2 177 kept and a box that holds 5 417. Pinned to
    // the same tightness as the geometry below and for the same reason: it is
    // deterministic, so a wide window would only hide what it exists to catch.
    expect(index.stats.cellsCovered).toBeGreaterThan(4_000);
    expect(index.stats.cellsCovered).toBeLessThan(5_000);
  });

  it("pays ~1.8x for the batch's bounding box, which is the claimed amortisation", () => {
    // Why this test matters: `scoreChunks` argues that padding the UNION once
    // beats padding each chunk, and that the leftover waste is small. This is
    // that claim as a number, and it is pure H3 geometry — no clock — so it can
    // be a gate line where a wall-clock ratio would only flake.
    const { centre } = beachTile();
    const chunks = scoreWorkingSet(
      latLngToCell(centre.lat, centre.lng, SCORE_CHUNK_RES),
      SCORE_DISK_MAX_RADIUS,
    );

    // THE REAL `planBatch` BOX, not a copy of it (r514 review). This test had
    // its own transcription of the union loop and of `CHUNK_MARGIN_DEG`, which
    // meant the one production knob the ratio is meant to guard was invisible
    // to it: raise the margin to 0.002 and the real box grows ~2.8x in area
    // while a private 0.0005 keeps reporting 1.8 and passing.
    const boxArea = areaM2(selectionBoxFor(chunks));
    const chunkArea = chunks.length * CHUNK_AREA_M2;
    const covered = boxArea / AFFORDANCE_CELL_AREA_M2;

    // A hexagonal disc's bounding box plus one shared margin. **Pinned tightly
    // rather than bracketed**, because this is H3 geometry at a fixed place
    // with no clock in it — the measured value is 1.82 and it is reproducible,
    // so a wide window would only hide the regression the number exists to
    // catch. Under 1 would mean the box no longer contains its chunks; over
    // ~1.9 would mean the margin had stopped being amortised.
    expect(boxArea / chunkArea).toBeGreaterThan(1.7);
    expect(boxArea / chunkArea).toBeLessThan(1.9);

    // And in the units the cover is paid in. **This figure IS the header's
    // retraction** — the first version of this test computed 265 726 against a
    // res-15 cell area — so it is pinned to the decade it actually occupies
    // rather than to a bound that would have admitted the wrong answer too.
    //
    // Not implied by the ratio above, despite being algebraically derived from
    // the same two quantities: the ratio fixes `boxArea / chunkArea`, while
    // this fixes `boxArea` against the res-13 cell area, so a wrong
    // `AFFORDANCE_CELL_AREA_M2` — the exact mistake being retracted — moves
    // this and leaves the ratio untouched.
    expect(covered).toBeGreaterThan(5_000);
    expect(covered).toBeLessThan(6_000);
    // The disc's own cells, for scale: the cover is ~1.8x what can be kept.
    expect(covered).toBeGreaterThan(chunks.length * RES13_CELLS_PER_CHUNK);
  });
});
