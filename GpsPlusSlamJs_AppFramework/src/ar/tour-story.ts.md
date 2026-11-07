# tour-story.ts

**Purpose:** a station's CHILDREN in `tour.json` version 5 - what a visitor
meets at a station and what they are asked. A station holds ONE ordered
list of children: a free block (`tour-blocks.ts`, standing in the world)
or a STORY, which holds its own ordered list of blocks, choices and
quizzes. A block lives in one place, so being in a story is what shows it.
The manifest reads every station's children here (`tour-stations.ts`).

## Public API

- `parseTourStationChildren(value, at, options): TourStationChildrenRead`
  - `{ children, ids }`: the children as read, and every child id the file
    names in the station, the ones a lenient read left out included, in file
    order. `options` are `TourChildrenReadOptions` (the block reader's
    options, `onDropped` taking a `TourChildDrop`). Throws through `fail`
    naming the first violation by its index in the file
    (`stations[0].children[2].children[1].options[0].goto`).
- Types: `TourStationChild` (`TourBlock | TourStory`), `TourStory`
  (`{ id, kind: 'story', title, children }`), `TourStoryChild`
  (`TourStoryBlock | TourChoice | TourQuizEntry`), `TourStoryBlock` (a
  block with `advance`), `TourChoice` (`{ id, kind: 'choice', prompt,
options }`), `TourQuizEntry` (`TourQuiz` with `id` and `kind: 'quiz'`),
  `TourChildDrop` (a `TourBlockDrop`, `{ kind: 'child', child, reason }`,
  or `{ kind: 'option', child, option, reason }` for a way on a kept choice
  lost with the child it named), `TourChildrenPlace` (`{ index, story? }`),
  `TourChoiceOption` (`{ id, label, goto? }`), `TourQuiz` (`{ question,
points, answer }`), `TourQuizAnswer`, `TourQuizOption`, `TourStepAdvance`
  (`{ mode: 'tap' }`, `{ mode: 'auto', afterS }` or `{ mode: 'lineEnd' }`).
- `TOUR_CHILD_KINDS` - `story`, `choice`, `quiz`: disjoint from the block
  kinds, so `kind` alone tells every child apart.
- `TOUR_STORY_TITLE_RULE` - required, 1-80 code points (`tourTextCount`).
- Over a children list: `isTourStory`, `isTourStoryBlock`,
  `tourChildrenStories`, `tourChildrenFreeBlocks`,
  `tourStoryChildrenBlocks`, `tourChildrenBlocks` (every block once, in
  document order), `tourChildrenPlace(children, id)` (null when no child
  has it).
- Over a station (anything with `children`, `TourStationHolder`):
  `tourStories`, `tourStoryBlocks(story)`, `tourStationStoryBlocks`,
  `tourStationBlocks` (every block, free and in a story),
  `tourStationChildIds` (every id: stories, what they hold, free blocks),
  `tourChildPlace(stations, id)` (`TourChildPlace`: the station and where
  in it). The free blocks are `tourFreeBlocks` (`tour-station-pose.ts`).
- `checkTourChildIdsUnique(stations, fail)` - child ids are unique across
  the tour: one read per station, checked on its `ids`, so an id a lenient
  read left out still counts.

## The rules

- The order of the file is kept: stories and free blocks in any order
  (nothing assumes free blocks first).
- A free block must stand in a world view; its `advance`, like a choice's
  or a quiz's, is ignored. A story block takes any view of its kind (an
  unknown one reads as `card`) and an `advance`.
- `advance`: `{ mode: 'tap' }` (also when absent, and written out on a
  read so a renderer never guesses), `{ mode: 'auto', afterS > 0 }` or
  `{ mode: 'lineEnd' }` (when the character's line ends: its voice, else a
  reading time).
- `choice`: a non-empty prompt and at least two options with unique ids;
  an option's `goto` names a child of the same story (a skipped one
  included), or is absent: the story continues at the next child. Anything
  else fails, named by the choice's index in the file.
- `quiz`: `question`, `points` (an integer >= 0) and `answer`. There is no
  `route`: answers do not branch the walk. A `route` field is an unknown
  field and ignored.
  - Answers: `single { options, correct }`, `multiple { options,
correct[] }` (at least 2 options, unique ids, correct among them),
    `text`/`code { salt, sha256[] }` (salted SHA-256 hex of the accepted
    answers after normalisation - a deterrent only), `number { value,
tolerance >= 0, unit? }`.
- Blocks, stories, choices and quizzes share one id namespace per station
  (a skipped child's id counted) and across the tour; option ids are
  unique per choice.
- A story's title is required: absent, not a string or blank fails at
  every minor; over 80 fails strict, and a lenient read leaves the story
  out, reported (its children are read first, so their structural faults
  still fail).
- A station-level choice or quiz, a story inside a story, or any unknown
  kind fails strict and is left out, reported, under lenient; so is a quiz
  of an unknown answer type. (A story inside a story is not read, so its
  own children's ids are not counted.) Options naming a left-out child are
  pruned, each reported,
  and a choice left with fewer than two goes, reported, repeatedly.
- Structural faults fail even a lenient read: an id, a duplicate, a
  `goto` naming nothing, a story without a title or `children`, a missing
  list.

## Invariants & assumptions

- After a read, every `goto` names a child of its own story, every choice
  has at least two options, and every free block is in a world view.
- **The in-memory child is the file's child.** Nothing maps one on the way
  in or out, so the manifest's writer writes what it read.
- **LENIENT for a NEWER MINOR:** see the rules above; an unknown advance
  mode is a tap. Strict at this reader's own minor: every one of these
  fails.

## Examples

```ts
const { children } = parseTourStationChildren(station, 'stations[0]', {
  assets,
  fail,
});
const stories = tourChildrenStories(children);
const free = tourChildrenFreeBlocks(children);
```

## Tests

- `tour-story.test.ts`: order kept with stories first or last; free and
  story blocks' views; advance defaults and ignoring; gotos back, forward
  and refused (another story, a free block, the story, nothing); every
  duplicate pairing, within and across stations; the 80-code-point title on
  both sides (80 with a combining mark and a surrogate pair reads, 81
  fails); unknown kinds at both levels; lenient pruning, stranded choices
  and reports; structural faults under lenient; the list functions.
- `tour-story.property.test.ts`: generated children lists (three sizes)
  read exactly and round-trip; every block listed once in document order
  and every child found where it is; a shared id refused strict and
  lenient; the cross-station check throws exactly when two lists share an
  id; newer-minor values injected anywhere never fail a lenient read and
  leave every goto resolving, every choice with two ways on, every free
  block in the world, every title within the cap and every left-out child
  reported, while a strict read fails; chained stranded choices of depth
  1-6 all go; an over-cap text fails a required field and is dropped,
  reported, from an optional one.
- `tour-stations.test.ts` - every quiz answer type and the advance rule,
  through a whole station.
