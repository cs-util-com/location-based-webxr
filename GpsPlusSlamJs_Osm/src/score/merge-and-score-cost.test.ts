/**
 * Stages 3 and 4 — merge and score — at realistic feature density.
 *
 * WHY THIS EXISTS. `demo-pipeline.ts` predicts that stage 3 grows quadratically
 * across a session: `acceptTile` re-merges every tile ever held, and tiles are
 * never evicted. The derive-growth walk measured `mergeMs` at 0–4 ms and that
 * reading was **worthless** — its synthetic tile carried ~60 features against a
 * real res-7 tile's tens of thousands, so it was a fixture too small to exercise
 * the thing being predicted, not evidence against it. This is the measurement
 * that walk explicitly could not make.
 *
 * ## The prediction is structural, so the measurement is about the CONSTANT
 *
 * `mergeTiles` walks every feature of every held tile on every call, and
 * `acceptTile` then makes two more full passes over the merged map to drop
 * changed geometry. So the Nth accept costs O(N·F) and a session of N accepts
 * costs O(N²·F) — that is not a hypothesis, it is what the loops say. What
 * nobody knew is whether the constant makes it matter.
 *
 * ## Measured, 2026-08-13, `f936c64e` (i7-1185G7)
 *
 * Real Cologne corpus features (1 281 per tile), re-keyed per tile so each tile
 * carries distinct elements — which is what adjacent ground actually holds, and
 * the conservative choice: shared elements would collapse in the map and make
 * merging cheaper. Accepting eight tiles:
 *
 * | nth accept | features held | mergeMs |
 * | ---: | ---: | ---: |
 * | 1 | 1 281 | 0.6 |
 * | 2 | 2 562 | 1.4 |
 * | 4 | 5 124 | 4.0 |
 * | 6 | 7 686 | 5.8 |
 * | 8 | 10 248 | 7.8 |
 *
 * **The eighth accept costs 13× the first**, cumulative 33 ms, and the cost per
 * held feature stays flat at 0.47–0.76 µs. Flat per-feature cost is the cleanest
 * statement of the defect: the problem is the re-walking, not any per-item
 * inefficiency, so the lever is eviction or incremental merge rather than
 * micro-optimisation.
 *
 * ## The extrapolation is measured, not assumed
 *
 * The corpus fixture covers a 365 × 353 m patch = 0.129 km²; the res-7 tile
 * containing it measures 2 554 × 2 465 m = 6.30 km², **49× the area**. So every
 * statement about a real tile is an extrapolation, and extrapolating from one
 * density would be arithmetic on a single point. At 3× density the eighth accept
 * measured 23.6 ms against 7.8 — a ratio of 3.03, i.e. **linear in features per
 * tile**, which is what licenses multiplying up:
 *
 * - ~62 500 features in a real res-7 tile at this density,
 * - **~47 ms for the first accept and ~380 ms for the eighth**,
 * - **~1.7 s cumulative** over an eight-tile session.
 *
 * On the same worker thread as derive, whose own plateau is ~1.1 s per refresh.
 *
 * **The density is a city-centre one.** Cologne Cathedral is about as dense as
 * German OSM gets, and a whole res-7 tile is not uniformly that dense, so 62 500
 * is a ceiling rather than a typical figure.
 *
 * @see affordance-index.ts.md
 * @see ../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-13-1430-derive-growth-over-a-walk-findings.md
 */

import { describe, expect, it } from "vitest";
import { gridDisk, latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import type { OsmFeature } from "../model/osm-feature.js";
import type { OsmTileResult } from "../source/osm-data-source.js";

const TABLE = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "snapshot",
  fetchedAt: 0,
});

const SITE = loadSite("cologne-cathedral");
const CORPUS: readonly OsmFeature[] = parseOverpassJson(SITE.payload).features;

/**
 * How many res-7 tiles a session accumulates before this stops being academic.
 *
 * Eight is a modest walk: the derive-growth run reached four in 3 km, and the
 * demo's prefetch ring pulls the six neighbours of whatever tile the user is
 * standing in, so eight is one ring plus a step.
 */
