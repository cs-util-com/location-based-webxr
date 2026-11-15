# tree-drag.ts

## Purpose

The tree's reorder by drag: a card dragged by its grip lands where it is
dropped, written as ONE reorder of the whole list (one undo step). The
cards' markup is the app's: the kit has no selector of its own.

## Public API

- `createTreeDrag({ body, reorder, cards, idAttribute, arm?, frame?, cancelFrame? })` ->
  `{ dispose() }`:
  - `body` - the tree's body; its cards, in the list's order, each with a
    grip `[data-drag="<card id>"]` (drawn by the app);
  - `cards` - the cards' selector and `idAttribute` - the `dataset` key of
    a card's id (`node` reads `data-node`), both required; a missing or
    empty one of either throws `RangeError`;
  - `reorder(order, move)` - writes the new order (every id once); the
    shell passes the page's reorder. `move` is `{ id, from, slot }`: the
    card moved, its index before and the slot it went to (counted before
    the move), for a page whose command moves one card (the Tour
    Viewer's story cards).
  - `arm` - when a press becomes a drag (`tree-drag-arm.ts`); without
    one, at the press. With one, the press waits: a finger drags at its
    first move after resting `holdMs` (by the events' own times) and
    never if it strayed past `tolerancePx` first; a mouse or a pen at a
    move of `movePx`. Nothing is marked or written while it waits, and a
    lift, a cancel or Escape (the page's own, not stopped) ends it. A
    pointermove that folds in several moves (`getCoalescedEvents`, a
    lagging page) is decided by the first of them that decides. With an
    arm a non-passive `touchmove` listener on `body` holds the cards
    still under a finger that drags; a press that waits leaves its touch
    moves to the browser, so a grip with `touch-action: pan-y` (the app's
    CSS) scrolls the list for a flick, which the browser then cancels. An
    arm that is not numbers of 0 or more throws `RangeError`.
  - `frame` / `cancelFrame` - the frame scheduler of the edge scroll
    (default: `requestAnimationFrame`); tests pass their own.
  - `dispose()` ends a drag under way (writing nothing) and stops
    listening.

## Invariants & assumptions

- A drag starts only with the main button on a grip inside `body`; the
  press is `preventDefault`ed (no text selection, no emulated mouse), a
  press that waits for its arm too. Whether a finger scrolls the dock is
  the grip's `touch-action` (the app's), and with an arm the drag's
  `touchmove`: a waiting press scrolls, a drag does not.
- The cards' middles are read again at every move and every scroll of
  the dock: the slot is where the pointer is among the cards as they
  stand now.
- The tree IS redrawn during a drag (the shell draws on any store change,
  an autosave's status among them). When the drag's cards are no longer
  in the page, the cards are read again: the same cards in the same
  order carry the drag on (the carried card marked again), anything else
  ends it with nothing written - a drop on a list that changed under it
  could reorder cards the creator never saw. The release checks this
  too, so a redraw between the last move and the release writes nothing.
- Held within 32 px of the dock's top or bottom edge, the drag scrolls
  the dock each frame (up to 12 px a frame, less farther from the edge),
  and stops at the end of the list or when the pointer leaves the edge,
  from the move that begins a drag on.
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
  cards: ".row[data-node]",
  idAttribute: "node",
  reorder: (order) => store.reorder(order),
});
```

## Tests

`tree-drag.test.ts` (jsdom, stubbed card boxes): a drop writes one
reorder; the marks while moving and past the last card; a drop in place
writes nothing; Escape and a cancelled pointer write nothing; only a grip
and the main button start it; the press is the drag's; nothing after
`dispose`; a redraw of the same cards carries the drag on and one of
other cards ends it unwritten, at a move or at the release; held near the bottom edge it scrolls
the dock and lands by where the cards are then; away from the edges it
does not scroll; cards of the app's own selector and attribute drag the
same way, an empty or a missing one refused; the move passed beside the
order; with an arm, a rested finger drags and lands, a flick from the grip
drags nothing even resting later, a mouse from its threshold on (a click
marks nothing), a waiting press takes no selection and a lift ends it,
the first decided move of a folded pointermove decides, a drag begun at
the edge scrolls from that move, a drag's touch moves are held and a
waiting press's are not, a bad arm refused. End to end (the Tour Viewer's):
`playwright-tests/editor3d-tree.spec.js`.
