/**
 * Why this test matters: the arrival prefetch runs on the globe page's main
 * thread, during the fly-in, beside a WebGL globe (round-5 plan
 * 2026-10-01-0945 §3.6 "Memory: a declared threshold"). A cold res-7
 * Overpass tile is about 21 MB of JSON, parsed and re-serialised into the
 * cache, so this is the one place the prefetch can hurt the flight. The
 * thresholds were declared BEFORE the first measurement:
 * - transient: the LIVE JS heap above the baseline (collected first), read
 *   at the moment the tile is written to the store, when the parsed
 *   features and their serialised form are both alive: at most 200 MB per
 *   cold 21 MB tile;
 * - retained: after `finished`, at most 10 MB (the prefetch keeps nothing:
 *   no features, no index, the store holds the bytes on disk);
 * - the main-thread cost (the source's own decode, parse and store times)
 *   and the heap before collection are REPORTED, not asserted: this is
 *   desktop Node, a proxy for a phone, which only a device measurement can
 *   settle (the report carries the same timings for that).
 * The store here records sizes and drops the values, as OPFS does once a
 * write commits. The tile is a real Overpass payload (the Osm library's
 * Cologne building-block fixture) repeated with fresh ids to 21 MB.
 */

import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { OsmBlobStore } from "gps-plus-slam-osm";

import { startArrivalPrefetch } from "./arrival-prefetch.js";

const MB = 1024 * 1024;
const TARGET_BYTES = 21 * 1000 * 1000;

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

interface OverpassElement {
  type: string;
  id: number;
  nodes?: number[];
  members?: { ref: number }[];
}

/** The fixture payload, repeated with offset ids to about 21 MB. */
function syntheticTileBody(): Uint8Array {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../GpsPlusSlamJs_Osm/src/testdata/building-block.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { payload: { elements: OverpassElement[] } };
  const one = JSON.stringify(fixture.payload).length;
  const copies = Math.ceil(TARGET_BYTES / one);
  const elements: OverpassElement[] = [];
  for (let copy = 0; copy < copies; copy++) {
    const offset = copy * 10_000_000_000;
    for (const element of fixture.payload.elements) {
      elements.push({
        ...element,
        id: element.id + offset,
        ...(element.nodes
          ? { nodes: element.nodes.map((n) => n + offset) }
          : {}),
        ...(element.members
          ? {
              members: element.members.map((m) => ({
                ...m,
                ref: m.ref + offset,
              })),
            }
          : {}),
      });
    }
  }
  return new TextEncoder().encode(
    JSON.stringify({ ...fixture.payload, elements }),
  );
}

describe("what the arrival prefetch holds", () => {
  it("stays within the declared memory thresholds for a cold 21 MB tile", async () => {
    const body = syntheticTileBody();
    let atWriteMB = 0;
    let liveAtWriteMB = 0;
    let largestValueMB = 0;
    let baseline = 0;
    const store: OsmBlobStore = {
      get: () => Promise.resolve(undefined),
      put: (_key, value) => {
        atWriteMB = Math.max(
          atWriteMB,
          (process.memoryUsage().heapUsed - baseline) / MB,
        );
        gc();
        liveAtWriteMB = Math.max(
          liveAtWriteMB,
          (process.memoryUsage().heapUsed - baseline) / MB,
        );
        largestValueMB = Math.max(largestValueMB, value.length / MB);
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        (init?.method ?? "GET").toUpperCase() === "POST"
          ? new Response(body.slice(), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(new Uint8Array(200_000), { status: 200 }),
      )) as typeof fetch;

    gc();
    baseline = process.memoryUsage().heapUsed;

    const prefetch = startArrivalPrefetch(
      { lat: 50.9413, lng: 6.9583 },
      { store, fetchImpl },
    );
    const report = await prefetch.finished;

    gc();
    const retainedMB = (process.memoryUsage().heapUsed - baseline) / MB;
    const summary = {
      tileMB: +(body.length / MB).toFixed(1),
      overpassTiles: report.counts.overpass.total,
      demTiles: report.counts.dem.total,
      storedMB: +(report.bytesStored / MB).toFixed(1),
      largestValueMB: +largestValueMB.toFixed(1),
      heapAtWriteMB: +atWriteMB.toFixed(0),
      liveAtWriteMB: +liveAtWriteMB.toFixed(0),
      retainedMB: +retainedMB.toFixed(1),
      mainThreadMs: report.overpassTimings.map((t) => ({
        decode: Math.round(t.decodeMs),
        parse: Math.round(t.parseMs),
        store: Math.round(t.storeMs ?? 0),
      })),
      elapsedMs: +report.elapsedMs.toFixed(0),
    };
    console.info("arrival prefetch memory", JSON.stringify(summary));

    expect(report.outcome).toBe("settled");
    expect(report.counts.overpass.fetched).toBe(report.counts.overpass.total);
    expect(liveAtWriteMB / report.counts.overpass.total).toBeLessThanOrEqual(
      200,
    );
    expect(retainedMB).toBeLessThanOrEqual(10);
  }, 120_000);
});
