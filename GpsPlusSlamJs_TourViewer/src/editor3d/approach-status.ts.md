# approach-status.ts

## Purpose

The approach box's fixed title, "Loading tour", and the one quiet line
under its bar carrying only the detail: which of "Loading stations",
"Loading textures" or "Loading buildings" it says (nothing when nothing
is named), and a hold so the line changes its words at most once per
hold.

## Public API

- `APPROACH_TITLE` - "Loading tour", the box's title (and the progress
  bar's label).
- `APPROACH_LINES` - the three wordings; `ApproachLine` is their union.
  None repeats the title.
- `ApproachPending` - `{ tour, textures, buildings }`, counts of what is
  still loading.
- `approachLine(pending)` - the line for now, by priority tour,
  textures, buildings; null when nothing is waiting (the title keeps the
  box from standing wordless while it flies).
- `LINE_HOLD_MS` - 600.
- `createLineHold(holdMs = LINE_HOLD_MS)` - `{ step(nowMs, wanted), shown }`:
  shown words change only once they have been shown for `holdMs`; a
  change that comes sooner waits, and the latest wanted words win when the
  hold ends (null included). RangeError for a hold that is not a number
  > = 0.

## Invariants and assumptions

- The words never name an internal concept (no tile, relief or upload).
- A count that is not a positive finite number reads as nothing waiting.

## Tests

- `approach-status.test.ts` - the priority, nothing named when nothing
  waits, the title kept out of the lines, and the
  hold swept over 0, 300, 600 and 1 200 ms.
