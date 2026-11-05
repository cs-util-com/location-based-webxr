# tour-story.ts

**Purpose:** a station's STORY in `tour.json` version 4 - the order of
what a visitor meets at a station and what they are asked. A step SHOWS
one of the station's blocks (`tour-blocks.ts`), asks a CHOICE, or asks a
QUIZ; all content lives in the blocks. Blocks and story are read together,
because each decides the other: a `show` must name a block of this
station, and a block no step shows is free and must stand in the world.
The manifest reads every station's blocks and story here
(`tour-stations.ts`).

## Public API

- `parseTourStationContent(value, at, options): TourStationContent` -
  reads `value.blocks` and `value.steps`; `options` are
  `TourBlocksReadOptions` (`{ assets, fail, lenient?, onDropped? }`).
  Throws through `fail` naming the first violation, a step by its index
  in the file (`stations[0].steps[2].action.block`).
- `tourShownBlockIds(steps): ReadonlySet<string>` - the ids of the blocks
  `steps` show: a station's STORY blocks. Every other block is free.
- Types:
  - `TourStationContent` - `{ blocks: TourBlock[], steps: TourStep[] }`;
  - `TourStep` - `{ id, action, advance }`, the file's own shape;
  - `TourStepAction` - `{ kind: 'show', block }`,
    `{ kind: 'choice', prompt, options }` or `{ kind: 'quiz' } & TourQuiz`;
  - `TourChoiceOption` - `{ id, label, goto? }`;
  - `TourQuiz` - `{ question, points, answer }`; `TourQuizAnswer`,
    `TourQuizOption`;
  - `TourStepAdvance` - `{ mode: 'tap' }`, `{ mode: 'auto', afterS }` or
    (minor 2) `{ mode: 'lineEnd' }`.
- `tourStepsMinor(steps): number` - 2 when a step advances on `lineEnd`,
  else 0; the writer stamps the highest minor any part needs.

## The story

- `show`: names a block of THIS station. Another station's block, or none,
  fails the file. Two steps may show one block.
- `choice`: a non-empty prompt and at least two options with unique ids;
  an option's `goto` names a step of this station, or is absent - the
  scene continues at the next step. A `goto` naming no step fails.
- `quiz`: `question`, `points` (an integer >= 0) and `answer`. There is no
  `route`: answers do not branch the walk. A `route` field is an unknown
  field and ignored.
  - Answers: `single { options, correct }`, `multiple { options,
correct[] }` (at least 2 options, unique ids, correct among them),
    `text`/`code { salt, sha256[] }` (salted SHA-256 hex of the accepted
    answers after normalisation - a deterrent only), `number { value,
tolerance >= 0, unit? }`.
- `advance`: `{ mode: 'tap' }` (also when absent, and written out on a
  read so a renderer never guesses), `{ mode: 'auto', afterS > 0 }` or
  `{ mode: 'lineEnd' }` (minor 2: when the character's line ends - its
  voice, else a reading time - which an older reader treats as a tap).
- Step ids are unique within the station.

## Version 5: a station's children (not yet wired)

Beside the version 4 reader, used by nothing but its tests until the
manifest reads version 5. A station holds ONE ordered list of children:
a free block (standing in the world) or a story, which holds its own
ordered list of blocks, choices and quizzes. A block lives in one place,
so being in a story is what shows it.

- `parseTourStationChildren(value, at, options): TourStationChild[]` -
  `options` are `TourChildrenReadOptions` (the block reader's options,
  `onDropped` taking a `TourChildDrop`).
- Types: `TourStationChild` (`TourBlock | TourStory`), `TourStory`
  (`{ id, kind: 'story', title, children }`), `TourStoryChild`
  (`TourStoryBlock | TourChoice | TourQuizEntry`), `TourStoryBlock` (a
  block with `advance`), `TourChoice` (`{ id, kind: 'choice', prompt,
options }`), `TourQuizEntry` (`TourQuiz` with `id` and `kind: 'quiz'`),
  `TourChildDrop` (a `TourBlockDrop` or `{ kind: 'child', child, reason }`),
  `TourChildPlace` (`{ index, story? }`).
- `TOUR_CHILD_KINDS` - `story`, `choice`, `quiz`: disjoint from the block
  kinds, so `kind` alone tells every child apart.
