/**
 * A `fetch`-compatible wrapper that persists GET-tile bytes in a blob store.
 *
 * WHY THIS EXISTS. `TerrariumProvider`'s only cache is a small in-memory Map of
 * decoded tiles, so an offline cold start has no terrain at all — and the AR
 * failure mode is not an error but a silently wrong flat datum. Composed into
 * the provider's `fetchImpl` seam, this wrapper makes every successfully
 * fetched tile survive a restart:
 *
 * ```ts
 * const provider = new TerrariumProvider({
 *   decodePng: browserPngDecoder(),
 *   fetchImpl: createCachingTileFetch({ store }),
 * });
 * ```
 *
 * WHY A FETCH WRAPPER RATHER THAN A PROVIDER DECORATOR. The provider already
 * exposes `fetchImpl?: typeof fetch` as an injection seam, so caching at that
 * seam needs no new provider API, works for any URL template (AWS Terrarium,
 * Mapterhorn, a self-hosted mirror), and stores the ENCODED tile — a PNG/WebP
 * is a fraction of the decoded `Float32Array`'s size, and decode-on-hit is the
 * provider's existing job.
 *
 * CACHE INVALIDATION IS DELIBERATELY NONE (v1) — AND THAT MEANS UNBOUNDED.
 * Terrain tiles are effectively static — the underlying DEMs change on a
 * timescale of years, and a stale hill is still the hill — so this wrapper
 * never expires, revalidates, or evicts. Nothing else bounds it either: the
 * `OsmBlobStore` seam exposes `delete`/`keys` but carries no eviction policy
 * of its own, and no current consumer ever deletes DEM entries. Growth is one
 * encoded tile per distinct URL ever fetched; an explicit eviction pass is a
 * known follow-up, not a property to assume.
 *
 * Runs wherever `Response` and the injected store run — window, Worker, Node.
 * Nothing here touches `window`; persistence portability is the store's
 * business (see `../source/osm-blob-store.ts`).
 *
 * @see caching-tile-fetch.ts.md
 */

import type { OsmBlobStore } from "../source/osm-blob-store.js";

export interface CachingTileFetchStats {
  /** Requests answered from the store, no network involved. */
  hits: number;
  /** Requests that went to the network (whatever the outcome). */
  misses: number;
  /**
   * Tiles fetched successfully whose persistence failed.
   *
   * The tile was still returned — a storage problem (quota, revoked
   * permission) must never become a data problem. Non-zero here means the
   * cache is not retaining, so the symptom without the counter would be "every
   * restart refetches", reading as a slow network rather than a full disk.
   */
  storeFailures: number;
}

export interface CachingTileFetchOptions {
  /**
   * Where tile bytes persist. String-valued, so bytes are stored as base64 —
   * the ~33% overhead is accepted to reuse the package's one persistence seam
   * unchanged rather than grow a parallel binary interface.
   */
  readonly store: OsmBlobStore;
  /** The network. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type CachingTileFetch = typeof fetch & {
  readonly stats: CachingTileFetchStats;
};

/**
 * Wraps `fetch` so that 200-status GET responses are persisted by full request
 * URL and replayed from the store thereafter.
 *
 * - **Hit** — a synthetic `200` carrying the stored bytes, marked with an
 *   `x-tile-cache: hit` header so tests and diagnostics can tell it from a
 *   network response.
 * - **Miss** — delegates to `fetchImpl`. A 200 is persisted from a clone, so
 *   the body the caller receives is never consumed here; non-200s and network
 *   errors pass through untouched and store nothing (caching a transient 404
 *   in a store that never invalidates would poison the URL forever).
 * - **Failing store** — a read failure degrades to a network fetch; a write
 *   failure still returns the fetched tile and increments `storeFailures`.
 * - **Non-GET** — bypasses the cache entirely and delegates untouched.
 */
export function createCachingTileFetch(
  options: CachingTileFetchOptions,
): CachingTileFetch {
  const { store } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const stats: CachingTileFetchStats = { hits: 0, misses: 0, storeFailures: 0 };

  const cachingFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // A pre-aborted signal must reject exactly as the real fetch would — the
    // synthetic-hit path must not be MORE alive than the network it stands in
    // for, or an abort would "succeed" precisely when the cache is warm.
    init?.signal?.throwIfAborted();
    if (methodOf(input, init) !== "GET") return fetchImpl(input, init);

    const url = urlOf(input);

    let stored: string | undefined;
    try {
      stored = await store.get(url);
    } catch {
      // Quota-exceeded and permission-revoked both throw on read; a throwing
      // store is a cache miss, mirroring the OSM tile cache's behaviour.
      stored = undefined;
    }
    if (stored !== undefined) {
      const bytes = fromBase64(stored);
      // A corrupt entry (interrupted write, lying backend) is a miss, never a
      // throw and never served: garbage bytes would decode into plausible but
      // wrong terrain, the exact failure this module must not produce.
      if (bytes !== undefined) {
        stats.hits++;
        return new Response(bytes, {
          status: 200,
          headers: { "x-tile-cache": "hit" },
        });
      }
    }

    stats.misses++;
    const response = await fetchImpl(input, init);
    if (response.status !== 200) return response;

    // A FAILED WRITE MUST NOT LOSE THE TILE. The bytes are snapshotted from a
    // clone — the caller's body is untouched either way — and any failure from
    // here on is counted and swallowed: the network already paid for this
    // tile, and a storage problem must never become a data problem.
    try {
      const bytes = await response.clone().arrayBuffer();
      await store.put(url, toBase64(new Uint8Array(bytes)));
    } catch {
      stats.storeFailures++;
    }
    return response;
  };

  return Object.assign(cachingFetch, { stats });
}

/** Per the fetch spec, `init.method` overrides a `Request` input's method. */
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

/** The cache key: the full request URL, however the caller spelled it. */
function urlOf(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

/**
 * Bytes ↔ base64, via `btoa`/`atob` rather than `Buffer` so this works
 * unchanged in the browser, in a Worker and in Node (same choice as the
 * package's geoid grid). Chunked to stay under the argument-count limit of
 * `String.fromCharCode` on multi-hundred-KB tiles.
 */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
