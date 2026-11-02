# view-picker.ts

## Purpose

The long text's view picker as data: three segments (Reading sign,
Screen only, Captions), the pressed one, the dimmed ones and the line
under them. Only Reading sign is a view the tour format stores for a
long text (`TOUR_BLOCK_VIEWS.longText` is lectern, reading, card); Screen
only and Captions are the visitor's own choices in the view switch, so
they are shown, focusable and explained, never written.

## Public API

- `LongTextSegment`, `LONG_TEXT_SEGMENTS`.
- `segmentRefusal(id, hasNarration)` - why a segment cannot be chosen,
  null for Reading sign.
- `viewPickerModel({ view, hasNarration, asked? })` -> `{ segments,
description, offerNarration }`; `asked` is the dimmed segment last
  chosen, whose reason the line gives; `offerNarration` only for
  Captions without a narration.
- `stepSegment(from, 1 | -1)` - the arrow keys' next segment, wrapping.
- `viewLabel(view)` - a stored view's name (Reading sign, Reading stand,
  Station card; "Long text" for one this editor does not know), for the
  preview's head.

## Invariants & assumptions

- A stored lectern or card presses no segment and says so.
- Nothing here writes; the writer calls `writeView` only for a segment
  that is not dimmed.

## Tests

- `view-picker.test.ts`.
