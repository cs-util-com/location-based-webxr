/**
 * Does stage 5 — derive — grow without bound as the user walks? (AR §2.8)
 *
 * WHY THIS TEST EXISTS. The AR plan predicts that `scoresByCell` and therefore
 * `deriveMs` grow across a long session, and milestone 4 declined to measure it
 * on the grounds that a phone was unavailable. That was wrong, and the r510
 * review said so: the derive path is pure JS over data a stub source can
 * produce, `deriveMs` is already a snapshot field, and `pipeline-timings.test.ts`
 * already drives a `DemoPipeline` headlessly. **It needs a loop, not a walk.**
 * This is that loop, and it is the one M4 figure the environment could always
 * have produced.
 *
 * ## The answer
 *
 * **Derive is bounded, and the bound is the chunk cap, not the distance walked.**
 * `DEFAULT_MAX_CHUNKS` is 488 retained res-11 chunks and a chunk holds 49 res-13
 * children, so `scoresByCell` cannot exceed 23 912 entries however far anyone
 * walks. Measured at the production cap, 2026-08-13, on `f936c64e` (i7-1185G7),
 * walking 3 km north from Cologne in 100 m steps and running all three
 * progressive rings at each stop — the sum over the three rings, which is what
 * one user-visible move costs:
 *
 * | m walked | cells | deriveMs | evicted |
 * | ---: | ---: | ---: | ---: |
 * | 0 | 2 989 | 79 | 0 |
 * | 500 | 8 379 | 161 | 0 |
 * | 900 | 12 495 | 242 | 0 |
 * | 1 000 | 9 408 | 238 | 0 | ← second res-7 tile merged
 * | 1 500 | 14 357 | 278 | 0 |
 * | 2 000 | 18 326 | 390 | 0 |
 * | 2 500 | 23 275 | 1 230 | 0 |
 * | 2 600 | **23 912** | 1 108 | 12 |
 * | 2 900 | **23 912** | 1 193 | 73 |
 *
 * 23 912 is exactly 488 × 49, so the plateau is the cap and nothing else. **The
 * cost of reaching it is the finding**: ~1.1 s of derive per 100 m refresh,
 * against 79 ms at the first stop — a 14× rise over a walk. Bounded is not the
 * same as cheap, and §2.8 asked only the first question.
 *
 * **It is NOT a frame hitch, and the first draft of this comment said it was.**
 * `DemoPipeline` runs inside `worker/demo-worker.ts`, so the derive pass never
 * touches the render thread. What it actually costs is three other things:
 * the AR content lags the user by at least that much on every refetch, on top of
 * fetch and mesh time; the worker is serial, so nothing else it owns — cell
 * explanations, the geo-event search, the next ring — can be answered while it
 * runs; and on a phone a busy worker still competes with the render thread for
 * cores, so off-the-main-thread is not free. The figure is also desktop Node on
 * an i7; a phone will be slower.
 *
 * The per-cell cost is not flat either: 8.8 µs per cell per ring at the start
 * against 15 µs at the cap. Derive is a little worse than linear in the retained
 * set, which is worth knowing before anyone argues that halving the cap halves
 * the cost — it would do slightly better than that.
 *
 * ## The thing nobody predicted: a tile boundary flushes the cache
 *
 * At 1 000 m the retained set FELL, from 12 495 cells to 9 408, and the only
 * thing that happened was a second res-7 tile being merged. `acceptTile`
 * invalidates every chunk overlapping the accepted tile and a res-7 bounding box
 * is ~2.4 km across, so merging a neighbour discards scored ground the user has
 * already walked over. The next crossing at 2 000 m shows it again (18 473 →
 * 18 326); at 2 500 m the freshly scored ring more than replaced what was
 * dropped, so the net moved the other way — **the invalidation is what is
 * measured here, not its cost.** Its cost is a re-score, which lands in `scoreMs`,
 * which this fixture cannot measure (see below).
 *
 * It matters for AR because a walker at a 100 m gate crosses a res-7 boundary
 * every kilometre or two. Whether the invalidation could be narrower is an open
 * question this measurement raises and does not answer.
 *
 * ## What this run does NOT license
 *
 * **`mergeMs` and `scoreMs` are not measured here, and the table above omits
 * them deliberately.** Both scale with the FEATURES held, and the synthetic tile
 * below carries ~60 of them against a real res-7 tile's ~21 MB. Measured
 * `mergeMs` stayed at 0–4 ms across the walk, which would read as a refutation
 * of the quadratic merge growth `demo-pipeline.ts` predicts — it is nothing of
 * the kind, only a fixture too small to exercise it. That measurement is still
 * open.
 *
 * **`deriveMs` IS representative**, and that asymmetry is the whole argument for
 * the synthetic field. Stage 5 walks CELLS, and this field's cell coverage
 * matches the corpus almost exactly: `corpus-score-distribution.test.ts` scores
 * 927 cells at Cologne and 931 at Heidelberg over one radius-2 disk whose
 * geometric maximum is 19 × 49 = 931, i.e. **real city ground is essentially
 * fully covered**. A ground-covering polygon is therefore the faithful choice
 * rather than the convenient one, and the first assertion below pins that
 * calibration so a generator that drifts away from the corpus fails here instead
 * of quietly measuring itself.
 *
 * A corpus fixture could not have been used: it covers one res-7 tile, so a 3 km
 * walk leaves the data after a few hundred metres and every number afterwards
 * describes an empty map.
 *
 * ## Why the gate runs a SMALLER cap than the table above
 *
 * Reaching 488 chunks takes 2.6 km of walking and ~15 s, which would nearly
 * double this package's unit stage. The gate therefore walks against
 * {@link GATE_MAX_CHUNKS} — the same code, the same shape, a plateau in a few
 * steps. **To reproduce the table, set `GATE_MAX_CHUNKS` to `undefined` and
 * `STEPS` to 30.**
 *
 * @see demo-pipeline.ts.md
 */

