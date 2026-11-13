# tour-blocks.ts

**Purpose:** the BLOCKS of a station in `tour.json` version 5 - the things
a station shows (a short text, a long text, a picture, a
video, a sound, a 3D model, a character), each carrying its data, the
creator's choice of how it looks (its `view`) and where it stands (a
local `pose` in the station's frame). A block that is a child of its
station is FREE and stands in the world; a block that is a child of a
story is a STORY block (`tour-story.ts`).

The manifest (`tour-manifest.ts`) reads every station's children through
`tour-story.ts`, which reads each block here.

What each kind knows is one row of `TOUR_KINDS` (`tour-kinds.ts`); the
tables below are derived from those rows, and this file keeps the envelope.
Its fields are read with the toolkit of `tour-block-read.ts`. The names keep
their import path here.

## Public API

- `TourBlockKind` - `shortText | longText | picture | video | audio |
model | character`.
- `TOUR_BLOCK_VIEWS` - the views this reader draws, per kind:
  - `shortText`: `pin`, `card`; `longText`: `lectern` (a reading stand in the
    square), `reading` (a short sign that opens the whole text on a tap),
    `card`;
  - `picture`: `plane`, `card`; `video`: `screen`, `cutout`, `porthole`,
    `card`; `audio`: `spot`, `zone`, `card`;
  - `model`: `placed`, `ghost`, `hotspots`, `cutaway`, `toy`, `card`;
    `character`: `bubble`, `speak`, `two-stations`, `portrait`, `popup`,
    `card` (the five before `card` are `TOUR_CHARACTER_VIEWS`, in a story
    and standing free).
  - The WORLD views (a free block's) are `pin`, `lectern`, `reading`, `plane` and the model's
    world views, `TOUR_WORLD_VIEWS`; renderers ask that set rather than
    keep a copy.
- `TOUR_MODEL_WORLD_VIEWS` / `TourModelWorldView` - `placed`, `ghost`
  (glass whose feet fade into the ground), `hotspots` (its notes drawn on
  it, its clip held at rest), `cutaway` (cut open by its sections), `toy`
  (at its pose and size until the visitor resizes or moves it). Every one
  needs `sizeM`.
- `TOUR_MODEL_NOTE_RULES` (`title` required 64, `text` optional 1024),
  `TOUR_MODEL_MAX_NOTES` (32), `TOUR_MODEL_SECTION_RULES` (`name` required
  40), `TOUR_MODEL_MAX_SECTIONS` (4), `TOUR_MODEL_ANIMATION_RULES` (`name`
  required 128), `TOUR_MODEL_SPACE_MAX` (10 000, a point's largest
  coordinate in the model's own units), `TOUR_MODEL_MIN_DIRECTION_LENGTH`
  (1e-9, the shortest `normal` taken, a policy floor; the editor uses it
  to refuse what the reader would). A shorter `normal` fails a file of
  the reader's own minor; a lenient read of a newer minor leaves out just
  that note or section and reports it through `onDropped` as a field drop
  (`annotations[i]` / `sections[i]`).
- `TOUR_NARRATION_RULES` (`voiceCredit` optional 200 code points),
  `TOUR_NARRATION_MAX_DURATION_MS` (14 400 000, four hours) and the type
  `TourNarration` - a long text's narration.
- `TOUR_BLOCK_TEXT_RULES` - every capped text, as `{ max, unit, required }`:
  - `shortText`: `caption` required 40, `description` optional 160;
  - `longText`: `title` required 80, `body` required 32 000 UTF-16 units;
  - `picture`: `title` optional 40, `caption` optional 1200, `alt`
    optional 300;
  - `video`, `audio`: `title` optional 40, `transcript` optional 32 000;
    a video's world fields (`widthM`, `start`, `withinM`, `sound`, `alpha`)
    are its kind row's (`tour-kinds.ts`);
  - `model`: `title` optional 80;
  - `character`: `name` required 80, `caption` optional 2000.
- `TOUR_PICTURE_MIN_WIDTH_M` (0.05), `TOUR_PICTURE_MAX_WIDTH_M` (50) - a
  picture's `widthM`, inclusive.
- `TOUR_MODEL_MIN_SIZE_M` (0.05), `TOUR_MODEL_MAX_SIZE_M` (500) - a
  model's `sizeM`, inclusive.
- `tourTextCount(text, unit = 'codePoints'): number` - THE count every cap
  is checked against and every editor counter shows: code points after
  trimming and collapsing each whitespace run to one space, or (`utf16`)
  the string's length as written.
- `checkTourBlockText(rule, value): TourBlockTextCheck` -
  `{ ok: true, value }` (the text exactly as written) or
  `{ ok: false, reason, blank? }` (`blank` for a whitespace-only text).
- `TOUR_FREE_BLOCK_VIEWS` - the views a block of each kind may stand free
  in: every kind has some, and none is a `card`: a video stands as a
  `screen`, a `cutout` or a `porthole`, a sound as a `spot` or a `zone`,
  a character in his five views (he stands as a figure). A text, a
  picture or a model in `card` stays refused: a card without a step would
  show nothing.
- `tourFloorView(kind): TourBlockView` - the view a free block falls back
  to when its own is unknown to this reader: `pin`, `reading`, `plane`,
  `placed`, `screen` for a video, `spot` for a sound, `speak` for a
  character. A story
  block's floor is `card`, from its reader.
- `readTourBlocks(value, at, options): TourBlockRead[]` - a list of blocks
  read at once, ids unique (the draft record's one block).
- `tourBlockReader(options)` - the per-block reader of a station's children
  (`tour-story.ts`): `(value, at) => TourBlockRead | null`, each field
  checked, each media reference resolved, `null` when a lenient read
  skipped the block (reported). It checks no id uniqueness; the caller
  does. `TourBlockRead` is `{ block, knownView }`; a free block's view is
  settled by `placeTourBlocks`.
- `placeTourBlocks(read, { fail, lenient?, onDropped? }): TourBlock[]` -
  every block in `read` must stand in a world view.
- `TourBlocksReadOptions` - `{ assets, fail, lenient?, onDropped? }`.
- `TourBlockDrop` - `{ kind: 'field', block, field, reason }` (an optional
  text left out) or `{ kind: 'block', block, reason }` (a block skipped).
- Types: `TourBlock` and its members (`TourShortTextBlock`,
  `TourLongTextBlock`, `TourPictureBlock`, `TourVideoBlock`,
  `TourAudioBlock`, `TourModelBlock`, `TourCharacterBlock`),
  `TourBlockView`, `TourTextUnit`, `TourTextRule`, `TourBlockTextCheck`.

## The block

- Every block: `id` (`[A-Za-z0-9_-]{1,64}`, unique among the tour's
  children; asset ids are a namespace of their own, so a block may share an
  asset's id), `kind`, `view`, `pose` (`parseTourLocalPose`), optional
  `createdAtIso` (ISO-8601).
- `shortText`: `caption`, optional `description`.
- `longText`: `title`, `body` (the text's source), and an optional
  `narration` `{ audio, timing?, voiceCredit?, synthetic,
durationMs? }`: `audio` names an audio asset; `timing` must be the
  block's own entry `timing/<id>.json` (`tour-timing.ts`, read by a
  viewer only when the text opens); `synthetic` reads as false when
  absent; `durationMs` a whole number from 1 to four hours. A narration
  that is not an object fails at every minor; a field breaking its rule
  fails a file of this reader's own minor, and a newer minor's file
  loses just the narration (reported as a `narration` field drop) while
  the text still reads; an over-long `voiceCredit` is left out alone.
- `picture`: `image` (an image asset), optional `title`, `caption`, `alt`,
  and `widthM` (required).
- `video`: `video` (a video asset), `transcript`, optional `title`, optional
  `poster` (an image asset); in the world `widthM` (required in every world
  view, kept in a card), optional `start` (`enter`, `near`, `look`, `tap`),
  `withinM` (a `near` start's distance, 1 to 20 m), `sound` (`on`, `off`)
  and `alpha` (`none`, `stacked`).
- `audio`: `audio` (an audio asset), `transcript`, optional `title`.
- `model`: `asset` (a model asset), `sizeM` by view - required in every
  world view, optional for `card` - and optional `title`. In any view:
  - `animation` `{ name, autoplay }` - a clip of the file by name (a name
    the file lacks plays nothing); `autoplay` must be a boolean.
  - `annotations` - 1 to 32 notes `{ position, normal, title, text? }` in
    the model's own space (before `sizeM` scales it), so a note scales
    and turns with the model. They live on the block, so replacing the
    model file keeps them. An empty list reads as absent.
  - `sections` - 1 to 4 planes `{ name, position, normal }` in the model's
    own space; a cutaway cuts away what lies on the side `normal` points
    to. Absent means one cut that turns to face the visitor, and an empty
    list reads as absent, as an empty note list does.
  - A point or direction is three finite numbers and a direction is not
    zero (nor shorter than 1e-9, too short to normalise) - malformed at
    every minor; a coordinate beyond
    `TOUR_MODEL_SPACE_MAX`, too many notes or sections, a text over its
    cap or a non-boolean `autoplay` is a rule a later minor may relax
    (skips the block when lenient). Vectors are kept as written;
    renderers normalise directions.
- `character`: `name`, `image` (an image asset), `caption`, optional
  `voice` (an audio asset), and an optional `character`, the id
  of a declared character (`tour-characters.ts`, passed in as
  `TourBlocksReadOptions.characters`). A resolved reference gives the block
  the declaration's name and image (the writer writes them inline too); an
  unknown one fails at this reader's minor and, from a newer minor, is a
  field drop (`field: 'character'`) keeping the inline name and image.

## Invariants & assumptions

- **Text kept as written.** Only the count ignores whitespace; a reader
  never trims or rewrites a stored text.
- **No Unicode normalisation here.** Neither the reader nor the writer
  normalises a text to NFC; the editor writes NFC as the creator types.
  A later hash of a long text's plain text depends on that, so it stays
  the editor's job (or moves here whole), never half of each.
- **Required vs optional texts.** A required text that is missing, not
  text, blank or over its cap fails the file. An optional one that is
  blank reads as absent; one over its cap or not text is left out and
  reported through `onDropped` (the tour details' rule) - at this
  reader's own minor only, since a newer minor may have widened the cap.
- **One count.** Code points after trim and collapse, except the long
  text body (UTF-16 units as written). A combining mark is a code point
  of its own; a surrogate pair is one code point and two UTF-16 units.
  The body's plain-text rules (the Markdown subset it is written in) are
  not checked here yet; that check joins this module once the Markdown
  reader exists.
- **References resolved here.** A media field must name an asset of the
  right kind; a renderer never meets a dangling id.
- **LENIENT for a NEWER MINOR.** A block of an unknown kind, naming an
  asset this reader lacks, with a required text over its cap, or a size
  outside its bound is SKIPPED and reported (`kind: 'block'`); a block in
  an unknown view falls back to its floor view; a free block with no world
  view this reader draws (or a free model with no `sizeM`) is skipped and
  reported. Structural faults - an id, a pose, a timestamp, a size that is
  not a positive finite number, a duplicate id - fail at every minor: no
  revision can make them valid.
- **Strict at this reader's own minor:** every one of the above fails.
- Never throws anything but what `fail` throws; the skip signal is
  internal.

## Examples

```ts
const readBlock = tourBlockReader({
  assets,
  fail,
  onDropped: (d) => console.warn(d.block, d.reason),
});
const read = readBlock(station.children[0], 'stations[0].children[0]');

tourTextCount('  a \t b  '); // 3
tourTextCount('é'); // 2 (a combining mark counts)
tourTextCount('\u{1F600}', 'utf16'); // 2
```

## Tests

- `tour-blocks.test.ts` - every cap at N-1, N and N+1 in plain letters,
  combining marks and surrogate pairs; whitespace runs counted as one; the
  body in UTF-16 units; required and optional texts (blank, not text,
  over); media references of the wrong kind or missing; `widthM` and
  `sizeM` by view; ids at 64 characters, colliding with asset ids,
  duplicated; views per kind; the free-block rule; floor views; lenient
  fallbacks and skips, and a lenient read never throwing; the exact
  messages an author reads (path, unit, article, bounds), a number or an
  array that would coerce into a valid id, kind or timestamp refused, a
  non-positive size malformed even for a newer minor, and an optional
  over-cap text dropped with no listener. The model's fields:
  every world view needing a size, notes, sections and clip kept exactly,
  notes surviving a replaced model file, the empty-list rules, 32 notes
  and 4 sections at N and N+1 (strict and lenient), note title and text
  caps, malformed vectors at every minor, and the space bound.
- `tour-blocks.property.test.ts` - a model's size for every double, and
  for its fields: every valid set reads back exactly through JSON in every
  world view, any note count against the limit, any note title against its
  cap. A scoped mutation run over this
  file left two survivors, both equivalent: the `typeof value ===
'string'` guard before a `Map.get` and an `Array.includes` that only
  match strings.
- `tour-story.property.test.ts` - generated stations (shared generators,
  `test-utils/tour-arbitraries.ts`) read exactly and round-trip; newer
  minor values anywhere never fail a lenient read; over-cap texts fail or
  are dropped by whether they are required.
