/**
 * The OPFS-backed OSM blob store.
 *
 * WHY THESE TESTS MATTER. This adapter sits between a library whose whole
 * caching contract is "a storage problem costs a network request, never a
 * session" and a browser API that fails in half a dozen ways. Every test here
 * is about a failure path staying a *miss* rather than becoming an exception —
 * because the one behaviour that would break the design is a throwing cache.
 *
 * The key escaping is the other half: OSM keys contain slashes, and `keys()`
 * has to return them intact or `listCachedTiles()`'s prefix filter silently
 * matches nothing.
 *
 * A fake `FileSystemDirectoryHandle` is used rather than real OPFS: OPFS is not
 * available in the Node test environment, and faking it is what lets the
 * failure paths be tested at all — a real backend cannot be asked to fail on
 * demand.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  OpfsOsmBlobStore,
  fileNameFor,
  keyForFileName,
  openOsmStoreDirectory,
} from './opfs-osm-blob-store.js';

/** A minimal in-memory stand-in for `FileSystemDirectoryHandle`. */
function fakeDirectory(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const failures = {
    read: false,
    write: false,
    list: false,
    /**
     * `write()` rejects after buffering part of the payload — the realistic
     * quota-exceeded-mid-stream shape, and the one that distinguishes
     * `close()` (commits the truncated temp) from `abort()` (discards it).
     */
    writeChunk: false,
  };

  const handle = {
    files,
    failures,
    getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && options?.create !== true) {
        return Promise.reject(
          Object.assign(new Error('not found'), { name: 'NotFoundError' })
        );
      }
      return Promise.resolve({
        getFile() {
          if (failures.read) return Promise.reject(new Error('read failed'));
          return Promise.resolve({
            text: () => Promise.resolve(files.get(name) ?? ''),
          });
        },
        createWritable() {
          if (failures.write) return Promise.reject(new Error('write failed'));
          // Models the real API: writes land in a TEMP file, `close()` swaps it
          // over the original and `abort()` throws it away. A fake that only
          // had `close()` could not tell a correct failure path from one that
          // commits a truncated file over good data.
          let buffer = '';
          return Promise.resolve({
            write: (chunk: string) => {
              if (failures.writeChunk) {
                buffer += chunk.slice(0, Math.ceil(chunk.length / 2));
                return Promise.reject(new Error('quota exceeded'));
              }
              buffer += chunk;
              return Promise.resolve();
            },
            close: () => {
              files.set(name, buffer);
              return Promise.resolve();
            },
            abort: () => Promise.resolve(),
          });
        },
      });
    },
    removeEntry(name: string) {
      if (!files.delete(name)) {
        return Promise.reject(
          Object.assign(new Error('not found'), { name: 'NotFoundError' })
        );
      }
      return Promise.resolve();
    },
    // The real FileSystemDirectoryHandle.keys() IS an async generator, so the
    // fake must match its shape even though nothing here needs to await.
    // eslint-disable-next-line @typescript-eslint/require-await -- see above
    async *keys() {
      if (failures.list) throw new Error('list failed');
      for (const name of files.keys()) yield name;
    },
    getDirectoryHandle(_name: string, _options?: { create?: boolean }) {
      return Promise.resolve(handle);
    },
  };
  return handle as unknown as FileSystemDirectoryHandle & typeof handle;
}

const storeOn = (directory: ReturnType<typeof fakeDirectory>) =>
  new OpfsOsmBlobStore({ directory });

describe('key escaping', () => {
  it('round-trips a key containing slashes', () => {
    // OSM keys are `osm/v2/<cell>` and `rules/v1/table.csv`. If `keys()` cannot
    // return them intact, `listCachedTiles()`'s prefix filter matches nothing
    // and the cache looks empty while being full.
    const key = 'osm/v2/871fa199affffff';
    expect(keyForFileName(fileNameFor(key))).toBe(key);
  });

  it('produces a FLAT filename with no path separators', () => {
    // Nesting directories from a caller-supplied string is how a `..` segment
    // becomes a traversal. Escaping removes the question entirely.
    expect(fileNameFor('osm/v2/../../etc/passwd')).not.toContain('/');
  });

  it('ignores files it did not write', () => {
    expect(keyForFileName('session.json')).toBeUndefined();
    expect(keyForFileName('%ZZ.blob')).toBeUndefined();
  });
});

