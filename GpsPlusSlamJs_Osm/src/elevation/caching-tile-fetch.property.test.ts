/**
 * The caching fetch's one economic guarantee, as a property.
 *
 * Why this test matters:
 * For ANY interleaving of hits and misses over random URL sequences, two things
 * must hold with a working store: every returned body is byte-identical to the
 * canonical bytes for its URL, and the network is asked at most once per
 * distinct URL. The first is correctness (a cache that returns the wrong tile's
 * bytes produces plausible-but-wrong terrain, the exact failure the elevation
 * module is organised around); the second is the entire point of persisting at
 * all. An example-based test pins one interleaving; the property pins the
 * class, including orders where a URL's first appearance is late and repeats
 * are adjacent.
 *
 * @see caching-tile-fetch.ts.md
 */

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { createCachingTileFetch } from "./caching-tile-fetch.js";
import { MemoryBlobStore } from "../source/memory-blob-store.js";

/** Canonical bytes per URL: derived from the index so equality is meaningful. */
function canonicalBytes(index: number): Uint8Array {
  const bytes = new Uint8Array(16 + index);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (index * 31 + i * 7) % 256;
  return bytes;
}

function urlFor(index: number): string {
  return `https://tiles.example/13/${index}/0.png`;
}

/** A sequence of requests, each naming one of up to 8 distinct tile URLs. */
const requestSequence = fc.array(fc.nat({ max: 7 }), {
  minLength: 1,
  maxLength: 40,
});

describe("caching tile fetch, over any hit/miss interleaving", () => {
  it("returns canonical bytes for every request and fetches each distinct URL at most once", async () => {
    await fc.assert(
      fc.asyncProperty(requestSequence, async (sequence) => {
        const store = new MemoryBlobStore();
        const networkCalls = new Map<string, number>();
        const impl: typeof fetch = (input) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          networkCalls.set(url, (networkCalls.get(url) ?? 0) + 1);
          const index = Number(url.split("/")[4]);
          return Promise.resolve(
            new Response(canonicalBytes(index).slice(), { status: 200 }),
          );
        };
        const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

        // Sequential on purpose: the property under test is the store's
        // hit/miss economics, not in-flight dedup (the provider layers its own
        // InFlightRequests above this seam).
        for (const index of sequence) {
          const response = await cachingFetch(urlFor(index));
          const body = new Uint8Array(await response.arrayBuffer());
          expect(body).toEqual(canonicalBytes(index));
        }

        for (const [, count] of networkCalls) {
          expect(count).toBeLessThanOrEqual(1);
        }
        // Stronger than "at most once": with a working store, every distinct
        // URL requested was fetched exactly once, and hit+miss adds up.
        const distinct = new Set(sequence.map(urlFor));
        expect(networkCalls.size).toBe(distinct.size);
        expect(cachingFetch.stats.misses).toBe(distinct.size);
        expect(cachingFetch.stats.hits).toBe(sequence.length - distinct.size);
      }),
      { numRuns: 50 },
    );
  });
});
