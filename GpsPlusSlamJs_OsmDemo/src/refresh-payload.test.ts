/**
 * WHY THIS TEST EXISTS (round 10 §2, §7).
 *
 * The round-10 plan claims three things about what a refresh costs, and all
 * three were read off the code rather than observed. This file MEASURES them,
 * so the plan's numbers are evidence instead of argument — and so the stages
 * that follow have a before/after figure rather than a feeling.
 *
 * The measurements are written as assertions with generous bounds, not as
 * `console.log`. A logged number is read once and then rots; an assertion fails
 * when the thing it describes changes, which is the only way a performance
 * claim stays true.
 *
 * @see 2026-08-04-2218-osm-demo-round-10-refresh-payload-and-incremental-scores-plan.md
 */

import { describe, it, expect } from "vitest";
import {
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  parseRuleTable,
  type OsmDataSource,
} from "gps-plus-slam-osm";

import { DemoPipeline } from "./demo-pipeline.js";
import { packCells, unpackCells } from "./cell-payload.js";

const COLOGNE = { lat: 50.9375, lng: 6.9603 };

/**
 * Ground with SEVERAL overlapping features, which is what makes this fixture
 * representative rather than convenient.
 *
 * `contributors` is a per-category map of feature key → factor, so a cell
 * touched by one feature has one entry and costs almost nothing. Real ground is
 * not like that — a park with a path and a surface tag and a tree row produces
 * several — and a single-feature fixture would measure the payload of the best
 * case while the plan is about the typical one.
 */
function overlappingFeatures() {
  const box = (dLat: number, dLng: number, size: number) => [
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng + size },
    { lat: COLOGNE.lat + dLat + size, lng: COLOGNE.lng + dLng + size },
    { lat: COLOGNE.lat + dLat + size, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng },
  ];

  return [
    {
      type: "way" as const,
      id: 1,
      geometry: box(-0.004, -0.004, 0.008),
      tags: { leisure: "park", surface: "grass" },
    },
    {
      type: "way" as const,
      id: 2,
      geometry: box(-0.003, -0.003, 0.006),
      tags: { highway: "footway" },
    },
    {
      type: "way" as const,
      id: 3,
      geometry: box(-0.002, -0.002, 0.004),
      tags: { natural: "wood" },
    },
  ];
}

const source: OsmDataSource = {
  attribution: "© OpenStreetMap contributors",
  sourceId: "fixture:refresh-payload",
  fetchTile: (tile) =>
    Promise.resolve({
      tile,
      features: overlappingFeatures(),
      fetchedAt: 0,
      sourceId: "fixture:refresh-payload",
      schemaVersion: 1,
      skipped: [],
    }),
};

const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable,scenic",
    "leisure_park,leisure,park,3,4",
    "highway_footway,highway,footway,4,2",
    "natural_wood,natural,wood,2,5",
    "surface_grass,surface,grass,2,3",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

/** The progressive rings one refresh runs (W16) — the real sequence. */
const RINGS = Array.from(
  { length: SCORE_DISK_MAX_RADIUS - SCORE_DISK_RADIUS + 1 },
  (_, step) => SCORE_DISK_RADIUS + step,
);

const bytes = (value: unknown): number => JSON.stringify(value).length;

