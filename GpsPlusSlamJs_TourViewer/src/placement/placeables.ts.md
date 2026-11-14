# `placement/placeables.ts` - everything the 3D editor can place

## Purpose

Turns a tour into PLACEABLES: one shape for a free block in a posed view,
a plain folder and a station, which the gizmo, the gestures, the keys and the
inspector read without asking what kind of thing they hold. It is the
only place that walks a station's children through its plain folders to
find what stands in the world, and it reads the facts of each from
`placement-rows.ts`.

## Public API

- `PlaceRef` - `{ kind: "block" | "folder" | "station", id }`: what the document
  writes a placement back to. One arm per kind of holder, never per block
  kind.
- `PlaceExtent` - an `ExtentSpec` with its `value` now.
- `Placeable`:
  - `ref`, `selection` (the page's key: `<id>`, `folder:<id>`,
    `station:<id>`),
    `stationId`, `folderPath` (outermost first);
  - `geo` - its pose in the world, composed through its folders and its
    station (`composeTourFolderPath`, then `itemGeoPose`);
  - `local` - its pose in its holder as the file stores it (null for a
    station, whose frame is the earth);
  - `inStation` - its pose in its station's frame, composed through its
    folders (null for a station): where it stands from the anchor, which
    the circle and the free-spot rules judge;
  - `inheritedScale` - the scale its holders apply: the product of the
    scales of the folders holding it (`composedTourFolderScale`), 1 for
    none;
  - `turns`, `lifts`, `extent` (null: no dots, or a value the block
    lacks), `locked` (a station the creator locked), `members` (the block
    ids that follow it: itself for a block, the posed blocks it holds at
    any depth for a folder, none for a station, whose whole drawing
    moves), `group` (true for a plain folder only: it moves its members
    as a whole, so its gizmo rings them and their bodies are its grips -
    the gizmo reads this, never the kind).
- A plain folder's placeable (`folder:<id>`): its pivot is its origin
  (`local` is its pose, the holder's frame for none), its row is
  `CONTAINER_PLACEMENT` (it turns and lifts; its dots are its `scale`,
  1 for none, a factor from 0.1 to 10), `folderPath` its holders, never
  locked.
- `PlaceScope` - `{ stationLocked?(id) }`: what the page knows and the
  tour does not.
- `posedBlocks(station)` - the posed blocks of one station in document
  order, through every plain folder; story steps are not among them.
- `PosedBlock` - `{ block, place }`: a posed block with its placeable,
  for the readers that need the block's own fields beside its place.
- `posedEntries(station)` - `posedBlocks` with their blocks;
  `posedEntryOf(station, id)` - one of them, or null for a block the
  station does not hold in a posed view.

- `placeablesOf(tour, scope?)` - each station, then its posed blocks
  (no folders: the world draws no mark of one to pick, so a folder is
  placed only by its name, chosen in the tree).
- `placeableOf(tour, selection, scope?)` - the placeable a selection
  names (a folder's too), or null (a code, a card, an unknown id, a
  story's entry).
- `storyEntries(station, storyId)` - the open story's scope: the posed
  entries of one story of `station`, in its order, each with the
  placeable it would be (its pose in the station's frame: a story stands
  only at the station's top). A card, a choice and a quiz are left out;
  a story the station lacks, a plain folder or a block id gives none.
  The 3D view draws them while the story is open.
- `openStoryOf(tour, selection)` - the story a selection opens: the
  story itself (`story:<id>`) or the story holding the chosen entry (a
  card, a choice or a quiz too); null for anything else, an unknown id,
  no selection or no tour.

## Invariants

- Pure: no three.js and no page state but `scope`.
- A block is a placeable exactly when its row is `posed`; a kind or view
  the rows do not know is none.
- `geo` equals what the old gate gave: the framework's `tourFreeBlocks`
  pose (composed through the folders, innermost first) through
  `itemGeoPose`. The contract test holds this bit for bit over generated
  stations with nested, posed folders.
- An extent's value is read from the row's `field` on the block or the
  station; a value that is not a finite number gives no dots.
- A story's entries are read-only: `storyEntries` gives them, but
  `placeablesOf` and `placeableOf` never do, so the gizmo offers no
  handle on one (no move disc, no knob, no dots), whatever its view. A
  move that could not be saved would be worse than none: moving a story's
  entry comes with the save path for a story's edits, once the story
  editor work has landed. Card and stage entries get no handles even
  then (their rows are not `posed`).

## Examples

```ts
const target = placeableOf(tour, "pin-1", {
  stationLocked: (id) => locked.has(id),
});
if (target !== null && target.turns) showKnob();
```

## Tests

- `placement.contract.test.ts` - "the placeables against the old gate":
  over generated stations (every kind in every free view, plain folders up
  to two deep, posed or not) the block placeables are the old world
  blocks plus exactly the free characters, at the same world poses; the
  station comes first with its lock and its found radius; a block keeps
  its pose in its holder and names its folders; a card and an unknown id
  are no placeable.
- `placeables.story.test.ts` - the open story's entries: its posed
  entries in its order where they stand from the station, none for a
  story the station lacks, a plain folder or a block, and none of them
  (nor a card) a placeable while a free block beside them is one; the
  open story of `story:<id>`, of an entry, a card and a choice, none for
  anything else, and a property (whatever is chosen, an open story is
  one, holding the chosen entry). Two mutants survive as equivalent: a
  choice is no posed row either way, and the station check before
  drawing only saves an empty drawing.
- `placeables.folders.test.ts` - a folder's placeable: its pivot through
  its holders, its scale as its dots, its members at any depth, the
  scale its holders give it and its blocks, and an unknown folder none.

## Bend

A block whose row `bends` (a ground arrow) carries `bendDeg`: its written
bend, 0 for none or one not finite (the drawing's own reading). Absent on
every other placeable, so the gizmo draws no bend knob for it.
