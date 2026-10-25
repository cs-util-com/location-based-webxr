# tree-drag.ts

## Purpose

The tree's reorder by drag: a station's card dragged by its grip lands
where it is dropped, written as ONE reorder of the whole tour (one undo
step). The keyboard's way to reorder is the inspector's Earlier and
Later (`editor-shell.ts`).

## Public API

- `createTreeDrag({ body, reorder })` -> `{ dispose() }`:
  - `body` - the tree's body (`#tree-body`); its `.card[data-station]`
    elements are the cards, in the tour's order, each with a grip
    `[data-drag="<station id>"]` (`shell-tree.ts`);
  - `reorder(order)` - writes the new order (every station once); the
    shell passes the page's reorder.
  - `dispose()` ends a drag under way (writing nothing) and stops
    listening.

## Invariants & assumptions

- A drag starts only with the main button on a grip inside `body`; the
  press is `preventDefault`ed (no scroll of the dock, no text selection).
- The cards' middles are read once, at the press: the tree is not redrawn
  during a drag (nothing writes to the store until the drop).
- While it moves: the carried card is marked `dragging`; the card it would
  land before is marked `drop-before`, or the last card `drop-after` past
  the end (`editor-shell.css` draws the line). Every mark goes at the end.
- The drop writes `movedTo(ids, from, slot)` (`tree-reorder.ts`), nothing
  when that is null (dropped where it was).
- Escape (a capture listener on the window during the drag, stopped
  there, so the page's own Escape does not deselect) and `pointercancel`
  end the drag with nothing written. Only the pointer that started it
  counts.

## Examples

```ts
const drag = createTreeDrag({
  body: document.getElementById("tree-body") as HTMLElement,
  reorder: (order) => deps.stations.reorder(order),
});
```

## Tests

`tree-drag.test.ts` (jsdom, stubbed card boxes): a drop writes one
reorder; the marks while moving and past the last card; a drop in place
writes nothing; Escape and a cancelled pointer write nothing; only a grip
and the main button start it; the press is the drag's; nothing after
`dispose`. End to end: `playwright-tests/editor3d-tree.spec.js`.
