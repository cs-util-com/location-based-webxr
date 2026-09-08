# tour-archive.ts

**Purpose:** where `tour.json` and its content files live inside a tour
archive, and how to read the manifest out of one - the `tour.json`
counterpart of `qr/qr-level-archive.ts`. Writer (the Tour Viewer's finish
step) and reader (the visitor's open path) share these names so placed
content cannot become invisible through a drifted entry name.

## Public API

- `TOUR_MANIFEST_ENTRY = 'tour.json'`, `TOUR_CONTENT_FOLDER = 'content'`.
- `tourContentEntryName(id, extension): string` → `content/<id>.<ext>`;
  throws `TypeError` for an id or extension that is not one path-safe
  segment (both reach a zip path).
- `tourManifestEntryOf(entryNames): string | null` - the manifest entry,
  tolerating ONE wrapping folder (`mytour/tour.json`), shallowest wins.
- `readTourManifestFromEntries(entryNames, readText): Promise<TourManifest | null>`
  - `null` when the archive has no manifest (a recorder zip is normal).
  - REJECTS when a manifest exists but is broken: unlike a single bad level
    file, an unreadable manifest means the whole placement is lost, and
    the visitor deserves the message over a silently empty tour.

## Invariants & assumptions

- Archive-agnostic: entry names in, read-by-name in; the zip library stays
  on the caller's side (the viewer's `TourSession`, the rebuild).
- The wrapping-folder tolerance matches the framework's `actions/`,
  `session.json` and `qr/` parsers.

## Examples

```ts
const manifest = await readTourManifestFromEntries(names, readText);
const photoPath = tourContentEntryName(object.id, 'jpg');
```

## Tests

`tour-archive.test.ts` - the content name and its guards, the entry match
(root, wrapped, shallowest, non-matches), null for no manifest, parse of
the writer's name, rejection of a broken manifest.
