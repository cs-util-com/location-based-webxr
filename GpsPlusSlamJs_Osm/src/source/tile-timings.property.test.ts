/**
 * `OsmTileResult.timings` — the properties that must hold for ANY clock.
 *
 * Why this test matters: the two-clock design (`now` epoch, `monotonicNow`
 * separate) is justified in `osm-data-source.ts` by one sentence — *"`Date.now()`
 * steps backwards on an NTP correction… producing a negative `transportMs`
 * inside a breakdown whose whole job is to add up"*. That defence shipped with
 * no test of its own, which is the shape of thing this package writes property
 * tests for: the example-based tests all use well-behaved clocks, so every one
 * of them would stay green against an instrument that emits negatives the
 * moment a real clock misbehaves.
 *
 * The generator therefore includes clocks that are NOT monotone. That is not a
 * scenario anyone expects `monotonicNow` to be handed — it is the adversarial
 * case that says whether "we chose a monotonic clock" is a guarantee or a hope.
 * A source handed a hostile clock should still not produce a negative duration,
 * because a negative in a stage breakdown is worse than a wrong one: it makes
 * the residual close by cancelling, so the reconciliation gate goes quiet
 * exactly when it should shout.
 *
 * @see osm-data-source.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { OverpassSource } from "./overpass-source.js";
import { CachingSource } from "./caching-source.js";
import { MemoryBlobStore } from "./memory-blob-store.js";
import type { OsmTileTimings } from "./osm-data-source.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const TILE = latLngToCell(50.9413, 6.9583, FETCH_RES);

const OK_BODY = {
  version: 0.6,
  elements: [
    { type: "node", id: 1, lat: 50.94, lon: 6.95, tags: { amenity: "bench" } },
  ],
};

/** Every duration field, so a new one cannot quietly escape the properties. */
function durations(timings: OsmTileTimings): readonly [string, number][] {
  return [
    ["slotWaitMs", timings.slotWaitMs],
    ["transportMs", timings.transportMs],
    ["decodeMs", timings.decodeMs],
    ["parseMs", timings.parseMs],
    ...(timings.storeMs === undefined
      ? []
      : ([["storeMs", timings.storeMs]] as [string, number][])),
    ...(timings.joinedMs === undefined
      ? []
      : ([["joinedMs", timings.joinedMs]] as [string, number][])),
    ...(timings.probeMs === undefined
      ? []
      : ([["probeMs", timings.probeMs]] as [string, number][])),
  ];
}

/** A clock driven by a fixed list of readings, cycling once exhausted. */
function clockFrom(readings: readonly number[]) {
  let i = 0;
  return () => readings[i++ % readings.length] ?? 0;
}

describe("no clock produces a negative duration", () => {
  it("holds for OverpassSource over arbitrary, including non-monotone, clocks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), {
          minLength: 1,
          maxLength: 40,
        }),
        async (readings) => {
          const source = new OverpassSource({
            userAgent: "gps-plus-slam-osm-tests/1.0 (+https://example.invalid)",
            fetchImpl: () =>
              Promise.resolve(
                new Response(JSON.stringify(OK_BODY), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            random: () => 0,
            now: () => 1_000_000,
            monotonicNow: clockFrom(readings),
            sleepImpl: () => Promise.resolve(),
          });

          const { timings } = await source.fetchTile(TILE);
          if (timings === undefined) return;
          for (const [field, value] of durations(timings)) {
            expect(
              value,
              `${field} was negative under clock ${JSON.stringify(readings)}`,
            ).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("holds for CachingSource on both the miss and the hit", async () => {
    // Both paths, because they build their timings from different clock pairs
    // and only the hit reads `readCachedTimed`'s numbers back out.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), {
          minLength: 1,
          maxLength: 40,
        }),
        async (readings) => {
          const cached = new CachingSource(
            {
              attribution: "© OpenStreetMap contributors",
              sourceId: "fake",
              fetchTile: (tile) =>
                Promise.resolve({
                  tile,
                  features: [],
                  fetchedAt: 1000,
                  sourceId: "fake",
                  schemaVersion: 3,
                  skipped: [],
                }),
            },
            new MemoryBlobStore(),
            { monotonicNow: clockFrom(readings), schemaVersion: 3 },
          );

          for (const result of [
            await cached.fetchTile(TILE),
            await cached.fetchTile(TILE),
          ]) {
            if (result.timings === undefined) continue;
            for (const [field, value] of durations(result.timings)) {
              expect(
                value,
                `${field} was negative under clock ${JSON.stringify(readings)}`,
              ).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("the shape of a timings object is total", () => {
  it("always names how it was served, and never claims attempts it did not make", async () => {
    // `servedBy` is what disambiguates every zero in the object — a `parseMs`
    // of 0 means "the parser did not run" on a cache hit and "something is
    // broken" on a network delivery. A missing or unexpected value would make
    // every other field unreadable, so it is pinned as a closed set.
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (secondCall) => {
        const cached = new CachingSource(
          {
            attribution: "© OpenStreetMap contributors",
            sourceId: "fake",
            fetchTile: (tile) =>
              Promise.resolve({
                tile,
                features: [],
                fetchedAt: 1000,
                sourceId: "fake",
                schemaVersion: 3,
                skipped: [],
                timings: {
                  servedBy: "network" as const,
                  slotWaitMs: 0,
                  transportMs: 1,
                  decodeMs: 1,
                  parseMs: 1,
                  attempts: 1,
                },
              }),
          },
          new MemoryBlobStore(),
          { schemaVersion: 3 },
        );

        // First call is always the miss; `secondCall` decides whether the
        // property is checked against that or against the hit that follows.
        const first = await cached.fetchTile(TILE);
        const timings = (secondCall ? await cached.fetchTile(TILE) : first)
          .timings;
        expect(timings).toBeDefined();
        expect(["network", "cache", "joined", "stale-on-rate-limit"]).toContain(
          timings?.servedBy,
        );
        // A delivery that touched no network cannot have made attempts.
        // Expressed as an implication rather than an `if`, so the assertion is
        // unconditional and the linter's "no conditional expect" holds: a
        // conditional expect can silently assert nothing when the branch is
        // never taken, which for a property test is the whole failure mode.
        expect(
          timings?.servedBy === "network" || timings?.attempts === 0,
          `${timings?.servedBy} delivery claimed ${String(timings?.attempts)} attempts`,
        ).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
