/**
 * `DemoSnapshot.timings` — stages 1–5 of a click, measured where they happen.
 *
 * Why these tests matter: the plan's deliverable is a RANKED breakdown of one
 * real click, and a ranking is only trustworthy if each stage's number is the
 * interval that belongs to it. `DemoPipeline.update` owns five of the nine
 * stages — fetch, parse, merge, score, derive — and they are easy to
 * mis-attribute in ways that produce a plausible ranking pointing at the wrong
 * stage, which is worse than no ranking because it gets acted on.
 *
 * The specific things pinned here:
 *
 *  - **Per-tile source timings are SUMMED, not sampled.** A working set is 1–3
 *    tiles; taking the last one's numbers would silently divide the fetch stage
 *    by the tile count near a boundary and nowhere else.
 *  - **Merge is separated from fetch even though `acceptTile` runs inside the
 *    fetch loop.** Stage 3 grows across a session (`this.tiles` never evicts),
 *    so it is the stage most likely to be the surprise, and burying it inside
 *    stage 1 would hide exactly that growth.
 *  - **A source that does not measure is COUNTED, not assumed zero.** A
 *    fixture-backed run must not read as "the network cost nothing"; the
 *    breakdown has to be able to say how much of it is unmeasured.
 *  - **`fetchMs` is the wall clock around the loop**, so the difference between
 *    it and the sum of the parts is a mini-residual — the first place an
 *    unattributed cost inside fetching would show up.
 *
 * @see demo-pipeline.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";
import {
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
  parseRuleTable,
  type OsmDataSource,
  type OsmTileResult,
  type OsmTileTimings,
} from "gps-plus-slam-osm";
import { DemoPipeline } from "./demo-pipeline.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

const TABLE = parseRuleTable(
  ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
  { source: "test", fetchedAt: 0 },
);

/** How many tiles the working set at COLOGNE actually needs. */
function tileCount(): number {
  return fetchTilesForScoreWorkingSet(
    latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
  ).length;
}

function tileResult(tile: string, timings?: OsmTileTimings): OsmTileResult {
  return {
    tile,
    features: [
      {
        type: "way",
        id: 1,
        geometry: [
          { lat: COLOGNE.lat, lng: COLOGNE.lng },
          { lat: COLOGNE.lat + 1e-4, lng: COLOGNE.lng },
          { lat: COLOGNE.lat + 1e-4, lng: COLOGNE.lng + 1e-4 },
          { lat: COLOGNE.lat, lng: COLOGNE.lng },
        ],
        tags: { leisure: "park" },
      },
    ],
    fetchedAt: 1000,
    sourceId: "test",
    schemaVersion: 3,
    skipped: [],
    ...(timings === undefined ? {} : { timings }),
  };
}

/** Fixed per-tile costs, so a SUM is distinguishable from a SAMPLE. */
const PER_TILE: OsmTileTimings = {
  servedBy: "network",
  slotWaitMs: 1,
  transportMs: 100,
  decodeMs: 20,
  parseMs: 30,
  attempts: 1,
  storeMs: 5,
  probeMs: 2,
};

function measuredSource(): OsmDataSource {
  return {
    attribution: "© OpenStreetMap contributors",
    sourceId: "measured",
    fetchTile: (tile) => Promise.resolve(tileResult(tile, PER_TILE)),
  };
}

function unmeasuredSource(): OsmDataSource {
  return {
    attribution: "© OpenStreetMap contributors",
    sourceId: "unmeasured",
    fetchTile: (tile) => Promise.resolve(tileResult(tile)),
  };
}