const TILES = 8;

/** Real res-7 cells, so the ids are the shape production uses. */
const TILE_IDS = gridDisk(
  latLngToCell(SITE.centre.lat, SITE.centre.lng, 7),
  2,
).slice(0, TILES);

/**
 * One tile's worth of features, re-keyed so it holds DISTINCT elements.
 *
 * `featureKey` is type + id, so offsetting the id is what makes tile K's copy a
 * different element from tile 0's. Adjacent ground genuinely holds different
 * elements; the bbox overlap shares some, and sharing only makes merging
 * cheaper because the map collapses them. Distinct is therefore the honest
 * worst case rather than an inflated one.
 */
function tileFeatures(index: number, copies: number): OsmFeature[] {
  const out: OsmFeature[] = [];
  for (let copy = 0; copy < copies; copy++) {
    const offset = (index * copies + copy + 1) * 10_000_000;
    for (const feature of CORPUS) {
      out.push({ ...feature, id: feature.id + offset });
    }
  }
  return out;
}

function tileResult(
  tile: string,
  features: readonly OsmFeature[],
): OsmTileResult {
  return {
    tile,
    features,
    fetchedAt: 0,
    sourceId: `synthetic:${tile}`,
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    skipped: [],
  };
}

interface Accept {
  readonly nth: number;
  readonly mergeMs: number;
  readonly featuresHeld: number;
}

