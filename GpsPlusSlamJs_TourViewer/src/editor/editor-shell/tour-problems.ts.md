# tour-problems.ts

## Purpose

The tour's problems as the editor's bottom panel lists them (its Problems
tab and the badge on its toggle), pure: grouped by station in the tour's
order, the worst first within a station. Also the one rule for "outside
its station's circle" that the inspector's count reads too.

## Public API

- `ProblemSeverity` - `"error" | "warning" | "note"`.
- `TourProblem` (module-private, the shape of `problems`) -
  `{ severity, what, who, select, fix? }`: what is wrong, the item's or
  station's title, the selection a click on its row makes
  (`station:<id>` or an item's id), and the one-click mend where there
  is one.
- `ProblemFix` - `{ label, edit, done }`: the row's link, `edit()` the
  `item-pose` edit the page writes (one undo step; made on the click, never
  on a draw, since it needs the core licence), and what the page says
  once written.
- `ProblemGroup` - `{ stationId, number, title, problems }`, `number`
  1-based, `title` as `stationTitle` gives it.
- `outsideItems(station)` -> the station's items (`worldBlocks`) whose
  ground distance from its centre (the station frame's north and east,
  `pose.position[0]` and `[2]`) is more than `foundRadiusM`; on the circle
  is inside, the height never counts.
- `tourProblems(stations)` -> one group per station that has a problem:
  - warning: "Outside its station's circle (N m from the centre, circle
    R m)" for each item of `outsideItems`, who = `objectTitle(item)`,
    with the fix "Move inside": the item moved along the line it stands
    on to 4 m inside the circle (halfway to the centre for a circle of
    8 m or less), its height and heading kept;
  - note: "Has no content yet" for a station with no blocks.
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
(along its line, height kept; halfway in on a small circle), the counts, and a property:
`outsideItems` is the ground distance against the circle whatever the
height. The inspector's "outside" count is `inspector-model.test.ts`'s.
