# reseat-note.ts

## Purpose

Whether a write gave an item another station, and the line the page says
about it (pure). The station rule seats an item moved out of its
station's circle anew - into the station whose circle it reached, or into
a station of its own where it stands - which changes where visitors see
it, so the page always says so.

## Public API

- `reseatOf(before, after, id)` -> `Reseat | null`: the item `id`'s
  station after the write when that is another one than before it:
  - `stationId` - the station it is in now;
  - `made` - that station did not exist before the write (the rule made
    it);
  - `said` - the line: `"<item>" is now in <station>`, or for a made one
    `"<item>" left its station's circle: it is now in a station of its
own, <station>`. The item is named by its text (line breaks as
    spaces, shortened past 40 characters), else "The pin" / "The photo"
    / "The 3D model"; the station by its title, else "Station n" by its
    place in the tour.
  - Null when the item kept its station, when the two states are the
    same, or when either lacks the item.

## Invariants & assumptions

- `before` and `after` are tour document states around one write;
  stations are read from `after`'s tour as written (`manifestToWrite`),
  so "Station n" is the number the tree shows.
- The page (`edit-main.ts`) asks it after every item move it writes: the
  3D view's item poses (gizmo, keys, a typed place) and the 2D map's
  drag. A made station starts unlocked there, as every station made in
  the session does.

## Examples

```ts
const before = store.getState().tourDocument;
editor.pose(id, geo);
const reseat = reseatOf(before, store.getState().tourDocument, id);
if (reseat !== null) toast(reseat.said);
```

## Tests

`reseat-note.test.ts` (reducer states): a move that keeps the station,
no change and an unknown id say nothing; a move into another station's
circle names it; a move out of every circle names the station the rule
made, by its place in the tour, with the item's text of two lines on one.
The page's toast and the made station's lock: `playwright-tests/editor3d-inspector.spec.js`.
