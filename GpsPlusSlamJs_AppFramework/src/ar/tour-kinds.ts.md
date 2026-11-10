# tour-kinds.ts

**Purpose:** THE list of block kinds a tour holds. `TOUR_KINDS` has one row
per kind, and a row says what the format knows about that kind once: its
views, its capped texts, how its own fields are read, which assets it
names, and the minor that brought it. `tour-blocks.ts` derives the public
tables from it and keeps the envelope (id, kind, view, pose).

It is a static list in source code, never a registry: nothing in a tour
declares a kind or a field, because a tour is untrusted input.

## Public API

- `TOUR_KINDS` - the rows, keyed by kind. The key order is the order of
  every derived table.
- `TourBlockOfKind` - one line per kind, kind to block type. `TourBlockKind`
  is its keys and `TourBlock` its values.
- `TourKindRow<B>` - a row:
  - `sinceMinor`: the minor that brought the kind.
  - `viewsSince?`: views newer than the kind, by minor.
  - `views`, `freeViews`, `worldViews`: all views, those a free block may
    hold, those drawn in the world while the block is present.
  - `floor`: what a free block falls back to when its view is unknown here.
  - `text`: every capped text, as `TourTextRule`.
  - `read(v, view, ctx)`: the kind's own fields, in writing order; `view` is
    null when a lenient reader does not know it. Built with the toolkit
    (`tour-block-read.ts`).
  - `refs(block)`: the assets the block names, shown or not.
- `TourAssetRef` - `{ id, kind, required, field, optional? }`. `required`
  false is what the format lets be missing: a picture a long text's body
  names. `field` is the block's field that names it (`image`, `poster`,
  `narration` - a record holding it -, `body` - a text naming it).
  `optional` says the block stands without that field (a narration, a
  poster, a voice); a required reference that is not optional is the
  block's own file. The editor reads these to tell a block made of a file
  (its delete deletes the block) from one that only mentions it (the
  field is dropped, or switched by "Replace everywhere").
- `isTourBlockKind(value)`, `tourBlockKinds()`.
- `tourBlockRefs(block)` - the row's `refs`; empty for no known kind. Takes
  any value with a `kind`, since it also runs on a draft's unchecked record.
- `tourBlockAssetIds(block, requiredOnly = false)` - the ids of those refs,
  each as often as it is named: what a write keeps for a block.
- `tourKindsMinor(kinds = TOUR_KINDS)` - the newest minor any row knows, which
  is `TOUR_MANIFEST_MINOR`.
- `tourBlockMinor(block, kinds = TOUR_KINDS)` - the minor `block` needs, which
  `serializeTourManifest` writes the highest of.
- Block types and the constants of their fields (`TOUR_MODEL_*`,
  `TOUR_NARRATION_*`, `TOUR_PICTURE_*`, `TOUR_CHARACTER_VIEWS`), re-exported
  by `tour-blocks.ts`.

## Adding a kind

1. A block interface, its views and its rules, as constants above the
   interfaces.
2. One line in `TourBlockOfKind`, which is a compile error until the row
   exists, and one row, with `sinceMinor` the next minor.
3. The wider `TourBlockKind` is then a compile error in every exhaustive
   switch and `Record<TourBlockKind, ...>` of the consumers.

## Invariants & assumptions

- A kind added after a release MUST say its minor. Written at minor 0, a
  released viewer reads a kind it does not know as a broken file and fails
  the tour; written at the kind's minor, it skips one block and reports it.
- `read` writes no envelope field. `readBlock` spreads `read`'s result next
  to the envelope, and a test over the list holds this.
- `floor` is one of `freeViews`, and `freeViews` and `worldViews` are subsets
  in that order. A test over the list holds this.
- Views and rules are per-kind constants above the interfaces, and `read`
  uses those constants, never `TOUR_KINDS`: the block types derive from them,
  so a row referring to the list would be a circular type.
- `refs` never throws: a field of the wrong shape names nothing.
- An audio item stands free as a narration circle (`spot`, `radiusM`
  required, `TOUR_AUDIO_MIN_RADIUS_M` to `TOUR_AUDIO_MAX_RADIUS_M`) or an
  ambient zone (`zone`, `maxM` and `volume` 0 to 1 required, `minM` optional
  and below `maxM`). Its `card` is a story's only: a free audio block now takes the `spot` view, and a free one in `card` (the earlier shape) is not read - no tour of that shape exists, so none is migrated. Each world field is
  required in its own view and kept, still checked, in every other, so the
  editor's view switch loses nothing. The format floor is 1 m; the editor's
  default radius is larger (the viewer's `narration-circle` sweep).

## Examples

```ts
tourBlockAssetIds({ kind: 'video', video: 'clip', poster: 'still' });
// ['clip', 'still']
tourBlockMinor({ kind: 'model', view: 'placed' }); // 0
```

## Tests

`tour-kinds.test.ts` (the row rules, each kind's references, the minors over
a synthetic list). `tour-blocks.test.ts` and `tour-blocks.property.test.ts`
cover what each row reads; `item-contract.test.ts` in the Tour Viewer holds
every kind to what its views owe.
