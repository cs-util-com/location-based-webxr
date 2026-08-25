import { describe, expect, it } from 'vitest';

import { BoundedLocalCacheStore } from './bounded-local-cache-store.js';
import { InMemoryLocalCacheStore } from './local-cache-byte-source.js';

/**
 * Why these tests matter: cached archives are persist()-pinned and 3–68 MB
 * each, so an unbounded store grows until the browser (or the user) gives
 * up. The bound must evict the LEAST recently used entry — including
 * treating a get as use, or a viewer's favorite archive would be evicted by
 * two one-off opens — and `clear()` must actually remove the archives, not
 * just the index.
 */

function entryOf(text: string) {
  return { blob: new Blob([text]) };
}

describe('BoundedLocalCacheStore', () => {
  it('rejects a non-positive or fractional bound at construction', () => {
    const inner = new InMemoryLocalCacheStore();
    expect(() => new BoundedLocalCacheStore(inner, 0)).toThrow(TypeError);
    expect(() => new BoundedLocalCacheStore(inner, 1.5)).toThrow(TypeError);
  });

  it('round-trips entries below the bound', async () => {
    const store = new BoundedLocalCacheStore(new InMemoryLocalCacheStore(), 2);

    await store.put('a', entryOf('A'));
    const got = await store.get('a');
    expect(await got!.blob.text()).toBe('A');
  });

  it('evicts the least recently PUT entry beyond the bound', async () => {
    const store = new BoundedLocalCacheStore(new InMemoryLocalCacheStore(), 2);

    await store.put('a', entryOf('A'));
    await store.put('b', entryOf('B'));
    await store.put('c', entryOf('C'));

    await expect(store.get('a')).resolves.toBeUndefined();
    await expect(store.get('b')).resolves.toBeDefined();
    await expect(store.get('c')).resolves.toBeDefined();
  });

  it('counts a get as use — the read entry survives the next eviction', async () => {
    const store = new BoundedLocalCacheStore(new InMemoryLocalCacheStore(), 2);

    await store.put('a', entryOf('A'));
    await store.put('b', entryOf('B'));
    await store.get('a'); // 'a' is now more recently used than 'b'
    await store.put('c', entryOf('C'));

    await expect(store.get('a')).resolves.toBeDefined();
    await expect(store.get('b')).resolves.toBeUndefined();
  });

  it('delete removes the entry and clear removes everything', async () => {
    const inner = new InMemoryLocalCacheStore();
    const store = new BoundedLocalCacheStore(inner, 3);

    await store.put('a', entryOf('A'));
    await store.put('b', entryOf('B'));
    await store.delete('a');
    await expect(store.get('a')).resolves.toBeUndefined();

    await store.clear();
    await expect(store.get('b')).resolves.toBeUndefined();
    // The archives are gone from the BACKING store too, not just the index.
    await expect(inner.get('b')).resolves.toBeUndefined();
  });

  it('serializes interleaved puts so no index update is lost', async () => {
    const store = new BoundedLocalCacheStore(new InMemoryLocalCacheStore(), 5);

    await Promise.all([
      store.put('a', entryOf('A')),
      store.put('b', entryOf('B')),
      store.put('c', entryOf('C')),
    ]);

    await expect(store.get('a')).resolves.toBeDefined();
    await expect(store.get('b')).resolves.toBeDefined();
    await expect(store.get('c')).resolves.toBeDefined();
  });
});