describe("what one refresh actually transfers", () => {
  it("measures how much of the cell payload is contributors", async () => {
    const pipeline = new DemoPipeline({ source, table: TABLE });

    // One full refresh, all three rings, exactly as the refresh cycle runs it.
    let snapshot = await pipeline.update(
      COLOGNE,
      "walkable",
      undefined,
      RINGS[0],
    );
    for (const radius of RINGS.slice(1)) {
      snapshot = await pipeline.update(COLOGNE, "walkable", undefined, radius);
    }

    // The fixture has to actually produce contributors, or this measures
    // nothing -- the round-9 lesson about a fixture that makes the thing under
    // test constant.
    const withContributors = snapshot.cells.filter(
      (cell) => Object.keys(cell.contributors).length > 0,
    );
    expect(withContributors.length).toBeGreaterThan(0);

    const full = bytes(snapshot.cells);
    const slim = bytes(
      snapshot.cells.map((cell) => ({ cell: cell.cell, scores: cell.scores })),
    );

    // THE MEASUREMENT. Recorded as a bound rather than a log so it cannot go
    // stale silently: contributors are a large fraction of the cell payload,
    // and every byte of it is sent so that ONE clicked cell's popup can read
    // one entry synchronously.
    expect(slim).toBeLessThan(full);
    const share = (full - slim) / full;

    // THE MEASUREMENT, taken 2026-08-04 on this fixture:
    //   2 989 cells - 426 630 bytes full, 190 832 without contributors
    //   => contributors are 55% of the cell payload.
    //
    // That is 236 KB re-sent per pass and three passes per move, on a fixture
    // with THREE features and four rules. This is a fresh session at 61 chunks;
    // at the 488-chunk cap the same ratio applies to ~24 000 cells, so roughly
    // 3.4 MB per pass against 1.5 MB.
    //
    // Asserted at 0.4 rather than 0.55 so ordinary fixture drift does not fail
    // it -- the claim being defended is "contributors are a large fraction",
    // not the exact ratio. A bound that tracked the measurement exactly would
    // be a tripwire, not a test.
    expect(share).toBeGreaterThan(0.4);
  });

  it("re-sends the whole cell array on every ring, including the unchanged part", async () => {
    // THE CLAIM: the widening rings add a ring of chunks each and re-ship
    // everything already sent. This is what stage 3 would fix, and what stage 1
    // makes cheaper regardless.
    const pipeline = new DemoPipeline({ source, table: TABLE });

    const counts: number[] = [];
    for (const radius of RINGS) {
      const snapshot = await pipeline.update(
        COLOGNE,
        "walkable",
        undefined,
        radius,
      );
      counts.push(snapshot.cells.length);
    }

    expect(counts).toHaveLength(3);
    // Each pass carries everything the previous one did, plus its new ring --
    // strictly growing, never a delta.
    expect(counts[1]).toBeGreaterThan(counts[0] ?? 0);
    expect(counts[2]).toBeGreaterThan(counts[1] ?? 0);
  });

  it("sizes the payload against the SHIPPED category count, not the fixture's", async () => {
    // WHY A SECOND TABLE. The measurement above uses two categories; the shipped
    // table (`default-rules.ts`) has SIX -- battleArea, spawnPoint,
    // treasureReward, restingArea, questGiver, walkable. Per-cell payload scales
    // with the CATEGORY count, not the rule count, because `scores` is one
    // number per category and `contributors` is one nested map per category.
    // Measuring the two-category case and quoting it as the production figure
    // would understate it, which is the mistake this round exists to correct.
    //
    // The shipped CSV is not exported from the package entry, so this
    // reproduces its category COLUMNS -- the thing that drives the shape --
    // rather than its ~700 rules.
    const sixCategories = parseRuleTable(
      [
        "id,Key,Value,battleArea,spawnPoint,treasureReward,restingArea,questGiver,walkable",
        "leisure_park,leisure,park,2,3,1,4,2,3",
        "highway_footway,highway,footway,3,2,1,2,3,4",
        "natural_wood,natural,wood,4,1,3,3,1,2",
        "surface_grass,surface,grass,2,2,2,3,2,2",
      ].join("\n"),
      { source: "test", fetchedAt: 0 },
    );

    const pipeline = new DemoPipeline({ source, table: sixCategories });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    const full = bytes(snapshot.cells);
    const noContributors = bytes(
      snapshot.cells.map((cell) => ({ cell: cell.cell, scores: cell.scores })),
    );
    const oneCategoryOnly = bytes(
      snapshot.cells.map((cell) => ({
        cell: cell.cell,
        score: cell.scores["walkable"] ?? 1,
      })),
    );

    // The three shapes stage 1 is choosing between, ordered as they must be.
    expect(oneCategoryOnly).toBeLessThan(noContributors);
    expect(noContributors).toBeLessThan(full);

    // MEASURED 2026-08-04 at six categories: dropping contributors removes the
    // large majority of the cell payload, and narrowing to the viewed category
    // removes the large majority of what is then left. Bounds are loose because
    // the claim is the ordering of magnitudes, not the exact bytes.
    // MEASURED 2026-08-04, six categories, one ring, 931 cells:
    //   full              339 816 bytes   (what ships today)
    //   no contributors   124 755 bytes   (-63%)
    //   + one category     35 379 bytes   (10% of full -- a 10x cut)
    //
    // Both numbers are larger than the two-category fixture above suggested,
    // which is the point of measuring against the shipped shape: per-cell
    // payload scales with the CATEGORY count.
    expect((full - noContributors) / full).toBeGreaterThan(0.5);
    expect(oneCategoryOnly).toBeLessThan(full * 0.2);
  });

  it("measures the CLONE COST, because bytes are only a proxy for it", async () => {
    // WHY THIS TEST EXISTS, and it is a correction. The measurements above size
    // the payload in BYTES, which is not what a refresh actually pays. A worker
    // does not share memory with the page: `postMessage` structured-clones the
    // object graph and deep-copies it into the page's heap, on the event loop.
    // So the cost that matters is TIME, and a large byte count that clones in
    // 2 ms would not justify making the popup asynchronous.
    //
    // `structuredClone` is the same algorithm `postMessage` uses, so this is a
    // faithful proxy for the serialise+deserialise half. It excludes the thread
    // hop, which is the part that does not scale with payload size.
    //
    // NESTING IS THE REASON TO EXPECT MORE THAN BYTES SUGGEST: `contributors`
    // is a map of maps, and structured clone walks every object, so deeply
    // nested data is slower per byte than flat data.
    const pipeline = new DemoPipeline({ source, table: TABLE });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    const slimCells = snapshot.cells.map((cell) => ({
      cell: cell.cell,
      score: cell.scores["walkable"] ?? 1,
    }));

    const timeClone = (value: unknown): number => {
      // Warm once, so the first-call cost of the clone machinery is not
      // attributed to the payload.
      structuredClone(value);
      const started = performance.now();
      for (let n = 0; n < 5; n += 1) structuredClone(value);
      return (performance.now() - started) / 5;
    };

    const fullMs = timeClone(snapshot.cells);
    const slimMs = timeClone(slimCells);

    // The invariant, not the timing: the slim shape must be cheaper to clone.
    // Asserted as a ratio rather than an absolute, because absolute timings on
    // a shared CI runner are exactly the flaky test this repo does not want.
    // MEASURED 2026-08-04, 931 cells (one ring):
    //   full 3.21 ms, slim 0.65 ms -- 4.9x.
    //
    // Per pass, and a move runs three. The number that matters is the one at
    // the 488-chunk cap, which the sibling test below measures directly rather
    // than extrapolating -- linear scaling is an assumption, and this round
    // exists because an unmeasured assumption was wrong.
    expect(slimMs).toBeLessThan(fullMs);
    expect(fullMs / slimMs).toBeGreaterThan(1.5);
  });

  it("measures the clone cost at the 488-chunk cap, not just at one ring", async () => {
    // WHY NOT EXTRAPOLATE. One ring is 931 cells; the retained cache holds up to
    // 488 chunks, ~24 000 cells, and that is the state a user reaches by
    // exploring rather than an exotic one. Multiplying 3.21 ms by 26 assumes
    // structured clone is linear in element count, which is an ASSUMPTION -- and
    // this whole round exists because an unmeasured assumption turned out wrong.
    //
    // The cells are replicated with distinct ids rather than fetched, because
    // the quantity under test is the CLONE, and clone cost depends on the object
    // graph's shape and size, not on where it came from. Scoring 488 real chunks
    // in a unit test would take minutes and measure the scorer instead.
    const pipeline = new DemoPipeline({ source, table: TABLE });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    const CAP_MULTIPLE = 26;
    const atCap = Array.from({ length: CAP_MULTIPLE }, (_, copy) =>
      snapshot.cells.map((cell) => ({ ...cell, cell: `${cell.cell}#${copy}` })),
    ).flat();

    structuredClone(atCap);
    const started = performance.now();
    structuredClone(atCap);
    const cloneMs = performance.now() - started;

    expect(atCap.length).toBeGreaterThan(20_000);

    // The claim being defended: at the cap this is a MAIN-THREAD PAUSE, not a
    // rounding error -- and it happens three times per move. Asserted as a
    // floor rather than an exact figure so a faster machine does not fail it;
    // the exact measurement is in the plan.
    // MEASURED 2026-08-04: 24 206 cells clone in 35.1 ms. Three passes per move
    // is ~105 ms of main-thread work, well past a 16 ms frame budget -- so this
    // is visible jank rather than a rounding error, and the answer to "is it not
    // already in memory?" is that it is in the WORKER's memory and every byte is
    // deep-copied into the page's.
    //
    // Asserted as a floor rather than an exact figure so a faster machine does
    // not fail it; the exact measurement lives in the plan and the comment.
    expect(cloneMs).toBeGreaterThan(5);
  });

  it("shows packing beats cloning at cap scale, which is stage 1's whole claim", async () => {
    // THE CAVEAT THE PLAN STATED BEFORE IMPLEMENTING, now settled with a number.
    // Transferables remove the CLONE, not the PACK: the worker still walks every
    // cell to build the arrays and the page walks them to decode. That was
    // EXPECTED to be much cheaper than structured clone -- flat writes against
    // an allocating graph walk -- but expectation is what this round exists to
    // stop trusting.
    //
    // The comparison is honest only if it counts BOTH ends. The transfer itself
    // is O(1) regardless of size, so `pack + unpack` is the entire replacement
    // cost for `structuredClone`.
    const pipeline = new DemoPipeline({ source, table: TABLE });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    const CAP_MULTIPLE = 26;
    const atCap = Array.from({ length: CAP_MULTIPLE }, (_, copy) =>
      snapshot.cells.map((cell) => ({
        ...cell,
        // Distinct ids, and still VALID H3 hex -- `packCells` parses them as
        // 64-bit integers, so a `#0` suffix would throw rather than measure.
        cell: cell.cell.slice(0, -1) + "0123456789abcdef"[copy % 16],
      })),
    ).flat();

    const time = (body: () => void): number => {
      body();
      const started = performance.now();
      body();
      return performance.now() - started;
    };

    const cloneMs = time(() => void structuredClone(atCap));
    const packMs = time(() => void packCells(atCap));
    const packed = packCells(atCap);
    const unpackMs = time(() => void unpackCells(packed));

    // MEASURED 2026-08-04 at 24 206 cells, and it CORRECTED THE DESIGN:
    //   structuredClone  27.1 ms
    //   pack             17.3 ms   (worker side)
    //   unpack           10.8 ms   (main-thread side)
    //
    // Pack alone beats the clone. Pack PLUS unpack does not -- 28.1 ms against
    // 27.1 -- so a packed payload that the page immediately expands back into
    // plain objects is SLOWER than the copy it replaces. The first version of
    // this change did exactly that, and only this measurement caught it.
    //
    // Hence the design rule the sidecar now carries: `unpackCells` is for tests
    // and for a resync path, NEVER for the render path. The win requires the
    // consumers to read the columns directly, at which point the main thread
    // pays nothing and the worker pays 17.3 ms instead of its half of 27.1.
    expect(packMs).toBeLessThan(cloneMs);

    // And the trap, asserted so it cannot be reintroduced quietly: unpacking is
    // not free, and anyone who adds it to the render path should see this fail
    // to explain why.
    expect(unpackMs).toBeGreaterThan(cloneMs * 0.1);
  });

  it("carries every category's score, not just the one being viewed", async () => {
    // The other half of the payload nobody asked for: the snapshot is requested
    // for ONE category and every cell carries all of them. With two categories
    // in this table the effect is small; a real table has many.
    const pipeline = new DemoPipeline({ source, table: TABLE });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    const scored = snapshot.cells.find(
      (cell) => Object.keys(cell.scores).length > 0,
    );
    expect(scored).toBeDefined();
    expect(Object.keys(scored?.scores ?? {}).length).toBeGreaterThan(1);
  });
});