import { describe, it, expect } from "vitest";
import { cellToBoundary } from "h3-js";
import {
  OVERPASS_SCHEMA_VERSION,
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  parseRuleTable,
  type LatLng,
  type OsmDataSource,
  type OsmFeature,
  type OsmTileResult,
} from "gps-plus-slam-osm";

import { DemoPipeline } from "./demo-pipeline.js";

/** The corpus site both measured score distributions were taken at. */
const COLOGNE: LatLng = { lat: 50.9413, lng: 6.9583 };

/** The AR refetch gate — `AR_REFRESH_DISTANCE_M` in `ar-walking.ts`. */
const STEP_M = 100;

/** Long enough to plateau at {@link GATE_MAX_CHUNKS}. 30 reproduces the table. */
const STEPS = 14;

/**
 * The cap the GATE walks against. `undefined` reproduces the recorded table.
 *
 * 120 rather than 488: it is still nearly two full radius-4 working sets, so
 * eviction is doing the same job it does in production, and the plateau arrives
 * after three steps instead of twenty-six.
 */
const GATE_MAX_CHUNKS: number | undefined = 120;

/** res-13 children per res-11 chunk — the multiplier on the chunk cap. */
const CELLS_PER_CHUNK = 49;

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * The rings one refresh actually publishes — `PROGRESSIVE_RADII`.
 *
 * Re-derived rather than imported, so a data-only test does not drag
 * `refresh-cycle.ts` and its store dependency in. Walking with only the narrow
 * ring would exercise a working set a third the size of the one the cap was
 * chosen against, which is the wrong question.
 */
const RINGS: readonly number[] = [
  SCORE_DISK_RADIUS,
  SCORE_DISK_RADIUS + 1,
  SCORE_DISK_MAX_RADIUS,
];

/**
 * Ground cover at factor 3, striped with industrial land at 0.2.
 *
 * Two rules rather than one, because a uniformly-scored field collapses to a
 * single connected component and `buildRegions` — part of stage 5 — would then
 * be measured on the one input it never sees. The stripes put roughly half the
 * ground below the identity threshold, which is the split the corpus histogram
 * shows (Cologne 43.7 % at exactly zero, Heidelberg 40.4 %).
 */
const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable",
    "leisure_park,leisure,park,3",
    "landuse_industrial,landuse,industrial,0.2",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

/** Stripe pitch in metres — several res-13 cells wide, so regions are chunky. */
const STRIPE_M = 40;

interface Bbox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

