# `placement/placeables.ts` - everything the 3D editor can place

## Purpose

Turns a tour into PLACEABLES: one shape for a free block in a posed view
and for a station, which the gizmo, the gestures, the keys and the
inspector read without asking what kind of thing they hold. It is the
only place that walks a station's children through its plain folders to
find what stands in the world, and it reads the facts of each from
`placement-rows.ts`.

## Public API

- `PlaceRef` - `{ kind: "block" | "station", id }`: what the document
  writes a placement back to. One arm per kind of holder, never per block
  kind.
- `PlaceExtent` - an `ExtentSpec` with its `value` now.
- `Placeable`:
  - `ref`, `selection` (the page's key: `<id>`, `station:<id>`),
    `stationId`, `folderPath` (outermost first);
  - `geo` - its pose in the world, composed through its folders and its
    station (`composeTourFolderPath`, then `itemGeoPose`);
  - `local` - its pose in its holder as the file stores it (null for a
    station, whose frame is the earth);
  - `inStation` - its pose in its station's frame, composed through its
    folders (null for a station): where it stands from the anchor, which
    the circle and the free-spot rules judge;
  - `inheritedScale` - the scale its holders apply (1 while folders are
    rigid);
  - `turns`, `lifts`, `extent` (null: no dots, or a value the block
    lacks), `locked` (a station the creator locked), `members` (the block
    ids that follow it: itself for a block, none for a station, whose
    whole drawing moves).
- `PlaceScope` - `{ stationLocked?(id) }`: what the page knows and the
  tour does not.
- `posedBlocks(station)` - the posed blocks of one station in document
  order, through every plain folder; story steps are not among them.
- `PosedBlock` - `{ block, place }`: a posed block with its placeable,
  for the readers that need the block's own fields beside its place.
- `posedEntries(station)` - `posedBlocks` with their blocks;
  `posedEntryOf(station, id)` - one of them, or null for a block the
  station does not hold in a posed view.

- `placeablesOf(tour, scope?)` - each station, then its posed blocks.
- `placeableOf(tour, selection, scope?)` - the placeable a selection
  names, or null (a code, a card, an unknown id).

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
