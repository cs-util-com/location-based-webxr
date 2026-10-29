# tour-characters.ts

## Purpose

A tour's recurring characters (`tour.json` version 4, minor 2): declared
once for the whole tour - an id, a name and a cut-out image - and named by
the `character` blocks of any station through the block's optional
`character` field (`tour-blocks.ts`). One guide who walks the visitor from
station to station is written once, not copied into every block.

## Public API

- `TourCharacter` - `{ id, name, image, frames? }`: the name 1-80
  characters (the character block's own rule,
  `TOUR_BLOCK_TEXT_RULES.character.name`), the image the id of an image
  asset of the tour (his one pose, and the fallback), `frames` the id of
  an image asset holding his poses as a frames sheet.
- `TOUR_CHARACTER_FRAMES` - `['idle', 'talk-a', 'talk-b', 'beckon']`, and
  the type `TourCharacterFrame`: the sheet's cells, left to right.
- `TOUR_MAX_CHARACTERS = 32` (module-internal) - the most one tour declares.
- `TourCharacterDrop` - `{ kind: 'character', character, reason }`: a
  declaration a lenient reader left out.
- `TourCharactersReadOptions` - `{ assets, fail, lenient?, onDropped? }`;
  `assets` are the tour's already validated assets.
- `parseTourCharacters(value, options): TourCharacter[]` - absent is `[]`;
  throws through `fail` naming the first violation.
- Re-exported from `tour-blocks.ts` (defined there to avoid an import
  cycle): `TOUR_CHARACTER_VIEWS` (`bubble`, `speak`, `two-stations`,
  `portrait`, `popup`) and `TourCharacterView`.

## Invariants & assumptions

- **Structural, at every minor:** `characters` not an array, an entry not
  an object, an id that is not a tour id, and duplicate ids fail. Character
  ids are a namespace of their own (blocks and assets have theirs).
- **A rule a later minor may relax** (more than 32 declarations, a name
  over its cap or empty, an image that is not an image asset) fails a file
  of this reader's own minor and, read leniently from a newer minor, leaves
  out just that declaration, reported through `onDropped`. A block naming a
  dropped declaration then keeps its own inline name and image (a field
  drop, `tour-blocks.ts.md`).
- **The writer keeps the inline copies.** `tour-manifest.ts` passes the
  declarations to the block reader, which gives a referencing block the
  declaration's name and image; the serializer writes those inline as well,
  so a reader of minor 0 or 1, which knows no declaration, still shows the
  character by name (as a `card`).
- `tour-manifest.ts` reads the characters after the assets and before the
  stations; a tour with none omits the field and is written at the lower
  minor its other parts need.

- **The frames sheet's layout is fixed, not declared:** four equal cells
  in one row in the order of `TOUR_CHARACTER_FRAMES` (idle; mouth half
  open; mouth open; beckoning with one arm out to the VIEWER'S RIGHT, which
  a viewer mirrors toward a station on the left), on a transparent
  background, each figure centred in its cell with the feet on one common
  baseline. A reader cuts it by equal width and trusts it; nothing in the
  file says how many cells there are, so a sheet of another layout draws
  wrongly rather than failing.
- **`frames` is optional and the image stays:** a reader that knows no
  frames (1.31.0 knows no declarations at all) shows the block's image; a
  `frames` that is not an image asset fails a file of this reader's own
  minor and, read leniently, leaves out just that declaration (reported
  through `onDropped`).

## Examples

```ts
const characters = parseTourCharacters(
  [{ id: 'guide', name: 'Ada', image: 'ada-png' }],
  {
    assets,
    fail: (m) => {
      throw new Error(m);
    },
  }
);
// A block { kind: 'character', character: 'guide', ... } then reads
// name 'Ada' and image 'ada-png', whatever its inline copies said.
```

## Tests

- `tour-characters.test.ts` - the frames sheet (kept, absent, not an
  image asset strict and lenient), the declaration's read (absent, empty,
  strict refusals, lenient drops), reference resolution and the writer
  syncing the inline copies, an unknown reference strict and lenient, the
  five views as story views (refused for a free block), `lineEnd` read and
  an unknown mode refused, the minor the writer stamps (0 or 2), the
  fixed-point bytes, and the released 1.31.0 reader (the
  `tour-reader-1-31` devDependency alias) reading a 4.2 tour: a card with
  the inline name, image, caption and voice, `lineEnd` as a tap, no
  `characters`, and a refused save.
