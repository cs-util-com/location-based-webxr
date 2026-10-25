# tree-drag.ts

## Purpose

The tree's reorder by drag: a station's card dragged by its grip lands
where it is dropped, written as ONE reorder of the whole tour (one undo
step). The keyboard's way to reorder is the inspector's Earlier and
Later (`editor-shell.ts`).

## Public API

- `createTreeDrag({ body, reorder, frame?, cancelFrame? })` ->
  `{ dispose() }`:
  - `body` - the tree's body (`#tree-body`); its `.card[data-station]`
    elements are the cards, in the tour's order, each with a grip
    `[data-drag="<station id>"]` (`shell-tree.ts`);
  - `reorder(order)` - writes the new order (every station once); the
    shell passes the page's reorder.
  - `frame` / `cancelFrame` - the frame scheduler of the edge scroll
    (default: `requestAnimationFrame`); tests pass their own.
  - `dispose()` ends a drag under way (writing nothing) and stops
    listening.

## Invariants & assumptions

- A drag starts only with the main button on a grip inside `body`; the
  press is `preventDefault`ed (no scroll of the dock, no text selection).
- The cards' middles are read again at every move and every scroll of
  the dock: the slot is where the pointer is among the cards as they
  stand now.
- The tree IS redrawn during a drag (the shell draws on any store change,
  an autosave's status among them). When the drag's cards are no longer
  in the page, the cards are read again: the same stations in the same
  order carry the drag on (the carried card marked again), anything else
  ends it with nothing written - a drop on a list that changed under it
  could reorder stations the creator never saw.
- Held within 32 px of the dock's top or bottom edge, the drag scrolls
  the dock each frame (up to 12 px a frame, less farther from the edge),
  and stops at the end of the list or when the pointer leaves the edge.
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
`dispose`; a redraw of the same stations carries the drag on and one of
other stations ends it unwritten; held near the bottom edge it scrolls
the dock and lands by where the cards are then; away from the edges it
does not scroll. End to end: `playwright-tests/editor3d-tree.spec.js`.
