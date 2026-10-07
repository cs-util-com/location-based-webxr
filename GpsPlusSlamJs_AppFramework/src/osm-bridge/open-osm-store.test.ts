/**
 * Why these tests matter: every writer and reader of the OSM tile cache in a
 * browser (OsmDemo's worker, the globe's arrival prefetch, the globe's city)
 * must open the SAME OPFS store, or a prefetch warms a store nobody reads and
 * the "warm" visit is silently cold. And the absence has to be explicit: a
 * prefetch must KNOW there is no persistent store, because warming memory
 * that dies with the page is pure waste. Moved here from OsmDemo's
 * `osm-tile-cache.test.ts` with the opener (globe city plan 2026-10-05-0040
 * §14, the city as the Osm library's second consumer).
 */

import { describe, expect, it, vi } from 'vitest';

import { OpfsOsmBlobStore } from './opfs-osm-blob-store.js';
import { openPersistentOsmStore } from './open-osm-store.js';

/** A StorageManager whose OPFS root hands out empty directories. */
function fakeStorage(): StorageManager {
  const directory = {
    getDirectoryHandle: vi.fn(() => Promise.resolve(directory)),
  };
  return {
    getDirectory: () => Promise.resolve(directory),
  } as unknown as StorageManager;
}

describe('openPersistentOsmStore', () => {
  it("opens the OPFS store in the 'osm' directory", async () => {
    const storage = fakeStorage();
    const store = await openPersistentOsmStore({ storage });
    expect(store).toBeInstanceOf(OpfsOsmBlobStore);
  });

  it('answers undefined, not a memory store, when OPFS is refused', async () => {
    const storage = {
      getDirectory: () =>
        Promise.reject(new DOMException('no', 'SecurityError')),
    } as unknown as StorageManager;
    await expect(openPersistentOsmStore({ storage })).resolves.toBeUndefined();
  });

  it('answers undefined when there is no storage manager at all', async () => {
    await expect(
      openPersistentOsmStore({ storage: undefined })
    ).resolves.toBeUndefined();
  });

  it('hands the injected warn to the OPFS store', async () => {
    // Why: OsmDemo's worker injects the framework logger here so a failed
    // cache write stays a Sentry Issue; dropping it on the way would route
    // the failure to the console default without anything noticing.
    const warn = vi.fn();
    const store = await openPersistentOsmStore({
      storage: fakeStorage(),
      warn,
    });
    // The fake directory cannot create files, so the write fails.
    await store?.put('osm/v2/a', '1');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