describe("DemoSnapshot.timings covers stages 1-5", () => {
  it("SUMS the per-tile source costs rather than sampling one of them", async () => {
    // The failure this rules out is silent and scale-dependent: an interior
    // position needs one tile and a boundary position needs three, so a
    // sampling bug reads correctly most of the time and divides the fetch
    // stage by three exactly where the click is slowest.
    const pipeline = new DemoPipeline({
      source: measuredSource(),
      table: TABLE,
    });
    const snapshot = await pipeline.update(COLOGNE, "walkable");
    const n = tileCount();

    expect(n).toBeGreaterThan(0);
    expect(snapshot.timings.tilesFetched).toBe(n);
    expect(snapshot.timings.transportMs).toBe(100 * n);
    expect(snapshot.timings.decodeMs).toBe(20 * n);
    expect(snapshot.timings.parseMs).toBe(30 * n);
    expect(snapshot.timings.storeMs).toBe(5 * n);
    expect(snapshot.timings.probeMs).toBe(2 * n);
    expect(snapshot.timings.slotWaitMs).toBe(1 * n);
  });

  it("counts how the tiles were served, and how many were not measured at all", async () => {
    // "Unmeasured" must be visible as a COUNT rather than absorbed as zero. A
    // fixture-backed run would otherwise report a click whose network cost
    // nothing, which is true of the fixture and false of the app — and the
    // whole plan exists because a number without its provenance got believed.
    const pipeline = new DemoPipeline({
      source: unmeasuredSource(),
      table: TABLE,
    });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    expect(snapshot.timings.tilesUnmeasured).toBe(tileCount());
    expect(snapshot.timings.tilesFromNetwork).toBe(0);
    expect(snapshot.timings.transportMs).toBe(0);
  });

  it("separates merge from fetch, though acceptTile runs inside the fetch loop", async () => {
    // Stage 3 is the one the plan flags as growing across a session, because
    // `this.tiles` never evicts and `mergeTiles` re-merges everything on every
    // accept. Buried inside the fetch stage that growth would be invisible —
    // and it is the term nothing has ever measured.
    const pipeline = new DemoPipeline({
      source: measuredSource(),
      table: TABLE,
    });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    expect(snapshot.timings.mergeMs).toBeGreaterThanOrEqual(0);
    // Merge happens inside the loop, so the loop's wall clock must contain it.
    expect(snapshot.timings.fetchMs).toBeGreaterThanOrEqual(
      snapshot.timings.mergeMs,
    );
  });

  it("reports the two wall clocks that later stages reconcile against", async () => {
    // `fetchMs` and `pipelineMs` are the anchors. Without them the per-stage
    // numbers are unfalsifiable: any set of plausible parts adds up to some
    // total, and only a separately-measured whole can say the parts are wrong.
    const pipeline = new DemoPipeline({
      source: measuredSource(),
      table: TABLE,
    });
    const snapshot = await pipeline.update(COLOGNE, "walkable");
    const t = snapshot.timings;

    expect(t.pipelineMs).toBeGreaterThanOrEqual(0);
    // The three stage groups happen inside `update`, so the method's own wall
    // clock cannot be smaller than their sum by more than float noise.
    const inside = t.fetchMs + t.scoreMs + t.deriveMs;
    expect(t.pipelineMs + 1).toBeGreaterThanOrEqual(inside);
  });

  it("counts tiles HELD, not just tiles fetched this pass", async () => {
    // The two diverge from the second click onward, and their ratio is what
    // makes the merge stage's growth readable: re-merging N tiles to fetch one
    // is the quadratic the plan predicts.
    const pipeline = new DemoPipeline({
      source: measuredSource(),
      table: TABLE,
    });
    await pipeline.update(COLOGNE, "walkable");
    const second = await pipeline.update(COLOGNE, "walkable");

    expect(second.timings.tilesFetched).toBe(0);
    expect(second.timings.tilesHeld).toBe(tileCount());
  });

  it("never reports a negative stage, whatever the clock did", async () => {
    // Same reasoning as the source-level property test: a negative makes the
    // reconciliation close by cancelling, so the gate that would catch a clock
    // problem goes quiet exactly when it should shout.
    const pipeline = new DemoPipeline({
      source: measuredSource(),
      table: TABLE,
    });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    for (const [field, value] of Object.entries(snapshot.timings)) {
      expect(value, `${field} was negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
