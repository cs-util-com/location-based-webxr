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
  parseRuleTable,
  type OsmDataSource,
} from "gps-plus-slam-osm";
import { DemoPipeline } from "./demo-pipeline.js";

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
