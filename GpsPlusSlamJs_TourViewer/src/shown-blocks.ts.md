# shown-blocks.ts

## Purpose

Which blocks stand in a station's world for the visitor (station blocks
plan B2b step 2, owner decision B-Q4): the station's FREE world blocks (children of
the station itself), drawn from the start, plus every STORY block with
a world view (`pin`, `plane`, a model in `placed`, `ghost`, `hotspots`, `cutaway` or `toy`) the story
reached. A reached block appears when it is reached and stays for
the rest of the visit, kept with the walk (`visitor-walk-slice.ts`
`shownBlocks`, the lifetime of `done`). Pure.

## Public API

- `isWorldBlock(block)` - true for a world view: the framework's
  `TOUR_WORLD_VIEWS` (`pin`, a long text's `lectern` and `reading`,
  `plane` and the model's world views).
- `worldBlockReachedBy(child)` - the world block a story's child is, or
  null (a card, a stage block, a choice, a quiz).
- `reachedWorldBlocks(station, reached)` - the station's story world
  blocks among the reached ids, in the order reached, each once; a free
  block, a card or stage block and an unknown id are left out.
- `presentWorldBlocks(station, reached)` - the free world blocks, then
  `reachedWorldBlocks`.
- `hasStoryWorldBlocks(station)` - whether any story block has a world
  view (such a station has world content even with no free block).

## Invariants & assumptions

- Never a `card` (the story panel's, closed on the next step) nor a
  `stage` figure or model (the stage's one figure, `scene-stage.ts`).
- A free block is never also counted as reached: it is drawn as the
  station's `items` part already.
- A reached id that names no block of the station (a walk kept across an
  edit) is ignored, not thrown.

## Examples

```ts
const present = presentWorldBlocks(
  station,
  selectShownBlocks(state, station.id),
);
```

## Tests

- `shown-blocks.test.ts` - the views, the block a child reaches, the
  order and dedupe, the free/story split.
- `shown-blocks.property.test.ts` - the real story panel
  (`createSceneView`) driven through any sequence of taps, choices, ends,
  stops and offers: the reported blocks are exactly the world blocks of
  the children the panel showed, none leaves, and the present set is the free
  world blocks plus those, never a card or a stage block.
