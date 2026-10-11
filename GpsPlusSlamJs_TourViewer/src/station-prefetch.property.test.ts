import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import { createStationPrefetch } from "./station-prefetch";

/**
 * Why these properties matter (K4 review R4, R11): whatever order the
 * visitor approaches stations in, finishes them, and the network answers or
 * fails, the prefetch must stay within its budget, must read a path once at
 * a time, and must not ask again for a read that failed for the same
 * station (offline, the guide ticks on every camera frame). The shared-asset
 * rule (R11) is pinned by an example in `station-prefetch.test.ts`.
 */

const PATHS = ["a.png", "b.png", "c.mp3", "d.glb"];
const assets = new Map<string, TourAsset>(
  PATHS.map((p) => [p, { id: p, path: `content/${p}`, kind: "image" }]),
);

function station(id: string, assetIds: readonly string[]): TourStation {
  return {
    id,
    anchor: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: assetIds.map((asset, i) => ({
      id: `s${String(i)}`,
      block: { kind: "image", asset },
      advance: { mode: "tap" },
    })),
  };
}

const op = fc.oneof(
  fc.record({ kind: fc.constant("approach" as const), s: fc.nat(3) }),
  fc.record({ kind: fc.constant("done" as const), s: fc.nat(3) }),
  fc.record({
    kind: fc.constant("answer" as const),
    ok: fc.boolean(),
    size: fc.integer({ min: 1, max: 70 }),
  }),
);

describe("createStationPrefetch (properties)", () => {
  it("stays in budget, reads a path once at a time, and never retries a failure for the same station", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.subarray(PATHS, { minLength: 1 }), {
          minLength: 4,
          maxLength: 4,
        }),
        fc.array(op, { maxLength: 60 }),
        async (stationAssets, ops) => {
          const stations = stationAssets.map((ids, i) =>
            station(`s${String(i)}`, ids),
          );
          const pending: {
            path: string;
            resolve: (b: Blob) => void;
            reject: (e: Error) => void;
          }[] = [];
          const reads: string[] = [];
          const prefetch = createStationPrefetch({
            assets: () => assets,
            read: (path) => {
              reads.push(path);
              return new Promise((resolve, reject) =>
                pending.push({ path, resolve, reject }),
              );
            },
            tour: () => "tour",
            budgetBytes: 100,
          });
          const retriedAfterFailure: string[] = [];
          /** Per path: the stations its read failed for (given up). */
          const failedFor = new Map<string, Set<string>>();
          /** Per path: the stations that asked since its last answer. */
          const askedSince = new Map<string, Set<string>>();
          for (const o of ops) {
            if (o.kind === "approach") {
              const s = stations[o.s]!;
              const before = reads.length;
              prefetch.approach(s, 10, 30);
              for (const id of new Set(stationAssets[o.s])) {
                const path = `content/${id}`;
                if (failedFor.get(path)?.has(s.id) === true) continue;
                const asked = askedSince.get(path) ?? new Set<string>();
                asked.add(s.id);
                askedSince.set(path, asked);
              }
              // Never asked again for a station it failed for (R4).
              for (const path of reads.slice(before)) {
                if (failedFor.get(path)?.has(s.id) === true) {
                  retriedAfterFailure.push(`${path} for ${s.id}`);
                }
              }
            } else if (o.kind === "done") {
              prefetch.done(`s${String(o.s)}`);
            } else {
              const next = pending.shift();
              if (next === undefined) continue;
              const asked = askedSince.get(next.path) ?? new Set<string>();
              askedSince.delete(next.path);
              if (o.ok) {
                next.resolve(new Blob([new Uint8Array(o.size)]));
              } else {
                next.reject(new Error("offline"));
                const failed = failedFor.get(next.path) ?? new Set<string>();
                for (const id of asked) failed.add(id);
                failedFor.set(next.path, failed);
              }
              await new Promise((r) => setTimeout(r, 0));
            }
            // In budget, and one read per path at a time.
            expect(prefetch.heldBytes()).toBeLessThanOrEqual(100);
            const inFlight = pending.map((p) => p.path);
            expect(new Set(inFlight).size).toBe(inFlight.length);
          }
          expect(retriedAfterFailure).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });
});
