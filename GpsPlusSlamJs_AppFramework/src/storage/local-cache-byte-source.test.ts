import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CacheApiStore,
  InMemoryLocalCacheStore,
  LocalCacheByteSource,
  requestPersistentStorage,
} from './local-cache-byte-source.js';

/**
 * Why these tests matter: this module was merged from an external PR with no
 * tests in this repo at all (its sidecar pointed at integration tests in the
 * AUTHOR'S project). `LocalCacheByteSource` is the read path every cache hit
 * serves, and `CacheApiStore.put` used to call `navigator.storage.persist()`
 * on every write — which can raise a Firefox permission prompt mid-flow (D6).
 * The stubbed-globals tests pin that `put` stays prompt-free and that
 * persistence is an explicit, separate call.
 */

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('LocalCacheByteSource', () => {
  it('serves ranges by slicing the blob', async () => {
    const source = new LocalCacheByteSource(new Blob([BYTES]));

    expect(source.size).toBe(BYTES.length);
    await expect(source.read(2, 3)).resolves.toEqual(new Uint8Array([3, 4, 5]));
  });

  it('resolves zero- and negative-length reads empty (uniform ByteSource invariant)', async () => {
    const source = new LocalCacheByteSource(new Blob([BYTES]));

    await expect(source.read(3, 0)).resolves.toEqual(new Uint8Array(0));
    await expect(source.read(3, -1)).resolves.toEqual(new Uint8Array(0));
  });
});

describe('InMemoryLocalCacheStore', () => {
  it('round-trips put/get and forgets on delete', async () => {
    const store = new InMemoryLocalCacheStore();
    const blob = new Blob([BYTES]);

    await expect(store.get('u')).resolves.toBeUndefined();
    await store.put('u', blob);
    await expect(store.get('u')).resolves.toBe(blob);
    await store.delete('u');
    await expect(store.get('u')).resolves.toBeUndefined();
  });
});

describe('CacheApiStore (stubbed Cache API)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A minimal `caches` fake over a Map of url → Response. */
  function stubCaches(): Map<string, Response> {
    const entries = new Map<string, Response>();
    vi.stubGlobal('caches', {
      open: () =>
        Promise.resolve({
          match: (url: string) => Promise.resolve(entries.get(url)),
          put: (url: string, res: Response) => {
            entries.set(url, res);
            return Promise.resolve();
          },
          delete: (url: string) => Promise.resolve(entries.delete(url)),
        }),
    });
    return entries;
  }

  it('put stores without calling navigator.storage.persist (no mid-flow prompt)', async () => {
    stubCaches();
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });

    const store = new CacheApiStore();
    await store.put('https://x/a.zip', new Blob([BYTES]));

    expect(persist).not.toHaveBeenCalled();
  });

  it('round-trips a blob through the stubbed cache and deletes it', async () => {
    stubCaches();
    const store = new CacheApiStore();

    await store.put('https://x/a.zip', new Blob([BYTES]));
    const blob = await store.get('https://x/a.zip');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(BYTES);

    await store.delete('https://x/a.zip');
    await expect(store.get('https://x/a.zip')).resolves.toBeUndefined();
  });
});

describe('requestPersistentStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the browser grant when the API exists', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports false when the API is absent instead of throwing', async () => {
    vi.stubGlobal('navigator', {});

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
