# open-osm-store.ts

- Purpose: open the browser's persistent OSM tile store (the OPFS `osm`
  directory every reader and writer of the cache shares), or answer
  `undefined` when there is none. Moved here from OsmDemo's
  `osm-tile-cache.ts` on 2026-10-06 (globe city plan 2026-10-05-0040 §14):
  OsmDemo's worker, the globe's arrival prefetch and the globe's city all
  open it, and storage glue three callers share belongs beside the store.
- Public API:
  - `openPersistentOsmStore({ storage?, warn? })` →
    `Promise<OsmBlobStore | undefined>`: an `OpfsOsmBlobStore` on
    `openOsmStoreDirectory(storage.getDirectory())`, with `warn` handed to
    it. `storage` defaults to `navigator.storage`; an explicit `undefined`
    means there is none. Never throws: no storage manager, OPFS refused or
    a throwing private mode all answer `undefined`.
  - `OpenOsmStoreOptions`.
- Invariants & assumptions:
  - `undefined`, never a memory fallback: a worker falls back to the Osm
    library's `MemoryBlobStore` itself (this package does not depend on
    that library), while a prefetch must know nothing it fetches would
    outlive the page.
  - Every caller opens the same directory (`OSM_STORE_DIR`), which is what
    makes a prefetch's warm-up visible to the city that reads it.
- Examples:

  ```ts
  const store = (await openPersistentOsmStore()) ?? new MemoryBlobStore();
  ```

- Tests: `open-osm-store.test.ts` - the OPFS store in the `osm` directory,
  `undefined` when OPFS is refused or there is no storage manager, and the
  injected `warn` reaching the store.