- `TOUR_STORY_TITLE_RULE` - required, 1-80 code points (`tourTextCount`).
- `isTourStory`, `isTourStoryBlock`, `tourChildrenStories`,
  `tourChildrenFreeBlocks`, `tourStoryChildrenBlocks`,
  `tourChildrenBlocks` (every block once, in document order),
  `tourChildrenPlace(children, id)` (null when no child has it).
- `checkTourChildIdsUnique(stations, fail)` - child ids are unique across
  the tour (one children list per station).

Rules:

- The order of the file is kept: stories and free blocks in any order
  (nothing assumes free blocks first).
- A free block must stand in a world view (`placeTourBlocks` with nothing
  shown, so its message still speaks of steps); its `advance`, like a
  choice's or a quiz's, is ignored. A story block takes any view of its
  kind (an unknown one reads as `card`) and an `advance`, tap when absent.
- Blocks, stories, choices and quizzes share one id namespace per station
  (a skipped child's id counted) and across the tour; option ids are
  unique per choice.
- A `goto` names a child of the same story (a skipped one included);
  anything else fails, named by the choice's index in the file.
- A story's title is required: absent, not a string or blank fails at
  every minor; over 80 fails strict, and a lenient read leaves the story
  out, reported (its children are read first, so their structural faults
  still fail).
- A station-level choice or quiz, a story inside a story, or any unknown
  kind fails strict and is left out, reported, under lenient; so is a quiz
  of an unknown answer type. Options naming a left-out child are pruned,
  and a choice left with fewer than two goes, reported, repeatedly.
- Structural faults fail even a lenient read: an id, a duplicate, a
  `goto` naming nothing, a story without a title or `children`, a missing
  list.

## Invariants & assumptions

- After a read, every `show` names a block in `blocks`, every `goto`
  names a step in `steps`, every choice has at least two options, and
  every block no step shows is in a world view (`pin`, `plane`, `placed`).
- **The in-memory step is the file's step.** Nothing maps a step on the
  way in or out, so the manifest's writer writes what it read.
- **LENIENT for a NEWER MINOR:** a step of an unknown kind, a quiz of an
  unknown answer type, and a `show` naming a block the reader skipped are
  left out. A choice then keeps only the options whose step is still there
  (an option with no `goto` always is), and a choice left with fewer than
  two goes too - repeated until nothing changes, because skipping a choice
  can strand another that jumped to it. A block left free by a skipped
  step must still stand in the world, or it is skipped and reported. A
  `goto` naming a step that does not exist at all still fails, named by
  its step's index in the file (skipped steps counted). An unknown
  advance mode is a tap.
- Strict at this reader's own minor: every one of these fails.

## Examples

```ts
const content = parseTourStationContent(station, 'stations[0]', {
  assets,
  fail,
});
const story = tourShownBlockIds(content.steps);
const free = content.blocks.filter((b) => !story.has(b.id));
```

## Tests

- `tour-story.test.ts` - show, choice and quiz steps; a show of another
  station's block refused; one block shown twice; an optional and a
  dangling `goto`; option and step ids unique; a quiz route ignored; an
  unknown action kind refused; a free card refused; lenient skips,
  choice pruning, floor views; errors named by the step's index in the
  file.
- `tour-story.property.test.ts` - generated station contents (swept at
  three sizes) read exactly and survive a JSON round trip unchanged;
  newer minor values injected anywhere never fail a lenient read and
  leave no dangling reference, while a strict read of the same file
  fails; chained stranded choices of depth 1-6 all go; an over-cap text
  fails a required field and is dropped, reported, from an optional one.
- Version 5, `tour-story.test.ts`: order kept with stories first or last;
  free and story blocks' views; advance defaults and ignoring; gotos back,
  forward and refused (another story, a free block, the story, nothing);
  every duplicate pairing, within and across stations; the 80-code-point
  title on both sides (80 with a combining mark and a surrogate pair
  reads, 81 fails); unknown kinds at both levels; lenient pruning,
  stranded choices and reports; structural faults under lenient; the list
  functions.
- Version 5, `tour-story.property.test.ts`: generated children lists
  (three sizes) read exactly and round-trip; every block listed once in
  document order and every child found where it is; a shared id refused
  strict and lenient; the cross-station check throws exactly when two
  lists share an id; newer-minor values injected anywhere never fail a
  lenient read and leave every goto resolving, every choice with two ways
  on, every free block in the world, every title within the cap and every
  left-out child reported, while a strict read fails.
- `tour-stations.test.ts` - every quiz answer type and the advance rule,
  through a whole station.
