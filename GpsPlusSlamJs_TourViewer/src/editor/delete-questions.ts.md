# delete-questions.ts

## Purpose

The questions the 3D editor asks before deleting a station or a story, in
words that name what goes with it, so a yes is given knowing it. Pure;
`edit-main.ts` puts them to the creator (`confirmPausingFrames`).

## Public API

- `stationDeleteQuestion(station, title): string` - "Delete the station
  "Gate"? Its 3 items go with it: the story "Legend", the story "Siege"
  and 1 free item. You can undo this." Stories by name, free items by
  count, the parts joined by commas and a last "and"; "It has no
  content." for an empty one.
- `storyDeleteQuestion(state, storyId): string | null` - "Delete the story
  "Legend"? Its 2 entries go with it. You can undo this." When the delete
  also takes the story's station (an untitled automatic station the story
  alone kept), it names it: "Its entry and its station "Station 2", which
  holds nothing else, go with it." Null for a story the tour does not
  carry.

## Invariants & assumptions

- Whether the station goes is the document's own rule, not a copy of it:
  the question runs the `storyDeleted` reducer on `state` and looks for
  the station in the result. The state itself is not changed (a reducer
  returns a new state), so the question and the delete cannot disagree.
- A station is named by its title, else "Station n" by its place in the
  tour (`station-run.ts` `stationTitle`), as the tree names it.

## Examples

```ts
storyDeleteQuestion(store.getState().tourDocument, "aside");
// 'Delete the story "Aside"? Its station "Station 2", which holds nothing else, goes with it. You can undo this.'
```

## Tests

`delete-questions.test.ts`: the station's question with stories by name,
free items by count, one item, two parts and none; the story's question
for a station that stays, for an automatic station that goes with it (with
and without entries), for a story with no entries, and null for a story
not in the tour.
