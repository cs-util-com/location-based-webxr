/**
 * Worker-boundary (structured clone) tests.
 *
 * Why these tests matter:
 * §4.2 requires every type crossing a worker boundary to be structured-cloneable,
 * and until now nothing had actually posted one through a channel — the model
 * had a JSON round-trip test, which is a DIFFERENT guarantee and misses in both
 * directions:
 *
 *   - a `Map` survives structured clone but JSON-serialises to `{}`;
 *   - a class instance survives neither, yet JSON round-trips into a
 *     plausible-looking plain object that no longer has its methods.
 *
 * So a type can pass a JSON test and break in a worker, or pass a clone test and
 * break in the blob store. Both boundaries are real here — the worker for
 * parsing 28 MB tiles off the render thread, the store for caching scored
 * chunks — so both are asserted, and where they disagree the test says which
 * one the type is allowed to fail.
 *
 * @see ../source/osm-data-source.ts.md
 */

import { describe, it, expect } from "vitest";
import { MessageChannel } from "node:worker_threads";
import { latLngToCell } from "h3-js";
import { buildFeatureIndex } from "./h3-feature-index.js";
import { coverCells } from "./cell-coverage.js";
import { mergeTiles } from "./merge-tiles.js";
import { AFFORDANCE_RES } from "./resolutions.js";
import type { OsmFeature } from "../model/osm-feature.js";
import type { OsmTileResult } from "../source/osm-data-source.js";

/** Posts a value through a REAL MessageChannel and returns what arrives. */
async function roundTrip<T>(value: T): Promise<T> {
  const channel = new MessageChannel();
  const received = new Promise<T>((resolve) => {
    channel.port2.on("message", (message: T) => {
      resolve(message);
      channel.port2.close();
    });
  });
  channel.port1.postMessage(value);
  channel.port1.close();
  return received;
}

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

const feature: OsmFeature = {
  type: "way",
  id: 1,
  geometry: [
    { lat: COLOGNE.lat, lng: COLOGNE.lng },
    { lat: COLOGNE.lat, lng: COLOGNE.lng + 0.0003 },
  ],
  tags: { highway: "footway", surface: "sand" },
};

const tile: OsmTileResult = {
  tile: latLngToCell(COLOGNE.lat, COLOGNE.lng, 7),
  features: [feature],
  fetchedAt: 1_000_000,
  sourceId: "test",
  schemaVersion: 2,
  skipped: [],
};

describe("types that cross into a worker survive structured clone", () => {
  it("OsmTileResult round-trips through a real MessageChannel", async () => {
    const received = await roundTrip(tile);
    expect(received).toEqual(tile);
    expect(received.features[0]).toEqual(feature);
  });

  it("an OsmFeature keeps its tags and geometry", async () => {
    const received = await roundTrip(feature);
    expect(received.tags["surface"]).toBe("sand");
    expect(received.type).toBe("way");
    if (received.type !== "way") throw new Error("expected a way");
    expect(received.geometry).toHaveLength(2);
  });

  it("CellCoverage[] round-trips", async () => {
    const covered = coverCells({ kind: "point", position: COLOGNE });
    expect(await roundTrip(covered)).toEqual(covered);
  });
});

describe("the JSON boundary is DIFFERENT, and Maps are where they diverge", () => {
  // This is the trap the plan called out and that Iteration 5's provenance type
  // had to be changed for.
  it("a Map survives structured clone", async () => {
    const map = new Map([["a", 1]]);
    const received = await roundTrip(map);
    expect(received.get("a")).toBe(1);
  });

  it("but a Map JSON-serialises to {} — silently", () => {
    // Not an error, not a warning: `{}`. Anything Map-shaped that reaches the
    // string-valued blob store comes back empty, which for provenance reads as
    // "this score has no explanation" rather than as a bug.
    expect(JSON.stringify(new Map([["a", 1]]))).toBe("{}");
    expect(JSON.parse(JSON.stringify(new Map([["a", 1]])))).toEqual({});
  });

  it("so anything PERSISTED must be a plain Record, not a Map", () => {
    const asRecord: Record<string, number> = { a: 1 };
    expect(JSON.parse(JSON.stringify(asRecord))).toEqual({ a: 1 });
  });
});

describe("the index is a worker-side structure, and that is a deliberate limit", () => {
  const index = buildFeatureIndex([feature]);

  it("survives structured clone, Maps and all", async () => {
    // Fine for the worker→main hop, which is the direction that matters: the
    // worker builds the index and posts it.
    const received = await roundTrip(index);
    expect(received.byCell.size).toBe(index.byCell.size);
    expect(received.features.get("way/1")).toEqual(feature);
  });

  it("does NOT survive JSON — so it must never be handed to the blob store", () => {
    // Asserted as a documented limitation rather than fixed. The index is a
    // derived, rebuildable artefact (the C# reference rebuilds its own per
    // session, from the raw tiles on disk); the RAW TILES are what gets
    // persisted. If the index ever needs persisting, it needs a serialised form
    // designed for it, and this test is where that decision surfaces.
    const revived = JSON.parse(JSON.stringify(index)) as {
      byCell: Record<string, unknown>;
    };
    expect(revived.byCell).toEqual({});
  });
});

describe("merge output crosses the boundary too", () => {
  it("MergedTiles survives structured clone", async () => {
    const merged = mergeTiles([tile]);
    const received = await roundTrip(merged);
    expect(received.features.size).toBe(merged.features.size);
    expect(received.provenance.get("way/1")?.tile).toBe(tile.tile);
  });
});

describe("no class instances leak into the boundary types", () => {
  it("every value in a cloned tile is a plain object or primitive", async () => {
    // The rule §4.2 states: plain objects and typed arrays, no class instances
    // with methods, no closures. A class instance would survive neither
    // boundary and would JSON-round-trip into something that looks right and
    // has lost its behaviour.
    const received = await roundTrip(tile);
    for (const value of walk(received)) {
      if (value === null || typeof value !== "object") continue;
      const proto: unknown = Object.getPrototypeOf(value);
      expect(
        proto === Object.prototype ||
          proto === Array.prototype ||
          proto === null,
      ).toBe(true);
    }
  });
});

/** Every nested value of a plain structure. */
function* walk(value: unknown): Generator<unknown> {
  yield value;
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value as Record<string, unknown>)) {
    yield* walk(child);
  }
}

describe("scored-chunk shaped data", () => {
  it("typed arrays survive both boundaries in the form we would use", async () => {
    // §4.2 prefers Float32Array/Uint32Array for per-cell data so results
    // transfer rather than copy. They clone fine; through JSON they become
    // objects, so a persisted chunk has to convert explicitly — asserted here so
    // the conversion is a known step rather than a surprise.
    const scores = new Float32Array([1, 35, 0]);
    const cloned = await roundTrip(scores);
    expect(cloned).toBeInstanceOf(Float32Array);
    expect([...cloned]).toEqual([1, 35, 0]);

    expect(JSON.parse(JSON.stringify(scores))).toEqual({
      "0": 1,
      "1": 35,
      "2": 0,
    });
  });

  it("a cell id array is the simple case and survives both", async () => {
    const cells = coverCells({ kind: "point", position: COLOGNE }).map(
      (c) => c.cell,
    );
    expect(await roundTrip(cells)).toEqual(cells);
    expect(JSON.parse(JSON.stringify(cells))).toEqual(cells);
    expect(cells[0]).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES),
    );
  });
});
