# `osm-bridge/opfs-osm-blob-store.ts`

## Purpose

OPFS-backed persistence for the `OsmBlobStore` that `gps-plus-slam-osm` asks a
consumer to inject.

## Public API

- `class OpfsOsmBlobStore implements OsmBlobStore` — `get`, `put`, `delete`,
  `keys`, plus `stats` (`gets`, `hits`, `puts`, `deletes`, `errors`)
- `interface OsmBlobStore` — declared structurally, see below
- `openOsmStoreDirectory(root, name?): Promise<FileSystemDirectoryHandle>`
- `fileNameFor(key)`, `keyForFileName(name)`, `OSM_STORE_DIR`

## Invariants & assumptions

- **It takes NO dependency on `gps-plus-slam-osm`, and that is load-bearing.**
  The framework is published to npm and `gps-plus-slam-osm` is not, so any
  dependency on it — even an optional peer — makes `pnpm install` fail with a
  registry 404 for every framework consumer. `OsmBlobStore` is therefore declared
  structurally (four methods, stable). This module compiles, ships and installs
  standing alone.
  - **Consequence:** anything needing the OSM package's _runtime_ exports (an
    index/score worker) cannot live here until that package is published. It
    belongs in the consumer app meanwhile — which is where this repo puts worker
    shells regardless.
- **Every failure path is a cache MISS, never a throw.** `CachingSource`'s whole
  contract is that a corrupt or absent entry costs a network request rather than
  a session; a throwing store would turn a storage hiccup into a failed session.
  A failed `put` is warned and swallowed — the tile is already in hand, so losing
  the cache entry costs one future request, while propagating would throw away
  the data too.
- **Keys are escaped into FLAT filenames, not nested directories.** OSM keys
  contain slashes (`osm/v2/<cell>`, `rules/v1/table.csv`) and come from a library
  free to change their shape. Creating directories from a caller-supplied string
  is how a `..` segment becomes a traversal, and it turns `keys()` into a
  recursive walk for no benefit. `encodeURIComponent` is reversible, which
  `listCachedTiles()`'s prefix filter depends on.
- **`keys()` ignores files it did not write**, so the directory can be shared.
- **The directory is injected**, so the store's constructor cannot fail and a
  consumer can place OSM data somewhere evictable separately from recordings.
- **`writable.close()` is in a `finally`** — closing is what commits the write,
  and a leaked writable is worse than a zero-length file (which reads back as a
  miss and is therefore recoverable).

## Examples

```ts
import { CachingSource } from 'gps-plus-slam-osm/source';
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from 'gps-plus-slam-app-framework/osm-bridge';

const store = new OpfsOsmBlobStore({
  directory: await openOsmStoreDirectory(appRootHandle),
});
const source = new CachingSource({ inner: overpass, store });
```

## Tests

`opfs-osm-blob-store.test.ts` — key round-tripping and flatness, listing keys in
their original form, ignoring foreign files, delete idempotence, and the three
failure paths (read, write, list) each staying a miss. A fake
`FileSystemDirectoryHandle` is used because OPFS does not exist in the Node test
environment and because a real backend cannot be asked to fail on demand.
