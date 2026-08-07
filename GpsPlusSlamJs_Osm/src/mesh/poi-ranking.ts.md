# `mesh/poi-ranking.ts` — which POI kinds earn a model

## Purpose

Ranks the weighting sheet's tag values by worldwide usage, restricted to the
kinds a POI marker can actually be placed for, so "which fifty get a model" is a
data question rather than a taste one.

## Public API

- `RankedPoiKind` — `{ kind: "key=value", key, value, count }`.
- `parseUsageCount(raw): number | undefined` — the leading integer of a `Count`
  cell.
- `rankPoiKinds(csv, limit): RankedPoiKind[]` — most common first.
- `POI_MODEL_LIMIT` (50) — DEC-R4-7's number.

## Invariants & assumptions

- **Only the nine keys `poi.ts` marks are eligible.** `landuse`, `building`,
  `highway`, `barrier` and `surface` rows are ways and areas owned by
  `plates.ts`, `roads.ts` and `buildings.ts`; a model for one of those would
  never be drawn, so it would be invisible work that looks like coverage.
- **`Count` holds a space-grouped number, a newline, then a percentage** on the
  live sheet. `Number` gives `NaN` and would rank everything equally; reading the
  second line as digits would rank a rare tag at "3012". Only the first line is
  parsed, and non-breaking and thin spaces are stripped as well as ordinary ones
  — all three appear in spreadsheet exports.
- **Ties break on the kind string**, so the ranking is total and re-running it
  produces the same list. Without that, equal-count tags would swap places
  between runs and the committed model set would look like it had drifted.
- **The first duplicate row wins**, for the same stability reason.
- **The result is committed as models, not computed at runtime.** The sheet is
  publicly editable; deriving the model set at runtime would let a sheet edit
  silently orphan a model or reference one that was never written.
  `poi-models.test.ts` asserts the registry still equals the derivation.
- **Row-level rejection lives in its own function.** Five independent reasons a
  row does not qualify read better as a chain than interleaved with the ranking,
  and the split is what keeps the loop under the complexity gate.

## Examples

```ts
const top = rankPoiKinds(DEFAULT_RULE_TABLE_CSV, POI_MODEL_LIMIT);
// [{ kind: "amenity=parking", count: 4606803 }, ...]
```

## Tests

`poi-models.test.ts` — the registry covers exactly the ranked fifty; the count
parser reads the sheet's real format and rejects anything else; the ranking is
ordered and stable across runs.
