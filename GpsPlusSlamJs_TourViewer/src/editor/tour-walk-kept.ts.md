# tour-walk-kept.ts

## Purpose

The page's bookkeeping of the tour's own recorded walk for the 3D view:
what is kept when the debug layer starts and after it draws. Debug data
added beside the tour may be another tour's walk and never becomes it.

## Public API

- `walkAtLayerStart(walk, addedDebugShown)` - the walk kept as the layer
  starts: `walk` while added debug data is shown (its layer never draws
  the tour's walk), else null (the tour's own layer draws it again).
- `walkAfterDraw(walk, ownWalk, captures)` - after a drawing: a new array
  of the captures' `geo` when the layer shows the tour's own walk (so the
  view sees a new walk by its identity), else `walk` unchanged.

## Invariants and assumptions

- Pure: no state of its own; `edit-main.ts` holds the walk (`walkGeo`)
  and decides `ownWalk` (the layer's source is the opened file's walk).
- Added debug data's captures never become the walk.

## Examples

```ts
walkGeo = walkAtLayerStart(walkGeo, addedDebug !== null);
// in the layer's draw:
walkGeo = walkAfterDraw(walkGeo, ownWalk, captures);
```

## Tests

- `tour-walk-kept.test.ts` - kept while added data shows, dropped
  otherwise; captures taken only for the tour's own walk.
