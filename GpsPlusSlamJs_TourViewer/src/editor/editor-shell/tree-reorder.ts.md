# tree-reorder.ts

## Purpose

The tree's reorder of the stations as numbers, pure: the slot a dragged
card is dropped at (from the cards' middles on screen), and the stations'
order once it lands there. The drag (`tree-drag.ts`) and the inspector's
Earlier and Later (`editor-shell.ts`) both move by it.

## Public API

- `dropSlot(middles, y)` -> the slot, 0 to `middles.length`: before the
  first card whose vertical middle lies below `y` (a pointer on a middle
  counts as below it, so it lands after that card), else last. Throws a
  `RangeError` for a `y` that is not finite.
- `movedTo(ids, from, slot)` -> the new order with `ids[from]` moved to
  `slot` (a slot counted in the list before the move), or `null` when
  that leaves it where it was (`slot` is `from` or `from + 1`). Throws a
  `RangeError` for a `from` or a `slot` outside the list or not a whole
  number.

## Invariants & assumptions

- `middles` are top to bottom, in the same coordinates as `y`.
- The result of `movedTo` holds every id once; only the moved one changes
  place, the others keep their order (pinned by a property).
- Earlier is `movedTo(ids, i, i - 1)`, Later `movedTo(ids, i, i + 2)`.

## Examples

```ts
dropSlot([120, 160, 200], 175); // 2: between the second and third card
movedTo(["a", "b", "c"], 0, 2); // ["b", "a", "c"]
movedTo(["a", "b", "c"], 1, 2); // null: dropped where it was
```

## Tests

`tree-reorder.test.ts`: the slot at, before and after the middles and an
empty list; moves in both directions; the null drop; the refusals; a
property over random lists, places and slots (every id once, the moved
one where it was dropped, the others in order).
