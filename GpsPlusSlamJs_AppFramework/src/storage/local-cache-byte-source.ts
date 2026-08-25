/**
 * A persistent full copy of a remote archive that on-demand reads can switch
 * to once a background warm-download completes.
 *
 * `LocalCacheByteSource` serves ranges by slicing a `Blob` — lazy random
 * access with no heap blow-up, so a large archive never loads whole into
 * memory. `LocalCacheStore` abstracts *where* the complete copy lives:
 * `CacheApiStore` in the browser (evictable → guarded by
 * `storage.persist()`), and `InMemoryLocalCacheStore` for Node tests where
 * `caches` does not exist.
 */

import type { ByteSource } from './byte-source.js';

/** Random-access reader over a complete, locally-held archive Blob. */
export class LocalCacheByteSource implements ByteSource {
  readonly size: number;
  readonly #blob: Blob;

  constructor(blob: Blob) {
    this.#blob = blob;
    this.size = blob.size;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    // Uniform ByteSource invariant: zero/negative-length reads resolve empty
    // locally (mirrors RemoteRangeByteSource, where they would be an invalid
    // Range header).
    if (length <= 0) return new Uint8Array(0);
    const slice = this.#blob.slice(offset, offset + length);
    return new Uint8Array(await slice.arrayBuffer());
  }
}

/** Persistent store of complete archives, keyed by URL. */
export interface LocalCacheStore {
  /** The complete cached copy, or undefined if not present. */
  get(url: string): Promise<Blob | undefined>;
  /** Store a complete copy atomically (only a finished copy is ever readable). */
  put(url: string, blob: Blob): Promise<void>;
  /** Evict a copy — used to purge a cached blob that no longer parses. */
  delete(url: string): Promise<void>;
}

/** In-memory store — the Node test/demo backing where `caches` is unavailable. */
export class InMemoryLocalCacheStore implements LocalCacheStore {
  readonly #map = new Map<string, Blob>();

  get(url: string): Promise<Blob | undefined> {
    return Promise.resolve(this.#map.get(url));
  }

  put(url: string, blob: Blob): Promise<void> {
    this.#map.set(url, blob);
    return Promise.resolve();
  }

  delete(url: string): Promise<void> {
    this.#map.delete(url);
    return Promise.resolve();
  }
}

/**
 * Ask the browser to exempt this origin's storage from automatic eviction —
 * best-effort, returns whether persistence is (now) granted. Deliberately a
 * SEPARATE, explicit call rather than a side effect of `CacheApiStore.put`:
 * in Firefox `storage.persist()` can raise a permission prompt, which must
 * happen at one deliberate moment a caller chooses (e.g. when a warm-download
 * begins), never on every cache write mid-flow.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false; // absent API (older browsers, Node) counts as not granted
  }
}

/**
 * Cache API store (browser). `cache.put` only exposes an entry once its body
 * has been fully consumed, and a caller that re-parses a cached copy before
 * trusting it (evicting a poisoned one) needs no extra write-then-promote
 * dance here. Eviction protection is the caller's move: call
 * `requestPersistentStorage()` once at a deliberate moment — `put` itself
 * never triggers a permission prompt.
 *
 * Exercised in Node with stubbed `caches`/`navigator` globals; the real Cache
 * API behavior is proven by the TourViewer e2e suite.
 */
export class CacheApiStore implements LocalCacheStore {
  readonly #cacheName: string;

  constructor(cacheName = 'range-archives') {
    this.#cacheName = cacheName;
  }

  async get(url: string): Promise<Blob | undefined> {
    const cache = await caches.open(this.#cacheName);
    const res = await cache.match(url);
    if (!res) return undefined;
    return res.blob();
  }

  async put(url: string, blob: Blob): Promise<void> {
    const cache = await caches.open(this.#cacheName);
    await cache.put(url, new Response(blob));
  }

  async delete(url: string): Promise<void> {
    const cache = await caches.open(this.#cacheName);
    await cache.delete(url);
  }
}
