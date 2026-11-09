# tour-story-edit.ts

## Purpose

A station's stories changed as folders, pure: the frame-level half of the
document's story actions (`storyAdded`, `storyRenamed`, `storyDeleted`,
`storyChildAdded`, `storyChildDeleted` in `tour-document.ts`).

## Public API

- `newStory(id, title)` -> an empty `TourStory`, or null for a title the
  format refuses (`TOUR_STORY_TITLE_RULE`).
- `withStory(holder, story, after?)` -> the holder with the story right
  after the story `after` (a copy beside its original), else after its
  stories, before its free blocks. The one slot rule: a new story, a copy
  and a story moved from another station (`station-children-moves.ts`)
  all go through it.
- `withStoryTitle(holder, id, title)` -> the holder renamed, or null.
- `withoutStory(holder, id)` -> the holder without it, or null.
- `withStoryChild(holder, id, child)` -> the holder with the child at the
  end of that story, or null.
- `withoutStoryChild(holder, id)` -> `{ frame, answers }` with the child gone
  and every `goto` naming it removed, or null. `answers` counts the options
  that changed; the page says it in its toast.

## Invariants & assumptions

- Pure: inputs are never changed; a holder is anything with `children`.
- Stories stand before free blocks, as the writer lists them
  (`tour-content.ts`); a new story never lands among the free blocks.
- A title is trimmed, then checked by the format's own rule: a blank one, or
  one over 80 code points, is refused rather than cut.
- A choice's `goto` names a child of the same story (format rule), so a
  child's delete looks only at its own story. An option losing its `goto`
  goes on to the next child, which is the format's reading of an absent one.
- Unknown ids answer null; the reducers read that as nothing to do.

## Examples

```ts
const story = newStory(id, "Story 2");
const frame = story === null ? null : withStory(station, story);
const out = withoutStoryChild(station, "line-3");
if (out !== null) say(`${out.answers} answers changed`);
```

## Tests

`tour-story-edit.test.ts` per function, with the places and the pruned
`goto`s. `editor/story-commands.property.test.ts` drives them through the
editor session: any sequence with its undos stays writable and a draft
reload equals it.
