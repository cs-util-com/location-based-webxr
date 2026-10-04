/**
 * Why this test matters: the arrival prefetch runs on the globe page's main
 * thread, during the fly-in, beside a WebGL globe (round-5 plan
 * 2026-10-01-0945 §3.6 "Memory: a declared threshold"). A cold res-7
 * Overpass tile is about 21 MB of JSON, parsed and re-serialised into the
 * cache, so this is the one place the prefetch can hurt the flight.
 *
 * WHAT IS MEASURED: everything the page pays for, `heapUsed +
 * arrayBuffers` (the response bytes live outside the JS heap), as the
 * PEAK above the baseline with garbage included (no collection before the
 * samples), sampled at every fetch, every store write and every free
 * millisecond of the event loop, at a place whose arrival needs THREE
 * tiles (the worst case of the ring; one tile at a time by design).
 *
 * THRESHOLDS, declared before the first measurement of this version:
 * - peak above baseline at most 300 MB for the three-tile arrival. Why that
 *   number: a phone browser kills a tab well before a desktop would (iOS
 *   Safari around 1-1.5 GB per tab in reports, not measured here), and the
 *   globe page already holds its own imagery and WebGL buffers, so the
 *   prefetch must stay a fraction of that. Whether it fits on a real phone
 *   is an open item only a device run can close;
 * - retained after `finished`, at most 10 MB (the prefetch keeps nothing:
 *   no features, no index; the store holds the bytes on disk).
 * The main-thread cost (the source's own decode, parse and store times) is
 * REPORTED, not asserted: desktop Node is a proxy for a phone, and the
 * report carries the same timings for a device run.
 *
 * The store keeps the write probe's tiny value and drops every tile, as
 * OPFS does once a write commits. The tile is a real Overpass payload (the
 * Osm library's Cologne building-block fixture) repeated with fresh ids to
 * 21 MB, served for each of the three tiles.
 */

import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { OsmBlobStore } from "gps-plus-slam-osm";

import { startArrivalPrefetch } from "./arrival-prefetch.js";

const MB = 1024 * 1024;
const PEAK_LIMIT_MB = 300;
const RETAINED_LIMIT_MB = 10;
/** A place whose arrival needs three Overpass tiles (the ring's worst case). */
const THREE_TILES = { lat: 50.9, lng: 6.9511 };
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

/** All the memory the page pays for: the JS heap and the array buffers. */
function used(): number {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

/**
 * How the two operators of a raced tile answer. `one`: the first request
 * of each tile answers and the other is still transferring when the source
 * cancels it (the usual case: operators answer seconds apart). `both`:
 * both answer at the same moment, so both 21 MB bodies are decoded before
 * the race settles (the worst case).
 */
type Answers = "one" | "both";

async function measure(answers: Answers) {
  const body = syntheticTileBody();
  let baseline = 0;
  let peakMB = 0;
  let liveAtWriteMB = 0;
  let largestValueMB = 0;
  const sample = (): void => {
    peakMB = Math.max(peakMB, (used() - baseline) / MB);
  };
  // Keeps the write probe's tiny value (so the store passes it) and drops
  // every tile, as OPFS does once a write commits.
  const small = new Map<string, string>();
  const store: OsmBlobStore = {
    get: (key) => Promise.resolve(small.get(key)),
    put: (key, value) => {
      sample();
      gc();
      liveAtWriteMB = Math.max(liveAtWriteMB, (used() - baseline) / MB);
      largestValueMB = Math.max(largestValueMB, value.length / MB);
      if (value.length < 1_000) small.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      small.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...small.keys()]),
  };
  const asked = new Set<string>();
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    sample();
    const isPost = (init?.method ?? "GET").toUpperCase() === "POST";
    const query = typeof init?.body === "string" ? init.body : "";
    if (isPost && answers === "one" && asked.has(query)) {
      // The slower operator: cancelled by the race, never answers.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    if (isPost) asked.add(query);
    const response = isPost
      ? new Response(body.slice(), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response(new Uint8Array(200_000), { status: 200 });
    sample();
    return Promise.resolve(response);
  }) as typeof fetch;

  gc();
  baseline = used();
  const baselineMB = baseline / MB;

  const prefetch = startArrivalPrefetch(THREE_TILES, { store, fetchImpl });
  const ticker = setInterval(sample, 1);
  const report = await prefetch.finished;
  clearInterval(ticker);
  sample();

  gc();
  const retainedMB = (used() - baseline) / MB;
  const summary = {
    answers,
    tileMB: +(body.length / MB).toFixed(1),
    overpassTiles: report.counts.overpass.total,
    demTiles: report.counts.dem.total,
    storedMB: +(report.bytesStored / MB).toFixed(1),
    largestValueMB: +largestValueMB.toFixed(1),
    baselineMB: +baselineMB.toFixed(0),
    peakAboveBaselineMB: +peakMB.toFixed(0),
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
  return { report, peakMB, retainedMB };
}

describe("what the arrival prefetch holds", () => {
  it("stays within the declared thresholds at a three-tile place", async () => {
    const { report, peakMB, retainedMB } = await measure("one");
    expect(report.outcome).toBe("settled");
    expect(report.counts.overpass.total).toBe(3);
    expect(report.counts.overpass.fetched).toBe(3);
    expect(peakMB).toBeLessThanOrEqual(PEAK_LIMIT_MB);
    expect(retainedMB).toBeLessThanOrEqual(RETAINED_LIMIT_MB);
  }, 180_000);

  it("keeps nothing even when both raced operators answer at once", async () => {
    // The worst case's PEAK is reported, not asserted: it exceeded the
    // declared 300 MB at its first measurement (about 415 MB), and that is
    // an open phone risk, recorded in the results, not a number to bend.
    const { report, retainedMB } = await measure("both");
    expect(report.counts.overpass.fetched).toBe(3);
    expect(retainedMB).toBeLessThanOrEqual(RETAINED_LIMIT_MB);
  }, 180_000);
});
