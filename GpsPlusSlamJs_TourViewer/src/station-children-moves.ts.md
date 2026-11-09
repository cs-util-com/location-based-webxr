# station-children-moves.ts

## Purpose

An item of a station moved to another place in the same station, pure: the
rule behind the editor's drag and its "Move to", Earlier and Later. The
document action `childMoved` (`tour-document.ts`) is the only writer;
the editor's tree (`editor-shell.ts`, `shell-tree.ts`) and inspector
(`inspector-model.ts`) read the list helpers below.

## Public API

- `ChildMoveTo`: `{ place: "free" }` (the station's free items: they all
  stand in the world at once, so they have no order of their own to pick),
  `{ place: "story", story, index }` (into that story at the slot `index`,
  counted before the move: 0 first, the story's length last) or
  `{ place: "stories", index }` (a story to that slot among the stories) or
  `{ place: "station", station }` (onto that other station: `movedToStation`;
  `movedChild` refuses it as `missing`, it moves within one station only).
- `movedChild(holder, id, to)` -> `{ station, answers, floored }` or
  `{ refused }`. `answers` counts the choices' options that lost their jump
  (they go on to the next entry); `floored` says the item took its kind's
  world floor for a view.
- `ChildMoveRefusal`: `missing` (no such item, story or slot), `ownStory`
  (a choice or a quiz leaves only within its story: its answers name that
  story's entries), `noNesting` (a story into a story or among the free
  items, a free item among the stories), `cannotStandFree` (a model without
  a size), `unchanged` (it would stay where it is).
- `movedToStation(from, to, id)` -> `{ from, to, answers, floored }` (both
  stations after the move) or `{ refused }`:
  - a free item goes among `to`'s free items (at their end), its position
    reset to `[0, 0, 0]` (`to`'s centre) and its turn kept: its offset
    meant a place near `from`, so the editor asks for it to be placed again;
  - a story's entry leaves its story (its answers' jumps dropped, its view
    floored where a story's view cannot stand free, its `advance` dropped)
    and stands free at `to`'s centre the same way;
  - a story moves WHOLE after `to`'s last story, ahead of its free items,
    and its entries keep their offsets: the arrangement the author made
    around one station's centre now stands around the other's. Nothing is
    reset, so the editor says the story's entries need placing too;
  - refused as within a station: `ownStory` (a choice or a quiz),
    `cannotStandFree` (a model without a size), `missing`, and
    `unchanged` for `to` being `from`.
- The tree's lists of a station, by name: `STORIES_LIST` (`"stories"`),
  `FREE_LIST` (`"free"`) and `storyList(id)` (`"story:<id>"`, the
  story's own selection id).
  - `childMayGo(holder, id, list)` -> whether the rule takes item `id`
    into that list at all (the drag's `accepts`): it asks `movedChild`
    for a drop at the list's first slot, so the two cannot disagree (a
    model without a size is offered no way out of its story; a drop on
    the item's own place counts as taken). No refusal but `unchanged`
    depends on the slot. `station-children-moves.property.test.ts` pins
    the agreement over random stations, every item and every list.
  - `childDropTo(holder, list, drop)` -> the `ChildMoveTo` for a drop
    on a slot of `list` or into it (`{ into: true }`: a story's end, or
    the free items), or null for an unknown list.
  - `childStepTo(holder, id, way)` -> the `ChildMoveTo` one place
    `"earlier"` or `"later"` in the item's list, or null at its end and
    for a free item (no order).

## Invariants & assumptions

- Pure; the input is never changed, and every other item keeps its place.
- Leaving a story, a block drops its `advance` and keeps its view when its
  kind may stand free in it (`TOUR_FREE_BLOCK_VIEWS`), else takes
  `tourFloorView(kind)`: the framework's rule, called, never copied. Every
  kind may stand free since the free host landed (a video as a
  `card`, a sound as a narration circle or a zone, a character in any of his views), so only a model without a size
  is refused: each of its world views needs one.
- A block taking its kind's floor gains the fields that floor requires and
  its story view lacked: a sound's floor is the narration circle (`spot`),
  which the format refuses without `radiusM`, so a sound from a story's
  card takes `NARRATION_DEFAULT_RADIUS_M` (`kinds/audio/sound-reach.ts`,
  the one place that value is named). A radius the item already carries
  is kept, within a station and onto another
  (`tour-document-child-move-kinds.test.ts`,
  `tour-document-child-move-across.test.ts` "a sound moved onto another
  station").
- Entering a story from the free items, a block moves on by a tap; moving
  between stories it keeps its advance.
- Leaving a story, the `goto`s naming the block there are removed
  (`withoutStoryChild`); inside its own story they stay, as they still
  resolve.
- Stories stay before the free items (the writer's order); a move of a
  story reorders only the stories.
- A move onto another station never keeps an item's world place: a free
  item or an entry stands at the new centre, a story keeps its entries'
  offsets (`movedToStation` above). Never changes its inputs.
- The slot maths inside one list is the editor kit's `movedTo` rule, kept
  as a private copy: the visitor's pages reach this module through the
  document and must not load the editor's chrome
  (`tests/repo-config/tour-viewer-e2e-plan.test.js` holds that).

## Examples

```ts
const out = movedChild(station, "pin-1", {
  place: "story",
  story: "s2",
  index: 0,
});
if ("refused" in out) say(reasonText(out.refused));
else if (out.floored) say("It now stands in the world as its kind does");
```

## Tests

`station-children-moves.test.ts`: every move and every refusal at its
boundary, and the list helpers ("the tree's lists of a station").
`station-children-moves-across.test.ts`: `movedToStation` per kind and
refusal; `station-children-moves.property.test.ts` also holds, over random
stations, that a move onto another keeps every id once across the two,
refuses exactly what a move out to the free items refuses, and stands a
free item at the centre. Document level: `tour-document-child-move-across.test.ts`. The document-level halves (objects and frames, undo, a draft
reload, random sequences) are in `tour-document-child-move.test.ts` and
`tour-document-child-move.property.test.ts`.
