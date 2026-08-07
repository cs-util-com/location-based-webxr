# `contributor-order.ts`

**Purpose.** Order the OSM elements that produced a cell's score, most interesting first, so a truncated list never drops the row that explains the score.

## Public API

- `rankContributors(contributors): RankedContributor[]`
  - `contributors` — `CellScore.contributors[category]`, i.e. `featureKey → factor`.
  - Returns **every** entry, sorted by `rank` descending, ties broken on `key`.
- `RankedContributor` — `{ key, factor, rank }`. `rank` is `|log(factor)|`: `Infinity` for a veto, `0` for the identity, `-1` for a nonsensical factor.

## Invariants & assumptions

- **A veto always ranks first.** This is the whole reason the module exists. The previous list sorted descending by factor and cut at eight, so factor `0` sorted _last_ and was the first row dropped — making "why is this cell zero?" the one question the provenance list was worst at, which is exactly the question asked of a cemetery tile.
- **Not `|factor − 1|`.** The obvious repair fails the same case more quietly: a veto scores `|0 − 1| = 1`, so a single `5×` contributor outranks it and the veto is dropped again, this time by a rule that looks principled. Pinned by a test using precisely that pair.
- **Equal ratios rank equally.** The model is multiplicative, so the size of a claim is its ratio to the identity, not its distance from it: `0.5` and `2` are the same magnitude of statement. This is the same `log` transform `heat-colours.ts` applies to the same numbers, so the list and the colours agree about what "a big contribution" means.
- **Factor `1` is kept, and sinks to the bottom.** "This feature touched the cell and the table has no opinion about it" is real information — the reason `scoreOneCell` records it at all — but it is never the answer to "why is this cell 0?".
- **Nothing is dropped here.** Truncation is a presentation decision belonging to the caller, and any caller that truncates must say so: a silently shortened provenance list reads as a complete one, and "these are all the elements that touched this cell" is exactly the claim someone debugging a surprising score would act on. `map-view.ts` shows the top 8 and appends `+N more`.
- **A negative multiplier cannot scramble the list.** Multipliers come from a publicly editable Google Sheet; `Math.log` of a negative is `NaN`, and a `NaN` returned from a comparator makes `Array.sort` produce an arbitrary order for the **whole** array — so one bad row would move every other element, not just itself. `magnitudeOf` maps it to `-1` instead: sorted last, everything else correct.
- Ties break on `key` so a redraw cannot reshuffle the list under the reader's cursor.

## Examples

```ts
rankContributors({ "way/strong": 5, "way/veto": 0, "way/silent": 1 });
// [
//   { key: "way/veto",   factor: 0, rank: Infinity },
//   { key: "way/strong", factor: 5, rank: 1.609… },
//   { key: "way/silent", factor: 1, rank: 0 },
// ]
```

## Tests

`contributor-order.test.ts` — a veto leads against ten mild contributors _and_ against one strong contributor (the case `|factor − 1|` gets wrong); `0.5` and `2` rank equally; the identity is last but present; every contributor is returned; the order is deterministic for equal ranks; a negative factor from a bad sheet edit is ranked last without disturbing the rest; an empty map returns an empty list.

The rendering that consumes it is covered by `playwright-tests/` — _"a cell popup names the OSM elements that produced its score, and they are clickable"_.
