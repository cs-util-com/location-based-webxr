# opfs-file-names.ts

## Purpose

Escape a caller-supplied key into a flat OPFS filename, and back.

## Public API

- `fileNameFor(key) -> string` - `encodeURIComponent(key) + '.blob'`.
- `keyForFileName(name) -> string | undefined` - the inverse; `undefined`
  for anything without the suffix, and for a malformed percent-escape.

## Invariants & assumptions

- **Traversal-proof.** Keys come from callers free to change their shape:
  an OSM tile key like `osm/v2/871fa199affffff`, a tour URL a creator
  pasted. `encodeURIComponent` escapes `/`, so `.` runs are harmless once
  slashes are gone and no key can name a directory, let alone `..`.
- **Reversible**, and that is load-bearing rather than tidy: listing a
  directory and handing back keys is how both callers enumerate, and the
  OSM package's `listCachedTiles()` filters those keys by prefix.
- **An unreadable name is not ours.** `keyForFileName` returns `undefined`
  rather than a best guess, because surfacing a key no `get` could resolve
  is worse than skipping a file somebody else wrote.

## Why it lives here

It was inside `osm-bridge/opfs-osm-blob-store.ts` until the Tour Viewer's
authoring draft needed the same pair of properties (M5). Two copies of an
escaping rule is how one of them quietly stops round-tripping, and the
`osm-bridge` module re-exports these names so its own public surface did
not change.

## Tests

`opfs-osm-blob-store.test.ts` (the round trip, the traversal case, and the
rejection of a foreign filename) and `opfs-draft-store.test.ts` (a key with
slashes landing in exactly one flat file that still round-trips).
