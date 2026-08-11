/**
 * Why these tests matter:
 * The demo's stated job is to make the chunk grid legible, so the chunk label
 * it shows the user has to name the chunk that was actually scored. There are
 * two plausible ways to compute "the res-11 chunk this position is in" and they
 * are NOT the same function — `cellToParent` walks the H3 index hierarchy,
 * whose children are not geometrically contained by their parents
 * (`resolutions.ts` calls this out by name). Using one for scoring and the
 * other for the label produces a label that is simply wrong near a boundary,
 * which is the opposite of legible.
 *
 * @see demo-pipeline.ts.md
 */

import { describe, it, expect } from "vitest";
import { cellToBoundary, cellToParent, gridDisk, latLngToCell } from "h3-js";
import {
  AFFORDANCE_RES,
  CANDIDATES_PER_BATCH,
  EVENT_TILE_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  eventCandidates,
  fetchTilesForScoreWorkingSet,
  nextEventTime,
  parseRuleTable,
  toFetchTile,
  type OsmDataSource,
} from "gps-plus-slam-osm";

/** `GEO_EVENT_SEED` and `CLIMB_STEPS`, mirrored from `demo-pipeline.ts`. */
const GEO_EVENT_SEED = 20260804;
const CLIMB_STEPS = 5;

/** A cell's bounding box, as `demo-pipeline.ts` computes it. */
function boundsOf(cell: string): [number, number, number, number] {
  const ring = cellToBoundary(cell);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [south, west, north, east];
}
import { DemoPipeline } from "./demo-pipeline.js";
import { heatScale } from "./heat-colours.js";

describe("chunkFor names the chunk that was actually scored", () => {
  /**
   * Positions where the index parent of the res-13 cell is NOT the res-11 cell
   * containing the point. Found by sweeping a 60-point grid over Cologne — four
   * of the first sixty disagreed, so this is the common case near a boundary
   * rather than an exotic one.
   */
  const DIVERGENT = [
    { lat: 50.9, lng: 6.905 },
    { lat: 50.9, lng: 6.9056 },
    { lat: 50.9, lng: 6.9112 },
    { lat: 50.9, lng: 6.9118 },
  ];

  it.each(DIVERGENT)(
    "returns the containing res-11 cell at ($lat, $lng)",
    (position) => {
      const containing = latLngToCell(
        position.lat,
        position.lng,
        SCORE_CHUNK_RES,
      );
      const indexParent = cellToParent(
        latLngToCell(position.lat, position.lng, AFFORDANCE_RES),
        SCORE_CHUNK_RES,
      );

      // Guards the fixture: if H3 ever made these agree here, the test below
      // would still pass while proving nothing.
      expect(containing).not.toBe(indexParent);

      expect(DemoPipeline.chunkFor(position)).toBe(containing);
    },
  );

  it("agrees with the containing cell everywhere on a sweep", () => {
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const position = { lat: 50.9 + i * 0.0002, lng: 6.9 + j * 0.0002 };
        expect(DemoPipeline.chunkFor(position)).toBe(
          latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES),
        );
      }
    }
  });
});

