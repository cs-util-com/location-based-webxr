# add-palette-model.ts

## Purpose

The Ctrl+K palette's rows, pure: a typed query names a kind and a place
in one go ("long gate", "pin 3") and the palette lists what that adds
where, best first; Enter adds the first.

## Public API

- `PaletteStation` - `{ id, number, title }`, a station in the tour's
  order (`number` from 1).
- `PaletteAdd` - `{ kind: "pin" | "longText", stationId }` or
  `{ kind: "station" }`: what a row adds.
- `PaletteRow` - `{ add, label, place, icon }`: the kind in words
  ("Short text", "Long text", "New station"), where it goes ("in 2 The
  old gate", or `NEW_STATION_PLACE` "at the centre of the view"), its
  shell icon.
- `paletteRows(query, stations, selectedStationId)` -> `PaletteRow[]`:
  - candidates: every addable kind of `ADD_CHOICES` (`tree-add-menu.ts`)
    in every station, then a new station;
  - an empty query lists the default place's rows only: the selected
    station's (else the first station's) kinds and the new station;
  - otherwise a row is listed when every word of the query (NFC, lower
    case, split on spaces; the places folded the same way) starts one of its kind's words (its label and
    `words`) or is anywhere in its place;
  - ordered by a score: 20 for a station whose number a word is
    exactly (so "long 1" adds to 1 even with 11 selected, whose place
    contains "1" too), 10 for the default place, -1 for the new
    station, per word 3 for a kind word it starts and 3 more when it
    starts the kind's label; equal scores keep the tour's order;
  - at most `PALETTE_MAX_ROWS` (40).

## Invariants & assumptions

- The picture (`addable: false`) is never offered: it adds nothing from
  the editor.
- A selected id that is not among `stations` counts as no selection.
- No row is listed twice; a word matching nothing lists nothing (no
  fallback to the default place).

## Examples

```ts
paletteRows("long steps", stations, "gate");
// [{ add: { kind: "longText", stationId: "steps" }, label: "Long text",
//    place: "in 3 The town hall steps", icon: "text" }]
```

## Tests

`add-palette-model.test.ts`: the empty query at the selection and at
the first station, kind and place in one query, an exact station
number over the selection among 12 stations, a query in another
Unicode form, the label's rank, no
match and no picture, a tour without stations, case and spaces, and a
property over 30 stations (each row once, the cap, a kind alone first at
the selection).