describe('reading and writing', () => {
  it('round-trips a value', async () => {
    const store = storeOn(fakeDirectory());
    await store.put('osm/v2/abc', '{"tile":"abc"}');
    await expect(store.get('osm/v2/abc')).resolves.toBe('{"tile":"abc"}');
  });

  it('returns undefined for a key that was never written', async () => {
    const store = storeOn(fakeDirectory());
    await expect(store.get('osm/v2/missing')).resolves.toBeUndefined();
  });

  it('lists written keys in their ORIGINAL form', async () => {
    const store = storeOn(fakeDirectory());
    await store.put('osm/v2/a', '1');
    await store.put('rules/v1/table.csv', '2');
    expect([...(await store.keys())].sort()).toEqual([
      'osm/v2/a',
      'rules/v1/table.csv',
    ]);
  });

  it('does not list unrelated files sharing the directory', async () => {
    const store = storeOn(fakeDirectory({ 'session.json': '{}' }));
    await store.put('osm/v2/a', '1');
    expect(await store.keys()).toEqual(['osm/v2/a']);
  });

  it('deletes, and deleting something absent is success', async () => {
    const store = storeOn(fakeDirectory());
    await store.put('osm/v2/a', '1');
    await store.delete('osm/v2/a');
    await expect(store.get('osm/v2/a')).resolves.toBeUndefined();
    // No throw: removing what is not there is the desired end state already.
    await expect(store.delete('osm/v2/a')).resolves.toBeUndefined();
  });
});

describe('failures stay misses', () => {
  it('a read failure is a miss, not a throw', async () => {
    // THE contract this adapter exists to uphold: `CachingSource` treats a
    // corrupt or absent entry as a cache miss and fetches. A throwing store
    // would turn a storage hiccup into a failed session.
    const directory = fakeDirectory();
    const store = storeOn(directory);
    await store.put('osm/v2/a', '1');
    directory.failures.read = true;
    await expect(store.get('osm/v2/a')).resolves.toBeUndefined();
  });

  it('a write failure does not fail the fetch that triggered it', async () => {
    // The tile is already in hand when `put` runs. Losing the cache entry costs
    // one future request; propagating the error would throw away the data too.
    const directory = fakeDirectory();
    directory.failures.write = true;
    const store = storeOn(directory);
    await expect(store.put('osm/v2/a', '1')).resolves.toBeUndefined();
    expect(store.stats.errors).toBe(1);
  });

  it('a write that fails part-way leaves the PREVIOUS entry intact', async () => {
    // Why this test matters: `close()` is what COMMITS the temp file, so
    // closing on the failure path swaps a truncated blob over a good one. The
    // realistic trigger is quota exceeded mid-stream on a cache holding tens of
    // MB of res-7 tiles, and the damage outlives the failure: `CachingSource`
    // only rejects entries that fail `JSON.parse`/`isTileResult`, so a
    // truncated blob is a permanent miss on that tile until something evicts
    // it. Discarding the temp turns that into an ordinary miss instead.
    const directory = fakeDirectory();
    const store = storeOn(directory);
    await store.put('osm/v2/a', '{"tile":"a","features":[]}');

    directory.failures.writeChunk = true;
    await expect(
      store.put('osm/v2/a', 'x'.repeat(64))
    ).resolves.toBeUndefined();

    expect(await store.get('osm/v2/a')).toBe('{"tile":"a","features":[]}');
    expect(store.stats.errors).toBe(1);
  });

  it('a listing failure yields no keys rather than throwing', async () => {
    const directory = fakeDirectory();
    directory.failures.list = true;
    const store = storeOn(directory);
    await expect(store.keys()).resolves.toEqual([]);
  });

  it('counts hits and misses so a consumer can see the cache working', async () => {
    const store = storeOn(fakeDirectory());
    await store.put('osm/v2/a', '1');
    await store.get('osm/v2/a');
    await store.get('osm/v2/b');
    expect(store.stats).toMatchObject({ gets: 2, hits: 1, puts: 1 });
  });
});

describe('openOsmStoreDirectory', () => {
  it('creates the subdirectory rather than requiring it to exist', async () => {
    const root = fakeDirectory();
    const spy = vi.spyOn(root, 'getDirectoryHandle');
    await openOsmStoreDirectory(root);
    expect(spy).toHaveBeenCalledWith('osm', { create: true });
  });
});