describe("the snapshot stays serialisable", () => {
  /**
   * Why this test matters:
   * The store excludes `osmView.snapshot` from RTK's runtime serialisability
   * scan on both the action and the state side, for measured performance
   * reasons (`osm-store.ts`). That exclusion closed the only channel that
   * would have shouted about a `Map` or a `Date` reaching the store — so this
   * is the replacement guard, and it is deliberately here rather than in
   * `osm-store.test.ts`: a round-trip of a fixture written next to the
   * assertion proves only that the fixture is serialisable. This drives the
   * REAL producer and round-trips what it actually emits.
   */
  const COLOGNE = { lat: 50.9413, lng: 6.9583 };

  /**
   * A source that answers every tile with one tagged park, as a WAY.
   *
   * A single node was the original fixture and it scored too few adjacent cells
   * to form a connected component, so `snapshot.regions` came back `[]` and the
   * round-trip below never touched it. That is the one part of `DemoSnapshot`
   * with real structure to lose — `outline` is three levels of nested array —
   * and the one carrying `minScore`/`maxScore`, which `region-builder` notes can
   * be `±Infinity` on a degenerate component. `JSON.stringify(Infinity)` is
   * `"null"`, silently: the most JSON-hostile value in the snapshot lived behind
   * the only collection the guard did not require to exist.
   *
   * A way is also what the region outlines and the 3D view actually consume, so
   * it is the more representative fixture regardless.
   */
  const PARK: readonly { lat: number; lng: number }[] = [
    { lat: COLOGNE.lat, lng: COLOGNE.lng },
    { lat: COLOGNE.lat, lng: COLOGNE.lng + 0.0009 },
    { lat: COLOGNE.lat + 0.0006, lng: COLOGNE.lng + 0.0009 },
    { lat: COLOGNE.lat + 0.0006, lng: COLOGNE.lng },
    { lat: COLOGNE.lat, lng: COLOGNE.lng },
  ];

  const source: OsmDataSource = {
    attribution: "© OpenStreetMap contributors",
    sourceId: "fixture:serialisability",
    fetchTile: (tile) =>
      Promise.resolve({
        tile,
        features: [
          {
            type: "way" as const,
            id: 1,
            geometry: PARK,
            tags: { leisure: "park", surface: "grass" },
          },
        ],
        fetchedAt: 0,
        sourceId: "fixture:serialisability",
        schemaVersion: 1,
        skipped: [],
      }),
  };

  const TABLE = parseRuleTable(
    ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  it("round-trips through JSON with nothing lost", async () => {
    const pipeline = new DemoPipeline({ source, table: TABLE });
    const snapshot = await pipeline.update(COLOGNE, "walkable");

    // Not a smoke test: an empty snapshot would round-trip trivially. `regions`
    // is required too — see the fixture comment for why it is the collection
    // that matters most and was the one this guard did not reach.
    expect(snapshot.cells.length).toBeGreaterThan(0);
    expect(snapshot.loadedTiles.length).toBeGreaterThan(0);
    expect(snapshot.regions.length).toBeGreaterThan(0);

    // `toStrictEqual`, not `toEqual`. Both catch a `Map`, a `Set` or a `Date`
    // surviving the stringify as `{}` or a string — but `toEqual` also ignores
    // object TYPE mismatch, so a class instance with plain data fields
    // round-trips to an equal plain object and slips through. That is not a
    // hypothetical gap: RTK's `serializableCheck` uses `isPlainObject`, so a
    // class instance is exactly what the scan this test replaced would have
    // flagged, and inheriting a hole in precisely that dimension would make
    // the replacement weaker than what it replaced.
    //
    // The price is that `toStrictEqual` stops tolerating `undefined`-valued
    // keys, which JSON drops. The producer emits none today, so the stricter
    // comparison is free — and if it ever does, the failure is worth reading
    // rather than tolerating: an optional field the store cannot persist.
    expect(JSON.parse(JSON.stringify(snapshot))).toStrictEqual(snapshot);
  });

  it("and the round-trip would actually catch a Map, which is the point", () => {
    // Testing the test. This assertion replaced a runtime middleware check, so
    // "it passes" is only reassuring if it can fail — and the failure mode it
    // guards against is subtle: `JSON.stringify(new Map())` is `"{}"`, silently,
    // with no throw anywhere. If a future vitest changed `toEqual` to treat a
    // Map and a plain object as equivalent, the guard above would go quiet
    // while still passing, and this line is what would notice.
    const withMap = { cells: new Map([["a", 1]]) };
    expect(JSON.parse(JSON.stringify(withMap))).not.toEqual(withMap);
  });

  it("and would catch a CLASS INSTANCE, which `toEqual` alone would not", () => {
    // The dimension the guard above was strengthened for. RTK's
    // `serializableCheck` uses `isPlainObject`, so a class instance is exactly
    // what the runtime scan would have flagged — and `toEqual` ignores object
    // type mismatch by design, so `expect({score: 1}).toEqual(new Cell(1))`
    // PASSES. Both halves are asserted here: the weaker comparison lets it
    // through, the stricter one does not, so a future loosening of the guard
    // back to `toEqual` fails this line rather than going quiet.
    class Cell {
      constructor(readonly score: number) {}
    }
    const withClass = { cell: new Cell(1) };
    const roundTripped = JSON.parse(JSON.stringify(withClass)) as unknown;

    expect(roundTripped).toEqual(withClass);
    expect(roundTripped).not.toStrictEqual(withClass);
  });
});

describe("DemoPipeline.update — abort", () => {
  const COLOGNE = { lat: 50.9413, lng: 6.9583 };
  /** Minimal table: these tests are about the fetch loop, not about scoring. */
  const TABLE = parseRuleTable(
    ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  /**
   * WHY THESE TESTS MATTER, AND WHY THEY ARE HERE RATHER THAN IN AN E2E. The abort
   * signal is the mechanism that stops a superseded position from continuing to
   * pull tiles, and a tile is ~21 MB. What makes it real is that `update()`
   * checks the signal BETWEEN tiles, so the saving is "the remaining tiles are
   * never requested".
   *
   * That is precisely measurable here — count the source's calls — and it is not
   * measurable in the e2e suite, where the Overpass stub answers instantly so no
   * supersession can land mid-fetch. A timing-based e2e ("the second request
   * started before the first finished") would be exactly the kind of threshold
   * that passes locally and flakes in CI.
   *
   * The complementary halves live elsewhere: `latest-only.test.ts` proves the
   * signal is aborted the moment a newer input arrives and that each run gets a
   * fresh one, and `rpc-client.test.ts` proves the cancellation is posted to the
   * worker rather than merely dropped on the main thread.
   */

  /** Counts calls, and never resolves faster than the test allows. */
  function countingSource(): { source: OsmDataSource; tiles: string[] } {
    const tiles: string[] = [];
    return {
      tiles,
      source: {
        attribution: "test",
        sourceId: "fixture:abort",
        fetchTile: (tile) => {
          tiles.push(tile);
          return Promise.resolve({
            tile,
            features: [],
            fetchedAt: 0,
            sourceId: "fixture:abort",
            schemaVersion: 1,
            skipped: [],
          });
        },
      },
    };
  }

  it("throws AbortError and fetches NOTHING when already aborted", async () => {
    const { source, tiles } = countingSource();
    const pipeline = new DemoPipeline({ source, table: TABLE });

    await expect(
      pipeline.update(COLOGNE, "walkable", AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });

    // The check is before the first fetch, so an already-superseded run costs
    // nothing at all — not even one tile.
    expect(tiles).toEqual([]);
  });

  it("stops after the tile in flight, and does NOT go on to score", async () => {
    // WHAT THIS TEST TAUGHT, and why the production code gained a second check.
    // The original guard was only at the top of the tile loop, so it fired only
    // when there WAS a next tile — and at an interior position the working set
    // needs exactly one. A run superseded during its single fetch therefore went
    // on to score 19 chunks and 931 cells for a position the user had left.
    // Scoring is the other expensive half of , so there is now a check
    // after the loop as well, and this test is what forced it.
    const { source, tiles } = countingSource();
    const controller = new AbortController();
    const counting: OsmDataSource = {
      ...source,
      fetchTile: async (tile) => {
        const result = await source.fetchTile(tile);
        // Supersede the run as soon as the first tile has landed.
        controller.abort();
        return result;
      },
    };
    const pipeline = new DemoPipeline({ source: counting, table: TABLE });

    await expect(
      pipeline.update(COLOGNE, "walkable", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    // Exactly one: the tile that was already in flight completed, and the loop
    // refused to start another.
    expect(tiles).toHaveLength(1);
  });

  it("completes normally when the signal is never aborted", async () => {
    // The control case: the guard must not make the ordinary path abortive.
    const { source, tiles } = countingSource();
    const pipeline = new DemoPipeline({ source, table: TABLE });

    const snapshot = await pipeline.update(
      COLOGNE,
      "walkable",
      new AbortController().signal,
    );

    expect(snapshot.position).toEqual(COLOGNE);
    expect(tiles.length).toBeGreaterThan(0);
  });

  it("works with no signal at all, so callers that do not cancel are unaffected", async () => {
    const { source } = countingSource();
    const pipeline = new DemoPipeline({ source, table: TABLE });
    await expect(pipeline.update(COLOGNE, "walkable")).resolves.toHaveProperty(
      "position",
    );
  });
});

describe("the fetch set follows the ring being scored (W4, finding N1)", () => {
  /**
   * Why these tests matter:
   * Scoring outgrew fetching silently. W16 made scoring progressive out to
   * `SCORE_DISK_MAX_RADIUS` while the fetch set was still derived from
   * `SCORE_DISK_RADIUS`, so within ~250 m of a res-7 boundary the outer rings
   * were scored against tiles nobody had downloaded — and an unfetched cell
   * scores as the identity, which on screen is "nothing is mapped here". The
   * obvious fix (always derive from the maximum) trades that for a different
   * defect: the fetch loop runs before any scoring, so the FIRST ring would
   * block on a tile only the outer rings need. Both directions are pinned here.
   */

  /** A position whose ring-4 disk crosses into a second res-7 tile. */
  const NEAR_A_BOUNDARY = (() => {
    for (let i = 0; i < 4000; i++) {
      const position = { lat: 50.9 + i * 0.0005, lng: 6.9 + i * 0.0003 };
      const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
      const narrow = fetchTilesForScoreWorkingSet(chunk, SCORE_DISK_RADIUS);
      const wide = fetchTilesForScoreWorkingSet(chunk, SCORE_DISK_MAX_RADIUS);
      if (wide.length > narrow.length) return { position, narrow, wide };
    }
    throw new Error("no boundary-crossing position found in the sweep");
  })();

  /** Records which tiles were asked for, and answers each with nothing. */
  function recordingSource() {
    const asked: string[] = [];
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fixture:asked",
      fetchTile: (tile) => {
        asked.push(tile);
        return Promise.resolve({
          tile,
          features: [],
          fetchedAt: 0,
          sourceId: "fixture:asked",
          schemaVersion: 1,
          skipped: [],
        });
      },
    };
    return { asked, source };
  }

  const TABLE = parseRuleTable(
    ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  it("guards its own fixture: the wide disk really does need another tile", () => {
    // Without this the two tests below would both pass on a position where the
    // rings never leave one tile, proving nothing at all.
    expect(NEAR_A_BOUNDARY.wide.length).toBeGreaterThan(
      NEAR_A_BOUNDARY.narrow.length,
    );
  });

  it("fetches the outer ring's tile when the outer ring is scored", () => {
    // The defect: those chunks used to be scored with no data behind them.
    const { asked, source } = recordingSource();
    const pipeline = new DemoPipeline({ source, table: TABLE });

    return pipeline
      .update(
        NEAR_A_BOUNDARY.position,
        "walkable",
        undefined,
        SCORE_DISK_MAX_RADIUS,
      )
      .then(() => {
        for (const tile of NEAR_A_BOUNDARY.wide) {
          expect(asked).toContain(tile);
        }
      });
  });

  it("does NOT fetch it for the first pass, which is what the user waits on", () => {
    // The other direction, and the reason the radius is a parameter rather than
    // a constant: a res-7 tile is ~21 MB and ~15–90 s. Paying that before the
    // ring-2 answer would undo W16 entirely.
    const { asked, source } = recordingSource();
    const pipeline = new DemoPipeline({ source, table: TABLE });

    return pipeline
      .update(
        NEAR_A_BOUNDARY.position,
        "walkable",
        undefined,
        SCORE_DISK_RADIUS,
      )
      .then(() => {
        expect([...asked].sort()).toEqual([...NEAR_A_BOUNDARY.narrow].sort());
      });
  });

  /**
   * The snapshot has to say which ring it describes (F42).
   *
   * WHY THIS MATTERS ENOUGH TO BE A TEST. `refresh-cycle.ts` scores three rings
   * and publishes after each one, and `snapshotReady` sets `loading: idle` every
   * time — so the app announced a final-looking answer three times and nothing
   * downstream could tell an intermediate ring from the last one. That was two
   * separate defects wearing one costume: the status line claimed a finished
   * scoring while it was still growing, and the e2e helper had to GUESS the end of
   * widening from 500 ms of status quiescence, which worker contention defeated —
   * one run read 845 cells where another read 1692, from the same fixture.
   *
   * The radius was already a parameter of `update`; it simply never came back out.
   */
  describe("the snapshot's radius", () => {
    it("is the radius that was asked for", async () => {
      const { source } = recordingSource();
      const pipeline = new DemoPipeline({ source, table: TABLE });

      const snapshot = await pipeline.update(
        NEAR_A_BOUNDARY.position,
        "walkable",
        undefined,
        SCORE_DISK_MAX_RADIUS,
      );

      expect(snapshot.radius).toBe(SCORE_DISK_MAX_RADIUS);
    });

    it("falls back to the first pass's radius when none was asked for", async () => {
      // `undefined` means the first pass everywhere else in this file, and the
      // snapshot must agree rather than reporting a radius of `undefined` that a
      // `< SCORE_DISK_MAX_RADIUS` comparison would silently read as false.
      const { source } = recordingSource();
      const pipeline = new DemoPipeline({ source, table: TABLE });

      const snapshot = await pipeline.update(
        NEAR_A_BOUNDARY.position,
        "walkable",
      );

      expect(snapshot.radius).toBe(SCORE_DISK_RADIUS);
    });
  });
});

/**
 * WHY THIS TEST MATTERS (round 9 §6a). The geo-event is the first algorithm that
 * reads the heat field somewhere the user is NOT, and the ordering it needs is
 * the round's central constraint (DEC-R9-4): derive the reachable cells, ensure
 * and pin them, and only then climb — with no I/O once the climb starts, because
 * `acceptTile` deletes chunks regardless of pins.
 *
 * The pipeline is where that ordering lives; `geo-event.ts` is pure and cannot
 * enforce it.
 */
describe("DemoPipeline.geoEvent", () => {
  const AT = { lat: 50.9413, lng: 6.9583 };

  /** A park covering a wide area, so candidates land on scoreable ground. */
  const wideSource = (): OsmDataSource => ({
    attribution: "© OpenStreetMap contributors",
    sourceId: "fixture:geo-event",
    fetchTile: (tile) =>
      Promise.resolve({
        tile,
        features: [
          {
            type: "way" as const,
            id: 1,
            geometry: [
              { lat: AT.lat - 0.05, lng: AT.lng - 0.05 },
              { lat: AT.lat - 0.05, lng: AT.lng + 0.05 },
              { lat: AT.lat + 0.05, lng: AT.lng + 0.05 },
              { lat: AT.lat + 0.05, lng: AT.lng - 0.05 },
              { lat: AT.lat - 0.05, lng: AT.lng - 0.05 },
            ],
            tags: { leisure: "park" },
          },
        ],
        fetchedAt: 0,
        sourceId: "fixture:geo-event",
        schemaVersion: 1,
        skipped: [],
      }),
  });

  const TABLE = parseRuleTable(
    ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  it("reports what the search cost, and the numbers are real (W7)", async () => {
    // WHY THIS TEST MATTERS (DEC-G7). The benchmark decides what W8 does, so a
    // counter that is plausible but wrong would send the next round at the
    // wrong lever. Each assertion below is a RELATIONSHIP rather than a
    // magnitude, because magnitudes are fixture-dependent and relationships are
    // not:
    //
    // - lookups per climb, which is the whole cost model. A climb that starts
    //   on unscored ground returns after ONE lookup; a climb with somewhere to
    //   go does five steps of seven neighbours. If these two numbers were ever
    //   equal, the instrumentation would be counting the same thing twice.
    // - climbs vs the batch size, which is what says the retry batches ran at
    //   all: one tile evaluating one batch is exactly CANDIDATES_PER_BATCH.
    // - the reach, which must be larger than a batch by the disk around each
    //   candidate — the ensure set is the thing the plan predicts is oversized.
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    // At the WIDEST radius, so the finding below cannot be explained away as
    // "the disk was only radius 2".
    await pipeline.update(AT, "walkable", undefined, SCORE_DISK_MAX_RADIUS);

    const { event, stats } = await pipeline.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );

    expect(event.picks.length).toBeGreaterThan(0);
    expect(stats.climbsStarted).toBeGreaterThanOrEqual(CANDIDATES_PER_BATCH);
    expect(stats.heatLookups).toBeGreaterThan(stats.climbsStarted);
    expect(stats.reachCells).toBeGreaterThan(CANDIDATES_PER_BATCH);
    // The pinned peak is the number the live counter cannot give: it is back to
    // zero by the time anyone can read it, which is why the index keeps a peak.
    expect(stats.chunksPinnedPeak).toBeGreaterThan(0);
    // Phases are non-negative and the wall clock is the sum of the three plus
    // whatever falls outside them; asserting an ORDER between them would be a
    // machine-speed test.
    for (const ms of [stats.deriveMs, stats.ensureMs, stats.climbMs]) {
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    // ZERO, AND IT WAS SIX BEFORE THE NEIGHBOUR GATE WAS FIXED. This assertion
    // is the reason the fix is worth having: after a refresh at the widest
    // radius, a search now costs no network at all here, where it used to
    // download six tiles on behalf of neighbours whose data it had not checked.
    //
    // It is not guaranteed to be zero everywhere — the centre tile is searched
    // whatever it costs, and its own reach can overhang what a refresh loaded
    // (measured as one tile at the demo's Manhattan default). What IS guaranteed
    // is the rule below: nothing is downloaded for a neighbour.
    expect(stats.tilesFetched).toBe(0);
  });

  it("does not creep outward when the button is pressed repeatedly", async () => {
    // The hypothesis this test was written to check, and it is worth keeping
    // even though it turned out NOT to be the shape of the defect. Under the
    // old centre-only gate, each search downloaded the ground that would admit
    // the next ring of neighbours, which would in turn reach past themselves —
    // so "press Find twice and it downloads twice, further each time" was a
    // plausible reading of the reported slowness. It converged after one round
    // instead, so the cost recurred per LOCATION rather than per press.
    //
    // Kept as a guard because the reach gate is what makes it true by
    // construction now: a neighbour is admitted only when its whole reach is
    // already held, so admitting one can never require a download, and a second
    // search from the same place in the same quarter-hour has nothing to learn.
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    await pipeline.update(AT, "walkable", undefined, SCORE_DISK_MAX_RADIUS);

    const first = await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);
    const second = await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);

    expect(second.stats.tilesFetched).toBe(0);
    // And the second search is not quietly poorer for it: the same tiles are
    // searched both times, which is what "converged" has to mean.
    expect(second.event.tilesSearched).toBe(first.event.tilesSearched);
  });

  it("downloads ONLY for the tile the user is standing in", async () => {
    // WHY THIS TEST MATTERS, and it is the rule the code already claims.
    // `geoEvent`'s docstring justifies searching a neighbour only when its data
    // is present: "a neighbour whose data is missing costs a ~15–90 s
    // download… Those are free; the rest are skipped." The centre tile is
    // exempt by design — the user is standing in it, so it must be searched
    // whatever it costs.
    //
    // So every download a search makes must be attributable to the CENTRE. The
    // gate as written checks `toFetchTile(neighbour)` — the neighbour's centre
    // — while the ensure set built for it reaches ~550 m further, into fetch
    // tiles nobody asked about. Those downloads are exactly the ones the
    // docstring promises will not happen.
    //
    // The expectation is derived from GEOMETRY, not from the gate: it is the
    // set of fetch tiles the centre tile's own seeded candidates can reach.
    // That is the specification the docstring states, computed independently of
    // the loaded-set test the implementation uses.
    const requested: string[] = [];
    const recording: OsmDataSource = {
      ...wideSource(),
      fetchTile: (tile, signal) => {
        requested.push(tile);
        return wideSource().fetchTile(tile, signal);
      },
    };
    const pipeline = new DemoPipeline({ source: recording, table: TABLE });
    await pipeline.update(AT, "walkable", undefined, SCORE_DISK_MAX_RADIUS);
    requested.length = 0;

    await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);

    const centre = latLngToCell(AT.lat, AT.lng, EVENT_TILE_RES);
    const [south, west, north, east] = boundsOf(centre);
    const centreReach = new Set<string>();
    for (const candidate of eventCandidates({
      bbox: { south, west, north, east },
      globalSeed: GEO_EVENT_SEED,
      eventTime: nextEventTime(1_700_000_000_000),
      count: CANDIDATES_PER_BATCH,
    })) {
      const start = latLngToCell(candidate.lat, candidate.lng, AFFORDANCE_RES);
      for (const cell of gridDisk(start, CLIMB_STEPS + 1)) {
        centreReach.add(toFetchTile(cell));
      }
    }

    const notTheCentres = requested.filter((tile) => !centreReach.has(tile));
    expect(notTheCentres).toEqual([]);
  });

  it("reports THIS search's pinned set, not the session's high-water mark", async () => {
    // WHY THIS TEST MATTERS. `stats.chunksPinnedPeak` on the index is a
    // session-lifetime maximum that is deliberately never reset — its own test
    // says so, "keeps the peak across searches, so the worst case survives" —
    // and `GeoEventStats` documents its field as this search's cost. Reading
    // the index's value made every search after the first report the largest
    // one so far, which is precisely wrong for a benchmark whose job is to
    // compare searches.
    //
    // A BIG search then a SMALL one, which is what makes this falsifiable: a
    // leaked session maximum only ever grows, so it would report the big
    // search's number for the small one.
    //
    // Big: enough ground loaded that several neighbours qualify — five tiles,
    // ~290 chunks. Small: a position 150 km away with nothing loaded around it,
    // so no neighbour qualifies and only the centre's reach is pinned — one
    // tile, ~61 chunks. A factor of five apart, so this cannot pass by accident.
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    for (const offset of [0, 0.01, -0.01, 0.02, -0.02]) {
      await pipeline.update(
        { lat: AT.lat + offset, lng: AT.lng + offset },
        "walkable",
        undefined,
        SCORE_DISK_MAX_RADIUS,
      );
    }

    const big = await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);
    const far = { lat: AT.lat + 1.5, lng: AT.lng + 1.5 };
    const small = await pipeline.geoEvent(far, "walkable", 1_700_000_000_000);

    // Guards the fixture: if the big search stopped admitting neighbours, the
    // two would be the same size and the comparison below would prove nothing.
    expect(big.event.tilesSearched).toBeGreaterThan(small.event.tilesSearched);
    expect(small.stats.chunksPinnedPeak).toBeGreaterThan(0);
    expect(small.stats.chunksPinnedPeak).toBeLessThan(
      big.stats.chunksPinnedPeak,
    );
    // And the session maximum really did stay at the bigger value, so the
    // assertion above is about a leak that was available to happen.
    expect(pipeline.stats().chunksPinnedPeak).toBe(big.stats.chunksPinnedPeak);
  });

  it("measures over-cap against THIS search's pins, not a stale eviction", async () => {
    // WHY THE INDEX'S OWN COUNTER CANNOT ANSWER THIS. `evictBeyond` runs from
    // `update()` and nowhere else, so the cap is never tested while a search's
    // pins are held — by the next eviction they are released. `pinnedOverCap`
    // is also sticky, so a search inherited a number produced by the refresh
    // that followed the PREVIOUS one. W7's whole prediction is about this
    // value, so a figure the search could not have caused is worse than none.
    //
    // Comparing this search's own pinned count against the cap in force is the
    // measurement the prediction always described. Here the fixture stays well
    // inside the cap, so the honest answer is zero — and a leaked reading from
    // elsewhere would show up as a non-zero.
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    await pipeline.update(AT, "walkable", undefined, SCORE_DISK_MAX_RADIUS);

    const { stats } = await pipeline.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );

    expect(stats.pinnedOverCap).toBe(0);
    // The guard that makes the zero meaningful: it is zero because the pins
    // fit, not because nothing was pinned.
    expect(stats.chunksPinnedPeak).toBeGreaterThan(0);
  });

  it("counts only tiles that arrived, not every one it asked for", async () => {
    // `tilesFetched` is incremented on SUCCESS, never taken from
    // `missingTiles.length`, and the difference inverts the reading: a tile
    // that fails to load leaves its candidates unscored, which makes the climbs
    // afterwards CHEAPER. A benchmark counting the request would report the
    // cheapest case as the most expensive one.
    const offline: OsmDataSource = {
      attribution: "© OpenStreetMap contributors",
      sourceId: "fixture:geo-event-offline",
      fetchTile: () => Promise.reject(new Error("offline")),
    };
    const pipeline = new DemoPipeline({ source: offline, table: TABLE });

    const { stats } = await pipeline.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );

    expect(stats.tilesFetched).toBe(0);
    // It still climbed: one unreachable tile must not fail the whole event.
    expect(stats.climbsStarted).toBeGreaterThan(0);
  });

  it("returns an event whose picks sit on scored ground", async () => {
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    await pipeline.update(AT, "walkable");

    const { event } = await pipeline.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );

    expect(event.picks.length).toBeGreaterThan(0);
    // Not `unknown`: the ensure step must have covered wherever the climb
    // settled, or the answer depended on what happened to be loaded.
    for (const pick of event.picks) {
      expect(pipeline.cellState(pick.cell).state).not.toBe("unknown");
    }
  });

  it("refuses ground the MAP would not draw, at the table's own threshold", async () => {
    // THE CALLER, not the parameter. `bestPickForTile` accepting a `threshold`
    // is unit-tested in the package; what was NOT tested is that this pipeline
    // passes `thresholdFor(table, category)` into it — and deleting that line
    // passed the entire suite, because the shipped table declares no
    // `__threshold__` and `DEFAULT_THRESHOLD` is 1, so the wiring was
    // indistinguishable from the old hardcoded identity.
    //
    // A declared threshold of 4 puts the bar at 7 cells x 4 = 28 while the park
    // scores 3, so 7 x 3 = 21 is below it: an event that the default table finds
    // must disappear when the map's own bar is raised. That is the whole claim —
    // the geo-event must not place an event on ground the map calls unusable.
    const HIGH_THRESHOLD = parseRuleTable(
      [
        "id,Key,Value,walkable",
        "leisure_park,leisure,park,3",
        "__threshold__,,,4",
      ].join("\n"),
      { source: "test", fetchedAt: 0 },
    );

    // The control first: with the default threshold this fixture DOES yield an
    // event, so the absence below is the threshold and not the fixture.
    const permissive = new DemoPipeline({ source: wideSource(), table: TABLE });
    await permissive.update(AT, "walkable");
    const { event: found } = await permissive.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );
    expect(found.picks.length).toBeGreaterThan(0);

    const strict = new DemoPipeline({
      source: wideSource(),
      table: HIGH_THRESHOLD,
    });
    await strict.update(AT, "walkable");
    const { event: none } = await strict.geoEvent(
      AT,
      "walkable",
      1_700_000_000_000,
    );
    expect(none.picks).toEqual([]);
  });

  it("survives a fetch failure without placing a pick on unscored ground", () => {
    // GRACEFUL DEGRADATION, which is what this can honestly pin. A tile that
    // will not load must not fail the whole event.
    //
    // WHAT IT DOES NOT PIN, recorded rather than implied: mapping `unknown` to
    // `undefined` rather than to the identity. Returning 1 there passes every
    // test in this file, because the ensure step covers everything the climb can
    // reach, so `unknown` never occurs -- and even if it did, a neighbourhood of
    // pure identity cannot clear the gate. Two mechanisms independently prevent
    // the rim bug and the gate is the stronger one. The mapping is kept as
    // defence in depth and is covered directly at the unit level by
    // `climbToLocalMaximum`'s own left-the-field tests. Found by mutation.
    return (async () => {
      let calls = 0;
      const flaky: OsmDataSource = {
        ...wideSource(),
        fetchTile: (tile) => {
          calls += 1;
          if (calls > 1) return Promise.reject(new Error("offline"));
          return wideSource().fetchTile(tile);
        },
      };
      const pipeline = new DemoPipeline({ source: flaky, table: TABLE });
      await pipeline.update(AT, "walkable");

      const { event } = await pipeline.geoEvent(
        AT,
        "walkable",
        1_700_000_000_000,
      );

      for (const pick of event.picks) {
        expect(pipeline.cellState(pick.cell).state).not.toBe("unknown");
      }
    })();
  });

  it("holds no pins once it has returned", async () => {
    // The leak assertion. A pin left behind makes the cache cap permanently
    // unenforceable, and nothing else would report it.
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    await pipeline.update(AT, "walkable");
    await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);

    expect(pipeline.stats().chunksPinned).toBe(0);
  });

  it("gives a device with less data a SUBSET, never a different answer", async () => {
    // DEC-R9-4 AS DEC-R9-15 REFINES IT, and the refinement is the whole point.
    // Each tile's event is a pure function of (tile, time), identical on every
    // device forever. What varies with how much you have downloaded is only
    // WHICH tiles you can see: a device holding neighbour data considers those
    // tiles too, one holding none considers just its own.
    //
    // So the invariant is CONVERGENCE, not equality: a device with less data
    // sees a subset of the same events, never a contradicting one. Asserting
    // equality here is what the first version did, and it failed the moment
    // neighbours were added -- correctly, because equality was the wrong claim.
    const warm = new DemoPipeline({ source: wideSource(), table: TABLE });
    await warm.update(AT, "walkable");
    await warm.update({ lat: AT.lat + 0.002, lng: AT.lng }, "walkable");

    const cold = new DemoPipeline({ source: wideSource(), table: TABLE });

    const { event: a } = await warm.geoEvent(AT, "walkable", 1_700_000_000_000);
    const { event: b } = await cold.geoEvent(AT, "walkable", 1_700_000_000_000);

    expect(b.picks.length).toBeGreaterThan(0);
    const warmCells = new Set(a.picks.map((p) => p.cell));
    for (const pick of b.picks) expect(warmCells.has(pick.cell)).toBe(true);
    expect(a.eventTime).toBe(b.eventTime);
  });
});

