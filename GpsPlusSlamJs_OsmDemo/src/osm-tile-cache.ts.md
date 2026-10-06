# osm-tile-cache.ts - the OSM tile cache's store and source, built once

- Purpose: the one place OsmDemo's worker and the globe's arrival prefetch
  (round-5 plan `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md`
  §3.6, DEC-GL5-8) build the OSM tile cache's store and its Overpass source,
  so the prefetch warms exactly the cache OsmDemo reads.
- Public API:
  - `OSM_DEMO_USER_AGENT` - how the demo identifies itself to the Overpass
    operators (the `User-Agent` and `Referer` headers).
  - `openOsmStore({ storage?, warn? })` -> the framework's
    `openPersistentOsmStore` (`gps-plus-slam-app-framework/osm-bridge`; it
    lived here until 2026-10-06, when the globe's city became a third
    caller, globe city plan 2026-10-05-0040 §14), or a `MemoryBlobStore`
    (the worker's store: it must start without OPFS). `warn` is where the
    store reports failures (the worker passes the framework logger,
    `worker/osm-store-warn.ts`; the default is `console.warn`).
  - `createOsmTileSource(store, { fetchImpl? })` -> `CachingSource` over
    `OverpassSource` with the demo's user agent. Every OsmDemo tile fetch
    (foreground, ring prefetch, arrival prefetch) goes through one of these.
- Invariants & assumptions:
  - The cache key is the library's `osm/v{OVERPASS_SCHEMA_VERSION}/{tile}`
    and the directory is the framework's `OSM_STORE_DIR` (`osm`). Both are
    the libraries' own constants; this module only composes them.
  - The framework's `openPersistentOsmStore` answers `undefined` instead of falling back,
    because a prefetch must know when nothing it fetches would outlive the
    page; the worker's `openOsmStore` falls back to memory instead.
  - Lab-loadable: it imports only `gps-plus-slam-osm` and
    `gps-plus-slam-app-framework/osm-bridge`, which the globe lab maps to
    served TypeScript (`arrival-prefetch.ts.md` has the import map).
- Examples:

  ```ts
  const store = await openOsmStore();
  const source = createOsmTileSource(store);
  const tile = await source.fetchTile("871fa199affffff", { signal });
  ```

- Tests: `osm-tile-cache.test.ts` - the worker's store falls back to memory
  and is the persistent one when OPFS is there (the opener's own tests moved
  to the framework's `open-osm-store.test.ts`), and the
  source writes the key OsmDemo reads while
  sending the demo's user agent.
