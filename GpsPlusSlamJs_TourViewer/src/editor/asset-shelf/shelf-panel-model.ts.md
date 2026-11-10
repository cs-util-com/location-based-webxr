# shelf-panel-model.ts

## Purpose

The asset shelf's panel as plain data: what each file's card says, the
summary over the list, the kind chips, the folded rail's rings and badge
and the phone's progress pill. Pure functions over the shelf's rows
(`selectShelfRows` in `asset-shelf-slice.ts`); the DOM is
`shelf-panel.ts`'s.

## Public API

- `formatBytes(bytes)`: "300 KB" (at least 1 KB), "1.5 MB" under 10 MB,
  "48 MB" above. A bad size reads as the smallest.
- `SHELF_KINDS`: per asset kind its label ("Sound"), chip plural
  ("Sounds") and icon name.
- `cardState(phase)`: the job's phase as the card's look (`running` is
  `processing`, `optimized` is `ready`).
- `fileExt(name)`, `cardKindLine(row)`: "Sound · WAV · 9.0 MB", the size the
  file came in.
- `stateLine(row)`: the card's state line, a tagged union: queued ("Queued,
  2 before it" / "Queued, next"), processing (phase words, whole percent),
  ready (sizes, gain or null), idle, kept, failed (title, retry offered,
  reason).
- `cardMore(row)`: the words of an opened card.
- `gainPercent(before, after)`: whole percent smaller, null when not
  smaller or unknown.
- `usesLabel(n)`, `placesWord(n)`.
- `shelfSummary(rows)`: empty, busy (count, mean progress) or done (ready
  count, what a phone downloads against the originals, gain), each with
  the opened tour's files not made smaller (`optour`).
- `shelfChips(rows, filter)`, `shownFilter`, `filteredRows`: "All" and
  one chip per kind present; none under two files; a filter whose kind
  left the shelf falls back to "All".
- `RAIL_RINGS` (7), `railView(rows)`: a ring per file queued, running or
  failed (a failure full), the rest counted, a check once all is done.
- `shelfBadge(rows)`: failures (bad) first, else files in the works, else
  null.
- `pillView(rows)`: the phone pill's text, or null.
- `cardWarning(row)`: a video's words when it is large for its length
  (`video-size.ts`, on `estimatedBytes` over `seconds`); null for other
  kinds or no known length.
- `shapeKey(rows)`: everything a full draw depends on (the swaps, a
  video's poster and length too) except the progress, so the panel moves bars alone between real changes.

## Invariants & assumptions

- What a phone downloads is the sum of `estimatedBytes` (the smaller
  file's size, else the original's), so a failed or untouched file counts
  whole; nothing is ever counted as saved that was not.
- Percentages are clamped to 0..100 and ring progress to 0..1, whatever
  the row carries.
- No text here comes from markup: names are returned as data for the DOM
  to set as text.

## Example

```ts
const rows = selectShelfRows(store.getState());
const summary = shelfSummary(rows); // { kind: "busy", lead: "Optimizing 2 of 5", ... }
```

## Tests

`shelf-panel-model.test.ts`: every state line, the summary's sums, the
chips' fallback, the rail's cap and rest, the badge and pill ending with
the work, a video's warning (and none for other kinds or no length),
the redraw on a new poster, length or swap, and properties for the
gain's and the rings' ranges.