/**
 * WHY THESE TESTS MATTER (round 10, stage B).
 *
 * Measured: the snapshot's cell array structured-clones across the worker
 * boundary in 27-35 ms at the 488-chunk cap, three times per move
 * (`refresh-payload.test.ts`). And in the DEFAULT configuration the page draws
 * none of it: the `cells` layer is off (DEC-R7b-5/R7b-6, because the map would
 * draw one Leaflet polygon per cell), the regions are already computed here in
 * the worker, and the only thing the page derives from the cells is
 * `heatScale`'s `max` -- a single number.
 *
 * So the array is sent to compute one number. These tests pin the two halves of
 * fixing that: the number must be computed here and be EXACTLY what the page
 * would have computed, and the array must be omittable without changing it.
 */
describe("the snapshot carries the heat max, so the cells need not travel", () => {
  const AT = { lat: 50.9375, lng: 6.9603 };

  const source: OsmDataSource = {
    attribution: "© OpenStreetMap contributors",
    sourceId: "fixture:heat-max",
    fetchTile: (tile) =>
      Promise.resolve({
        tile,
        features: [
          {
            type: "way" as const,
            id: 1,
            geometry: [
              { lat: AT.lat - 0.002, lng: AT.lng - 0.002 },
              { lat: AT.lat - 0.002, lng: AT.lng + 0.002 },
              { lat: AT.lat + 0.002, lng: AT.lng + 0.002 },
              { lat: AT.lat + 0.002, lng: AT.lng - 0.002 },
              { lat: AT.lat - 0.002, lng: AT.lng - 0.002 },
            ],
            tags: { leisure: "park", surface: "grass" },
          },
        ],
        fetchedAt: 0,
        sourceId: "fixture:heat-max",
        schemaVersion: 1,
        skipped: [],
      }),
  };

  const table = parseRuleTable(
    [
      "id,Key,Value,walkable",
      "leisure_park,leisure,park,3",
      "surface_grass,surface,grass,2",
    ].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  it("reports the max the page would have computed from the full array", () => {
    // THE INVARIANT. The page's colour ramp must not change because the raw
    // material stopped travelling -- if this number differs by any amount the
    // regions are drawn on a different ramp, which is a visible regression that
    // no cell-count assertion would catch.
    return new DemoPipeline({ source, table })
      .update(AT, "walkable")
      .then((snapshot) => {
        expect(snapshot.cells.length).toBeGreaterThan(0);
        const onThePage = heatScale(
          snapshot.cells.map((cell) => cell.scores["walkable"] ?? 1),
          snapshot.threshold,
        );
        expect(snapshot.heatMax).toBe(onThePage.max);
      });
  });

  it("reports the same max when the cells are withheld", async () => {
    // The whole point: omitting the array must be invisible to the ramp. The
    // fixture has to produce a max ABOVE the threshold, or both branches return
    // the threshold and this cannot fail -- the smell this round keeps meeting.
    const withCells = await new DemoPipeline({ source, table }).update(
      AT,
      "walkable",
    );
    expect(withCells.heatMax).toBeGreaterThan(withCells.threshold);

    const without = await new DemoPipeline({ source, table }).update(
      AT,
      "walkable",
      undefined,
      undefined,
      { includeCells: false },
    );

    expect(without.cells).toEqual([]);
    expect(without.heatMax).toBe(withCells.heatMax);
    // And the count survives, because the status line reports it.
    expect(without.cellCount).toBe(withCells.cells.length);
  });

  it("still carries the regions when the cells are withheld", async () => {
    // The page draws regions BY DEFAULT and derives them from nothing -- they
    // are computed here. Withholding cells must not withhold them too.
    const without = await new DemoPipeline({ source, table }).update(
      AT,
      "walkable",
      undefined,
      undefined,
      { includeCells: false },
    );
    expect(without.regions.length).toBeGreaterThan(0);
  });
});

/**
 * WHY THESE TESTS MATTER — the exclusion is invisible by construction.
 *
 * `isBelowSurface` drops 13.3 % of corpus features from scoring and from the
 * mesh and says nothing. The count exists so an absurd number is noticeable
 * without switching a layer on; the outlines exist so a human can judge WHICH
 * features, which is the only way to catch the mirror bug — a predicate so eager
 * it deletes real walkable ground, where nothing looks broken and there is
 * simply less map.
 */
describe("the snapshot reports what was excluded as below-surface", () => {
  const AT_UG = { lat: 50.9375, lng: 6.9603 };
  const ring = (dLat: number) => [
    { lat: AT_UG.lat + dLat, lng: AT_UG.lng },
    { lat: AT_UG.lat + dLat, lng: AT_UG.lng + 0.001 },
    { lat: AT_UG.lat + dLat + 0.001, lng: AT_UG.lng + 0.001 },
    { lat: AT_UG.lat + dLat, lng: AT_UG.lng },
  ];

  const source: OsmDataSource = {
    attribution: "© OpenStreetMap contributors",
    sourceId: "fixture:underground",
    fetchTile: (tile) =>
      Promise.resolve({
        tile,
        // BOTH KINDS, or "reports the excluded ones" and "reports them all" are
        // the same picture and neither assertion below can tell them apart.
        features: [
          {
            type: "way" as const,
            id: 1,
            geometry: ring(0),
            tags: { leisure: "park" },
          },
          {
            type: "way" as const,
            id: 2,
            geometry: ring(0.002),
            tags: { leisure: "park", layer: "-1" },
          },
        ],
        fetchedAt: 0,
        sourceId: "fixture:underground",
        schemaVersion: 1,
        skipped: [],
      }),
  };

  const table = parseRuleTable(
    ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
    { source: "test", fetchedAt: 0 },
  );

  it("always counts them, even with the layer off", () => {
    return new DemoPipeline({ source, table })
      .update(AT_UG, "walkable")
      .then((snapshot) => {
        expect(snapshot.undergroundCount).toBe(1);
        // The outlines are the payload and stay behind unless asked for — the
        // same rule as `cells`.
        expect(snapshot.undergroundOutlines).toEqual([]);
      });
  });

  it("sends the outlines when the layer asks for them", async () => {
    const snapshot = await new DemoPipeline({ source, table }).update(
      AT_UG,
      "walkable",
      undefined,
      undefined,
      { includeUnderground: true },
    );

    // ONE outline, for the ONE excluded way — not two, which is what a missing
    // filter would give.
    expect(snapshot.undergroundOutlines).toHaveLength(1);
    expect(snapshot.undergroundOutlines[0]).toEqual(ring(0.002));
    expect(snapshot.undergroundCount).toBe(1);
  });
});
