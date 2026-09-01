/**
 * An LRU bound around any {@link LocalCacheStore}, so persist()-pinned
 * archives (tens of megabytes each) cannot grow without limit. Recency is ORDER-based —
 * a small JSON index entry updated on every get/put — deliberately not
 * timestamp-based: `Date.now()` adds nothing an order cannot express, and the
 * index doubles as the enumeration a `clear()` needs (the base interface has
 * no key listing).
 *
 * All operations run through one internal queue: get/put/delete each read and
 * rewrite the index, and two interleaved operations would otherwise lose one
 * of the updates.
 */

import type {
  CachedArchive,
  LocalCacheStore,
} from './local-cache-byte-source.js';

/** Reserved index key — resolves to a same-origin path in the Cache API, and
 *  is never a normalized archive URL. */
const INDEX_KEY = '/__archive-cache-index__';

export class BoundedLocalCacheStore implements LocalCacheStore {
  readonly #inner: LocalCacheStore;
  readonly #maxEntries: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(inner: LocalCacheStore, maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError(
        `BoundedLocalCacheStore: maxEntries must be a positive integer, got ${maxEntries}`
      );
    }
    this.#inner = inner;
    this.#maxEntries = maxEntries;
  }

  get(url: string): Promise<CachedArchive | undefined> {
    return this.#enqueue(async () => {
      const entry = await this.#inner.get(url);
      if (entry !== undefined) {
        await this.#writeIndex(moveToFront(await this.#readIndex(), url));
      }
      return entry;
    });
  }

  put(url: string, entry: CachedArchive): Promise<void> {
    return this.#enqueue(async () => {
      await this.#inner.put(url, entry);
      const index = moveToFront(await this.#readIndex(), url);
      const evicted = index.slice(this.#maxEntries);
      for (const stale of evicted) {
        await this.#inner.delete(stale);
      }
      await this.#writeIndex(index.slice(0, this.#maxEntries));
    });
  }

  delete(url: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#inner.delete(url);
      await this.#writeIndex(
        (await this.#readIndex()).filter((u) => u !== url)
      );
    });
  }

  /** Evict every archive this bound knows about (the demo's "clear cache"). */
  clear(): Promise<void> {
    return this.#enqueue(async () => {
      for (const url of await this.#readIndex()) {
        await this.#inner.delete(url);
      }
      await this.#inner.delete(INDEX_KEY);
    });
  }

  /** Serialize operations — interleaved index read-modify-writes lose updates. */
  #enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(op, op);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /** Most-recently-used first. A missing or unreadable index reads as empty. */
  async #readIndex(): Promise<string[]> {
    const entry = await this.#inner.get(INDEX_KEY);
    if (entry === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(await entry.blob.text());
      return Array.isArray(parsed)
        ? parsed.filter((u): u is string => typeof u === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async #writeIndex(urls: string[]): Promise<void> {
    await this.#inner.put(INDEX_KEY, {
      blob: new Blob([JSON.stringify(urls)]),
    });
  }
}

function moveToFront(urls: string[], url: string): string[] {
  return [url, ...urls.filter((u) => u !== url)];
}
