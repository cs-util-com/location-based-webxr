# story-choice.ts

## Purpose

The rule of a station with several stories: which of them a visitor can play,
what the story panel shows for the station, and when the station ends. Pure;
`scene-view.ts` renders the answers. Plan:
`GpsPlusSlamJs_Docs/docs/2026-11-01-1651-stories-as-station-children-plan.md`,
section 5.

## Public API

- `playableStories(station)` - the stories with a child the player shows, in
  the file's order. An empty story, or one of quizzes alone, is left out.
- `storyPickLabel(pick)` - a picker button's words: the title, with a `✓` before
  it once played.
- `createStoryChoices(): StoryChoices` - one per story panel:
  - `panelOf(station, hasCard)` - `nothing`, `card`, `story` (the only playable
    one) or `picker` (`picks`: each story and whether it was played);
  - `storyEnded(station, storyId)` - marks the story; the picker to return to
    while a story is unplayed, else null (the station ends, its marks go);
  - `forget(station)` - the station is done another way;
  - `clear()` - everything stopped.

## Invariants & assumptions

- The picker shows if and only if two or more stories are playable.
- A story counts as played when it ended or was ended, also by "End this
  story". One stopped by another station's "Play" is not marked: it did not
  end.
- A marked story can be played again; playing it again ends nothing new.
- Marks are cosmetic and not stored. They are keyed by station id, so they
  outlive a re-queue, and go when the station is done or everything stops. The
  done state is the guide's.
- Story ids are read from the parsed tour, so they are unique tour-wide.

## Examples

```ts
const choices = createStoryChoices();
const panel = choices.panelOf(station, false); // { show: "picker", picks }
const back = choices.storyEnded(station, panel.picks[0].story.id);
// back: the picker with the first marked, or null when the station ends
```

## Tests

- `story-choice.test.ts` - each panel, the return, a replay, the marks.
- `story-choice.property.test.ts` - drives the real `createSceneView` through
  any sequence of picks, Continues, ends, re-queues, offers and stops: the
  picker shows iff two or more are playable, a visit ends exactly once, none
  stays open; and the model alone over any order of stories.
