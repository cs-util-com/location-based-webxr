# draft-persistence.ts

## Purpose

The on-disk shape of an authoring draft: reading and writing it through a
`DraftFileStore`. The RULES are in `authoring-draft.ts`; the OPFS mechanics
are the framework's.

## Public API

- `writeDraftMeta(store, { tourUrl, sizeM, level })` - the tour, the
  printed size, the measured level.
- `writeDraftObject(store, object, blob?)` - one placement. Returns false
  if either file failed, so a half-written photo is reported rather than
  believed.
- `removeDraftObject(store, id)` - deletes one placement AND its photo,
  because an object is two files and a caller rejecting a list of ids
  should not have to know which of them ever reached disk. Neither half
  missing is a failure: a pin has no photo.
- `StoredDraft.storedIds` - EVERY object id the read saw on disk, not
  just the ones that parsed.
  - **It exists because cleanup must cover what the reader refused.** A
    record written by an older version, or a photo whose bytes never landed
    (`writeDraftObject` returns false when the photo write hits a quota
    wall, and the record it already wrote stays), is skipped by `readDraft`
    and leaves files behind. `clear` used to sweep those; since its last
    caller went, deleting only the parsed ids would leak them for the life
    of the origin.
  - Captured at READ time, like the objects, so nothing written afterwards
    can be in the list - which is what keeps a rejection from touching this
    session's work.
- `readDraft(store) -> Promise<StoredDraft | undefined>` -
  `{ draft, photos }`, or `undefined` when there is no meta file.
- `parseDraftObject(text)`, `objectKey(id)`, `photoKey(id)`.

## Invariants & assumptions

- **ONE FILE PER OBJECT, append-only.** Rewriting the whole draft on every
  placement is O(n squared) bytes on the main thread during a live XR
  session, and the full-resolution placed photo (its own round) is about to
  make each object an order of magnitude bigger. Per object it is O(1) -
  and a file that fails to write, or reads back corrupt, costs exactly that
  one object rather than the walk.
- **Validation is the manifest's own.** An object is checked by
  round-tripping it through `parseTourManifest`, the same function the
  finish serialises through, so a draft can never hold something the finish
  would later reject. A second validator here is how the two would come to
  disagree about what a tour object is.
- **The META half validates its own fields**, since no parser owns them.
  `level` in particular must be `null` or carry a string `id` AND a string
  `json`: it is the field that travels furthest, reaching
  `qrLevelEntryName(id)`, which throws on an unsafe id and leaves the
  creator an opaque finish failure with no way forward but to re-measure.
  A meta file written by an older version of the app is the case this
  closes (PR #438 review); the current writer cannot produce one.
- **No meta file means no draft.** A directory of objects cannot say which
  tour it belongs to, and guessing is how a draft is appended to the wrong
  zip.
- **A photo record without its bytes is dropped with them.** It would name
  a `content/<id>.jpg` the rebuilt zip does not contain - the shape of the
  PR #435 bug, and worse here because the safety net would be introducing
  it.
- **The order is stable**, sorted by `createdAtIso` then id: the store
  lists in whatever order the directory yields, and a tour whose objects
  shuffle between restores would produce a different `tour.json` each time
  for no reason a reader could see.

## Examples

```ts
const store = await openDraftNamespace(root, draftKeyForTour(tourUrl));
if (store !== undefined) {
  await writeDraftMeta(store, { tourUrl, sizeM, level });
  await writeDraftObject(store, pin);
  const found = await readDraft(store);
}
```

## Tests

`draft-persistence.test.ts`, against an in-memory store with the same
contract. The ones that carry it: a corrupt record costing only itself, a
photo record dropped with its missing bytes, no meta yielding nothing, and
a property that the order is stable and is the order things were placed in.
