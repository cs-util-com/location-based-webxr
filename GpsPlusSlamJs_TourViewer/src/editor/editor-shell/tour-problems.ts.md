# tour-problems.ts

## Purpose

The tour's problems as the editor's bottom panel lists them (its Problems
tab and the badge on its toggle), pure: grouped by station in the tour's
order, the worst first within a station. Also the one rule for "outside
its station's circle" that the inspector's count reads too.

## Public API

- `ProblemSeverity` - `"error" | "warning" | "note"`.
- `TourProblem` (module-private, the shape of `problems`) -
  `{ severity, what, who, select, fixes? }`: what is wrong, the item's or
  station's title, the selection a click on its row makes
  (`station:<id>` or an item's id), and the one-click mend where there
  is one.
- `ProblemFix` - `{ label, edit, done }`: the row's link, `edit()` the
  block's `pose` edit (`../../placement/place-edits.ts`) the page writes (one undo step; made on the click, never
  on a draw, since it needs the core licence), and what the page says
  once written.
- `ProblemGroup` - `{ stationId, number, title, problems }`, `number`
  1-based, `title` as `stationTitle` gives it.
- `outsideItems(station)` -> the station's items standing in the world
  (`posedEntries` of `../../placement/placeables.ts`, each a block with its
  placeable; a free character among them) whose ground distance from its
  centre (the station frame's north and east, where the item stands with
  its folders composed) is more than `foundRadiusM`; on the circle is
  inside, the height never counts.
- `tourProblems(stations)` -> one group per station that has a problem:
  - warning: "Outside its station's circle (N m from the centre, circle
    R m)" for each item of `outsideItems`, who = `objectTitle(item)`,
    with two fixes. "Move to a new station" is the explicit way out. "Move
    inside": the item moved along the line it stands on to 4 m inside the
    circle (halfway to the centre for a circle of 8 m or less), its
    heading kept; an item in a folder is written by its place in the
    world, so the document re-expresses it in its folder. Its `edit(groundAt?)`: where
    `groundAt` (the view's loaded ground, as "Put on the ground" reads it)
    has the ground at both the old and the new spot, the item keeps its
    height over the ground (a move of tens of metres on a slope would
    otherwise leave it floating or buried); where either is missing, its
    height in the station's frame is kept;
  - note: "Has no content yet" for a station with no free block (a
    plain folder's blocks count, via `tourFreeBlocks`) and no
    story holding a child that plays (a story of just a choice counts as
    content; an empty story does not, nor does one of only quizzes, which
    do not play yet).
  - warning: a story's loop that no answer can leave (`storyTrap`,
    `../story-steps.ts`): "Steps 1 and 2 go round in a loop that no answer
    can leave: ...", `who` the story's title, `select` the loop's first
    step. A backward jump that can be left is no problem.
- `problemCounts(groups)` -> `{ error, warning, note }`.

## Invariants & assumptions

- **Kinds the data cannot have:** a quiz with no correct answer, a
  picture with none chosen and a station with no position on the map are
  refused by the tour's parser and types (a quiz needs its answer,
  `TourPictureBlock.image` and `TourStation.geo` are required), so no rule
  looks for them.
- No rule yields an error yet; the severity exists so the panel's badge,
  filters and order need no change when one does.
- A station without a problem gets no group, so an empty list means the
  tour has none (the empty state and the hidden badge rest on it).
- Pure and cheap (one pass over the blocks): the shell calls it on each
  draw, which runs only when the tour or the view state changed, never on
  the readout's tick.

## Examples

```ts
const groups = tourProblems(manifest.stations);
const counts = problemCounts(groups); // { error: 0, warning: 1, note: 0 }
```

## Tests

`tour-problems.test.ts`: nothing for a tour without a problem, the
outside warning with its distances, the circle's edge counting as inside,
the empty station's note named by its number, the "Move inside" fix
(along its line, height kept; halfway in on a small circle), an item in
a turned folder judged and moved where it stands, a free character warned
like any item, the counts, and a property:
`outsideItems` is the ground distance against the circle whatever the
height. The inspector's "outside" count is `inspector-model.test.ts`'s.
