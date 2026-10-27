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
  - `TourStepAdvance` - `{ mode: 'tap' }` or `{ mode: 'auto', afterS }`.

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
  read so a renderer never guesses) or `{ mode: 'auto', afterS > 0 }`.
- Step ids are unique within the station.

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
- `tour-stations.test.ts` - every quiz answer type and the advance rule,
  through a whole station.
