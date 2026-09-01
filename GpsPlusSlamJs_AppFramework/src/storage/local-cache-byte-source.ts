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
import type { ArchiveValidators } from './range-probe.js';

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

/** A complete cached copy plus the freshness validators it was stored with —
 *  what a revalidating open compares against the live file. */
export interface CachedArchive {
  readonly blob: Blob;
  readonly validators?: ArchiveValidators;
}

/** Persistent store of complete archives, keyed by URL. */
export interface LocalCacheStore {
  /** The complete cached copy, or undefined if not present. */
  get(url: string): Promise<CachedArchive | undefined>;
  /** Store a complete copy atomically (only a finished copy is ever readable). */
  put(url: string, entry: CachedArchive): Promise<void>;
  /** Evict a copy — used to purge a cached blob that no longer parses. */
  delete(url: string): Promise<void>;
}

/** In-memory store — the Node test/demo backing where `caches` is unavailable. */
export class InMemoryLocalCacheStore implements LocalCacheStore {
  readonly #map = new Map<string, CachedArchive>();

  get(url: string): Promise<CachedArchive | undefined> {
    return Promise.resolve(this.#map.get(url));
  }

  put(url: string, entry: CachedArchive): Promise<void> {
    this.#map.set(url, entry);
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

  async get(url: string): Promise<CachedArchive | undefined> {
    const cache = await caches.open(this.#cacheName);
    const res = await cache.match(url);
    if (!res) return undefined;
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    const validators =
      etag !== null || lastModified !== null
        ? {
            ...(etag !== null ? { etag } : {}),
            ...(lastModified !== null ? { lastModified } : {}),
          }
        : undefined;
    return {
      blob: await res.blob(),
      ...(validators !== undefined ? { validators } : {}),
    };
  }

  async put(url: string, entry: CachedArchive): Promise<void> {
    const cache = await caches.open(this.#cacheName);
    // The validators ride as headers on the stored Response — the Cache API's
    // natural metadata slot, read back verbatim in get().
    const headers = new Headers();
    if (entry.validators?.etag !== undefined) {
      headers.set('etag', entry.validators.etag);
    }
    if (entry.validators?.lastModified !== undefined) {
      headers.set('last-modified', entry.validators.lastModified);
    }
    await cache.put(url, new Response(entry.blob, { headers }));
  }

  async delete(url: string): Promise<void> {
    const cache = await caches.open(this.#cacheName);
    await cache.delete(url);
  }
}
