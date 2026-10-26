# tour-story.ts

**Purpose:** a station's STORY in `tour.json` version 4 - the order of
what a visitor meets at a station and what they are asked. A step SHOWS
one of the station's blocks (`tour-blocks.ts`), asks a CHOICE, or asks a
QUIZ; all content lives in the blocks. Blocks and story are read together,
because each decides the other: a `show` must name a block of this
station, and a block no step shows is free and must stand in the world.

**Not wired yet.** The manifest still reads and writes version 3, whose
steps carry their content inline (`tour-stations.ts`). The quiz and the
advance rule are that module's (`parseTourQuiz`, `parseTourStepAdvance`),
so both versions read them alike.

## Public API

- `parseTourStationContent(value, at, options): TourStationContent` -
  reads `value.blocks` and `value.steps`; `options` are
  `TourBlocksReadOptions` (`{ assets, fail, lenient?, onDropped? }`).
  Throws through `fail` naming the first violation.
- `serializeTourStationContent(content, { assets, fail? }): TourStationContent`
  - the content as a writer writes it, re-read strictly from a JSON copy;
    any value a reader would leave out (an optional text over its cap)
    fails here instead. Ready for `JSON.stringify`.
- Types:
  - `TourStationContent` - `{ blocks: TourBlock[], steps: TourStoryStep[] }`;
  - `TourStoryStep` - `{ id, action, advance }`;
  - `TourStoryAction` - `{ kind: 'show', block }`,
    `{ kind: 'choice', prompt, options }` or `{ kind: 'quiz' } & TourQuiz`;
  - `TourStoryOption` - `{ id, label, goto? }`.

## The story

- `show`: names a block of THIS station. Another station's block, or none,
  fails the file. Two steps may show one block.
- `choice`: a non-empty prompt and at least two options with unique ids;
  an option's `goto` names a step of this station, or is absent - the
  scene continues at the next step. A `goto` naming no step fails.
- `quiz`: `question`, `points` and `answer` as in version 3. There is no
  `route`: answers do not branch the walk. A `route` field is an unknown
  field and ignored.
- Step ids are unique within the station; `advance` is `tap` when absent.

## Invariants & assumptions

- After a read, every `show` names a block in `blocks`, every `goto`
  names a step in `steps`, every choice has at least two options, and
  every block no step shows is in a world view (`pin`, `plane`, `placed`).
- **LENIENT for a NEWER MINOR:** a step of an unknown kind, a quiz of an
  unknown answer type, and a `show` naming a block the reader skipped are
  left out. A choice then keeps only the options whose step is still there
  (an option with no `goto` always is), and a choice left with fewer than
  two goes too - repeated until nothing changes, because skipping a choice
  can strand another that jumped to it. A block left free by a skipped
  step must still stand in the world, or it is skipped and reported. A
  `goto` naming a step that does not exist at all still fails, named by
  its step's index in the file (skipped steps counted).
- Strict at this reader's own minor: every one of these fails.

## Examples

```ts
const content = parseTourStationContent(station, 'stations[0]', {
  assets,
  fail,
});
const record = serializeTourStationContent(content, { assets });
JSON.stringify(record);
```

## Tests

- `tour-story.test.ts` - show, choice and quiz steps; a show of another
  station's block refused; one block shown twice; an optional and a
  dangling `goto`; option and step ids unique; a quiz route ignored; an
  unknown action kind refused; a free card refused; lenient skips,
  choice pruning, floor views; the writer's strict re-read.
- `tour-story.property.test.ts` - generated station contents (swept at
  three sizes) read exactly and round-trip through the writer; newer
  minor values injected anywhere never fail a lenient read and leave no
  dangling reference, while a strict read of the same file fails; chained
  stranded choices of depth 1-6 all go; an over-cap text fails a required
  field and is dropped, reported, from an optional one.
