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
import { latLngToCell, cellToParent } from "h3-js";
import {
  AFFORDANCE_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  SCORE_DISK_RADIUS,
  fetchTilesForScoreWorkingSet,
  parseRuleTable,
  type OsmDataSource,
} from "gps-plus-slam-osm";
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
   * pull tiles, and a tile is 28-68 MB. What makes it real is that `update()`
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
    // a constant: a res-7 tile is 28–68 MB and 18–110 s. Paying that before the
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

  it("returns an event whose picks sit on scored ground", async () => {
    const pipeline = new DemoPipeline({ source: wideSource(), table: TABLE });
    await pipeline.update(AT, "walkable");

    const event = await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);

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
    const found = await permissive.geoEvent(AT, "walkable", 1_700_000_000_000);
    expect(found.picks.length).toBeGreaterThan(0);

    const strict = new DemoPipeline({
      source: wideSource(),
      table: HIGH_THRESHOLD,
    });
    await strict.update(AT, "walkable");
    const none = await strict.geoEvent(AT, "walkable", 1_700_000_000_000);
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

      const event = await pipeline.geoEvent(AT, "walkable", 1_700_000_000_000);

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

    const a = await warm.geoEvent(AT, "walkable", 1_700_000_000_000);
    const b = await cold.geoEvent(AT, "walkable", 1_700_000_000_000);

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
