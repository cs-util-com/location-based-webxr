# approach-status.ts

## Purpose

The one quiet line under the approach's bar: which of "Loading tour",
"Loading textures" or "Loading buildings" it says, and a hold so the line
changes its words at most once per hold.

## Public API

- `APPROACH_LINES` - the three wordings; `ApproachLine` is their union.
- `ApproachPending` - `{ tour, textures, buildings }`, counts of what is
  still loading.
- `approachLine(pending, flying)` - the line for now, by priority tour,
  textures, buildings; while flying with nothing pending, "Loading tour"
  (the bar never stands alone); otherwise null.
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

- `approach-status.test.ts` - the priority, the flying fallback, and the
  hold swept over 0, 300, 600 and 1 200 ms.