/** Accepts `TILES` tiles of `copies`× corpus density, timing each accept. */
function acceptRun(copies: number): Accept[] {
  const index = new AffordanceIndex({ table: TABLE });
  const accepts: Accept[] = [];
  let featuresHeld = 0;
  for (let nth = 0; nth < TILES; nth++) {
    const tile = TILE_IDS[nth];
    if (tile === undefined) throw new Error("not enough tile ids");
    const features = tileFeatures(nth, copies);
    featuresHeld += features.length;
    const started = performance.now();
    index.acceptTile(tileResult(tile, features));
    accepts.push({
      nth: nth + 1,
      mergeMs: performance.now() - started,
      featuresHeld,
    });
  }
  return accepts;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("stage 3 — merge, across a session", () => {
  // NO WALL-CLOCK ASSERTIONS IN THIS FILE, and that is a deliberate reversal.
  // The first version asserted timing RATIOS — last accept > 2× the first, and
  // so on — and flaked on its second gate run. It was the wrong instrument in
  // the wrong package: `config/vitest.config.ts` carries a long note recording
  // five files that timed out under contention and passed when re-run alone,
  // and putting a clock comparison in a gate here is volunteering for exactly
  // that. The timings are recorded in this file's header and in the findings
  // doc, from a run on a quiet machine.
  //
  // What is asserted instead is the COUNT, which is deterministic and is what
  // the defect actually is: the Nth accept re-merges N tiles' worth of features.

  it("re-merges everything held, so the Nth accept walks N tiles", () => {
    // THE PREDICTION `demo-pipeline.ts` MAKES AND NOTHING HAD TESTED, stated as
    // a count rather than a duration. `mergedFeatures` after N accepts holds
    // N × F entries, and `mergeTiles` walks all of them on every call — so the
    // work is quadratic in tiles visited whatever the machine is doing.
    const index = new AffordanceIndex({ table: TABLE });
    const held: number[] = [];
    for (let nth = 0; nth < TILES; nth++) {
      const tile = TILE_IDS[nth];
      if (tile === undefined) throw new Error("not enough tile ids");
      index.acceptTile(tileResult(tile, tileFeatures(nth, 1)));
      held.push(index.mergedFeatures().size);
    }

    expect(held[0]).toBe(CORPUS.length);
    expect(held.at(-1)).toBe(CORPUS.length * TILES);
    // Strictly monotonic: nothing is ever dropped, which is the half of the
    // pipeline that has no cap. Scoring is bounded by `maxRetainedChunks`; the
    // tile map and the merged feature map are not, and that asymmetry is why
    // derive plateaus and merge does not.
    for (let i = 1; i < held.length; i++) {
      expect(held[i]).toBeGreaterThan(held[i - 1] ?? 0);
    }
  });

  it("scales the merged set with features per tile, licensing the extrapolation", () => {
    // The corpus patch is ~1/49 of a res-7 tile, so every statement about real
    // tiles is an extrapolation. This pins the input side of it — 3× the
    // features per tile really is 3× the merged set, so the recorded 3.03×
    // timing ratio is measuring what it claims to.
    const index = new AffordanceIndex({ table: TABLE });
    for (let nth = 0; nth < TILES; nth++) {
      const tile = TILE_IDS[nth];
      if (tile === undefined) throw new Error("not enough tile ids");
      index.acceptTile(tileResult(tile, tileFeatures(nth, 3)));
    }

    expect(index.mergedFeatures().size).toBe(CORPUS.length * 3 * TILES);
  });
});

describe("stage 4 — score, at real corpus density", () => {
  it("scores a full working set from real data, and reports what it cost", () => {
    // The one stage the fixture can measure DIRECTLY rather than by
    // extrapolation: scoring cost depends on the features intersecting the
    // working set, which is a LOCAL quantity, and the corpus patch has real
    // local density by construction.
    //
    // Asserted as "it did the work", not as a duration — the number belongs to
    // the machine and lives in the findings doc. What would break this is
    // scoring silently covering nothing, which is the failure that makes every
    // timing figure meaningless.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tileResult(SITE.tile, CORPUS));

    const result = index.update(SITE.centre, 2);
    // The widening ring, because a refresh publishes three of them and the
    // first one is not what a move costs.
    const widened = index.update(SITE.centre, 4);

    // Measured 2026-08-13 on a quiet machine: **185 ms** for the radius-2 disc
    // of 19 chunks and **225 ms** to widen to radius 4 (42 more chunks). The
    // derive-growth walk's synthetic field read 40–190 ms for the WHOLE
    // widening, so real density is several times more expensive — which is
    // exactly what that run said it could not speak to.
    //
    // The durations are recorded, not asserted, for the reason at the top of the
    // merge describe: a clock comparison in this package's gate is a flake
    // waiting for a loaded machine.
    expect(result.scored).toHaveLength(19);
    expect(widened.scored).toHaveLength(42);
    expect(index.scoresByCell().size).toBeGreaterThan(900);
  });

  it("re-scores nothing when the user has not moved", () => {
    // The `oldUserTile` short-circuit, which is what makes the per-move cost the
    // MARGINAL working set rather than the whole disc. Without it the quadratic
    // above would be joined by a second one.
    const index = new AffordanceIndex({ table: TABLE });
    index.acceptTile(tileResult(SITE.tile, CORPUS));
    index.update(SITE.centre, 2);

    const second = index.update(SITE.centre, 2);

    expect(second.scored).toHaveLength(0);
  });
});

describe("the recorded curve", () => {
  it("still produces timings, even though none of them are asserted", () => {
    // The measuring apparatus is kept and exercised, so the numbers in the
    // header can be reproduced by re-running this file — but nothing here
    // compares a duration against another duration. See the note at the top of
    // the merge describe for why that reversal happened.
    //
    // `mean` exists for the same reason: reading the curve by hand is what the
    // header table came from.
    const single = acceptRun(1);
    const perFeatureUs = single.map(
      (accept) => (accept.mergeMs * 1000) / accept.featuresHeld,
    );

    expect(single).toHaveLength(TILES);
    // FINITE, not positive (r513 review). `> 0` is still a clock comparison:
    // on a machine with a coarse timer every accept can round to 0 ms, and the
    // mean is then exactly 0 — a red gate that says nothing about the code.
    // What this test is for is that the apparatus produces real numbers.
    expect(perFeatureUs).toHaveLength(TILES);
    expect(perFeatureUs.every((value) => Number.isFinite(value))).toBe(true);
    expect(mean(perFeatureUs)).toBeGreaterThanOrEqual(0);
  });
});
