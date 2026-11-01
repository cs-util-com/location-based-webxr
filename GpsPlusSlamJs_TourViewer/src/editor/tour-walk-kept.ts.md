# tour-walk-kept.ts

## Purpose

The page's bookkeeping of the tour's own recorded walk for the 3D view:
what is kept when the debug layer starts and after it draws. Debug data
added beside the tour may be another tour's walk and never becomes it.

## Public API

- `walkAtLayerStart(walk, addedDebugShown)` - the walk kept as the layer
  starts: `walk` while added debug data is shown (its layer never draws
  the tour's walk), else null (the tour's own layer draws it again).
- `walkAfterDraw(walk, source, tourWalk, captures)` - after a drawing
  from `source`: a new array of the captures' `geo` when `source` is the
  tour's own walk `tourWalk`, compared by identity (so the view sees a
  new walk by its identity), else `walk` unchanged; also unchanged while
  `tourWalk` is null.

## Invariants and assumptions

- Pure: no state of its own; `edit-main.ts` holds the walk (`walkGeo`)
  and hands in the layer's source and the opened file's walk; the
  comparison is made here, so the page holds no flag that could be wrong.
- Added debug data's captures never become the walk.

## Examples

```ts
walkGeo = walkAtLayerStart(walkGeo, addedDebug !== null);
// in the layer's draw:
walkGeo = walkAfterDraw(walkGeo, from.source, tourWalk, captures);
```

## Tests

- `tour-walk-kept.test.ts` - kept while added data shows, dropped
  otherwise; captures taken only for the tour's own walk, never for another source
  or while the tour has no walk.