function bboxOf(tile: string): Bbox {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of cellToBoundary(tile)) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  // Padded, because a res-11 chunk near the edge is not contained by its res-7
  // ancestor's boundary — the H3 non-containment `resolutions.ts` documents.
  // Without the pad the corridor develops unscored seams, which would read as
  // the retained set shrinking rather than as a fixture artefact.
  const pad = 0.004;
  return {
    south: south - pad,
    west: west - pad,
    north: north + pad,
    east: east + pad,
  };
}

function rectangle(
  south: number,
  west: number,
  north: number,
  east: number,
): LatLng[] {
  return [
    { lat: south, lng: west },
    { lat: south, lng: east },
    { lat: north, lng: east },
    { lat: north, lng: west },
    { lat: south, lng: west },
  ];
}

/** One res-7 tile's ground: a park, striped with industrial bands. */
function featuresFor(tile: string): OsmFeature[] {
  const box = bboxOf(tile);
  let id = 1;
  const features: OsmFeature[] = [
    {
      type: "way",
      id: id++,
      geometry: rectangle(box.south, box.west, box.north, box.east),
      tags: { leisure: "park" },
    },
  ];
  const stripe = STRIPE_M / METRES_PER_DEGREE_LAT;
  for (let lat = box.south; lat < box.north; lat += 2 * stripe) {
    features.push({
      type: "way",
      id: id++,
      geometry: rectangle(
        lat,
        box.west,
        Math.min(lat + stripe, box.north),
        box.east,
      ),
      tags: { landuse: "industrial" },
    });
  }
  return features;
}

function syntheticSource(): OsmDataSource {
  return {
    attribution: "© OpenStreetMap contributors",
    sourceId: "synthetic",
    fetchTile: (tile): Promise<OsmTileResult> =>
      Promise.resolve({
        tile,
        features: featuresFor(tile),
        fetchedAt: 0,
        sourceId: "synthetic",
        schemaVersion: OVERPASS_SCHEMA_VERSION,
        skipped: [],
      }),
  };
}

function newPipeline(): DemoPipeline {
  return new DemoPipeline({
    source: syntheticSource(),
    table: TABLE,
    ...(GATE_MAX_CHUNKS === undefined ? {} : { maxChunks: GATE_MAX_CHUNKS }),
  });
}

interface Step {
  readonly metres: number;
  readonly cellCount: number;
  readonly deriveMs: number;
  readonly regions: number;
  readonly tilesHeld: number;
  readonly chunksEvicted: number;
}

