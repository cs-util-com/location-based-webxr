# tree-reorder.ts

## Purpose

A list's reorder as numbers, pure: the slot a dragged card is dropped at
(from the cards' middles on screen), and the items' order once it lands
there. The drag (`tree-drag.ts`) and an app's Earlier and Later buttons
both move by it. It knows no item kind; what the cards stand for is the
app's.

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

- `movedAcross(lists, from, to)` -> `lists` (ids per list) with the item
  at `from = { list, index }` moved to the slot `to = { list, slot }`: inside
  one list by `movedTo`, across two out of the one and into the other at
  that slot (a list not yet in `lists` counts as empty). Null when it stays
  where it was; a `RangeError` for an unknown source list, a place or a
  slot outside its list. The nested drag (`tree-nest-drag.ts`) moves by it.

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
one where it was dropped, the others in order); `movedAcross` inside and
across lists, into an empty one, its refusals, and a property that nothing
is lost or doubled and that the move back restores the lists.