/** Walks north from Cologne, running every progressive ring at each stop. */
async function walk(): Promise<Step[]> {
  const pipeline = newPipeline();
  const steps: Step[] = [];
  for (let index = 0; index < STEPS; index++) {
    const position: LatLng = {
      lat: COLOGNE.lat + (index * STEP_M) / METRES_PER_DEGREE_LAT,
      lng: COLOGNE.lng,
    };
    // SUMMED OVER THE RINGS, because all three are one user-visible move: what a
    // walking user pays per 100 m is the whole widening, not its last ring.
    let deriveMs = 0;
    let last;
    for (const radius of RINGS) {
      last = await pipeline.update(position, "walkable", undefined, radius);
      deriveMs += last.timings.deriveMs;
    }
    if (last === undefined) throw new Error("no ring ran");
    steps.push({
      metres: index * STEP_M,
      cellCount: last.cellCount,
      deriveMs,
      regions: last.regions.length,
      tilesHeld: last.timings.tilesHeld,
      chunksEvicted: pipeline.stats().chunksEvicted,
    });
  }
  return steps;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Walked once and shared, because the walk IS the expensive part. */
const WALK = await walk();

describe("derive cost over a walk (AR §2.8)", () => {
  it("covers the ground the corpus covers, or it is measuring itself", async () => {
    // THE CALIBRATION, and the reason a synthetic field is admissible evidence
    // at all. A radius-2 disk is 19 chunks, so 931 cells is its geometric
    // maximum; the corpus measures 927 at Cologne and 931 at Heidelberg. Equal
    // to the maximum here means full coverage, which is what real city ground
    // has. A generator that stopped covering would sink below this and would
    // then be reporting a sparser world than the one AR runs in.
    const first = await newPipeline().update(
      COLOGNE,
      "walkable",
      undefined,
      SCORE_DISK_RADIUS,
    );

    expect(first.cellCount).toBe(19 * CELLS_PER_CHUNK);
  });

  it("stops growing when the chunk cap starts evicting, not when the walk ends", () => {
    const last = WALK.at(-1);
    expect(last).toBeDefined();
    if (last === undefined) return;

    // THE WALK HAS TO REACH THE CAP, or everything below asserts a bound that
    // was never tested. This is the guard on the guard.
    expect(last.chunksEvicted).toBeGreaterThan(0);

    // AND THE CAP IS WHAT BOUNDS IT. `maxChunks` retained chunks x 49 children
    // is the ceiling on `scoresByCell`, and therefore on every stage-5 pass.
    const ceiling = (GATE_MAX_CHUNKS ?? 488) * CELLS_PER_CHUNK;
    for (const step of WALK) {
      expect(step.cellCount).toBeLessThanOrEqual(ceiling);
    }

    // FLAT, not merely bounded. Once eviction is running the retained set sits
    // AT the cap and stays there, so the plateau is a run of identical steps
    // rather than a slow climb towards one. Asserted as the longest such run,
    // because a tile-boundary flush interrupts it — see the next test.
    const counts = WALK.map((step) => step.cellCount);
    expect(Math.max(...counts)).toBe(ceiling);
    let longest = 0;
    let run = 0;
    for (const count of counts) {
      run = count === ceiling ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it("throws the scored cache away when a new res-7 tile arrives", () => {
    // FOUND BY THIS MEASUREMENT, predicted by nothing. `acceptTile` invalidates
    // every chunk that overlaps the accepted tile, and a res-7 tile's bounding
    // box is ~2.4 km across — so merging a neighbour discards scored chunks well
    // inside ground the user has already covered, and the retained set falls off
    // the cap it had just reached.
    //
    // It matters for AR specifically: at a 100 m refetch gate a walker crosses a
    // res-7 boundary every kilometre or two, and the discarded chunks have to be
    // scored again. At the production cap the drop measured 12 495 -> 9 408
    // cells; here, where the retained corridor is smaller and sits closer to the
    // boundary, the whole cache goes.
    //
    // **The invalidation is what is asserted, not its cost.** That cost lands in
    // `scoreMs`, which this fixture cannot measure — see the header.
    //
    // Asserted rather than logged so that making the invalidation narrower — the
    // obvious fix — fails here and has to be looked at deliberately.
    const crossing = WALK.findIndex(
      (step, index) =>
        index > 0 && step.tilesHeld > (WALK[index - 1]?.tilesHeld ?? 0),
    );
    expect(crossing).toBeGreaterThan(0);

    const before = WALK[crossing - 1];
    const after = WALK[crossing];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;

    expect(after.cellCount).toBeLessThan(before.cellCount);
  });

  it("keeps DERIVE flat across the plateau, which is the §2.8 question", () => {
    // The retained set is capped, so stage 5's input is capped, so stage 5 is
    // capped. Asserted as a ratio rather than a millisecond figure because the
    // absolute cost belongs to the machine — the recorded 3 km table in the
    // header is where those live. 2x is deliberately generous: it is here to
    // catch UNBOUNDED growth, and a tighter bound on a timing measurement is a
    // flake generator.
    const third = Math.floor(STEPS / 3);
    const middle = WALK.slice(third, 2 * third).map((step) => step.deriveMs);
    const end = WALK.slice(2 * third).map((step) => step.deriveMs);

    expect(mean(end)).toBeLessThan(mean(middle) * 2);
  });

  it("still finds structure to derive, so the plateau is not an empty map", () => {
    // A field that scored nothing above the threshold would give a flat derive
    // cost too, and for the wrong reason: `cellsAboveThreshold` returns an empty
    // array and `buildRegions` walks nothing. The stripes exist to prevent that,
    // and this asserts they worked.
    const last = WALK.at(-1);
    expect(last).toBeDefined();
    if (last === undefined) return;

    expect(last.regions).toBeGreaterThan(1);
    // And the walk genuinely left its starting tile, so eviction is being driven
    // by ground covered rather than by one tile being re-scored.
    expect(last.tilesHeld).toBeGreaterThan(1);
  });
});
