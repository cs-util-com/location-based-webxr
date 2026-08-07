# `rules/rule-table.ts`

## Purpose

The `RuleTable` type, its CSV parser and its validation. The policy layer the
scoring engine consumes; contains no scoring logic itself.

## Public API

- `parseRuleTable(csv, { source, fetchedAt, version? }): RuleTable` — **throws**
  on an over-long column name or a table with no numeric categories.
- `ruleValue(table, key, category): number` — `1` (the identity) when unknown.
- `thresholdFor(table, category): number`
- `ruleTableKeys(table): readonly string[]`
- `DEFAULT_THRESHOLD = 1`

`RuleTable`: `version`, `source`, `fetchedAt`, `categories`, `thresholds`,
`rules`, `keys`, `skipped`.

## Invariants & assumptions

- **Categories are DISCOVERED, never hardcoded.** A column is a category iff it
  is not blacklisted and at least one row gives it a numeric value. This is what
  lets the sheet grow a category with no code change — the live-tuning loop §2.1
  chose to keep.
  - `Count` is blacklisted **by name** rather than left to the numeric test. It
    is not numeric today (`"6 109 792\n30.12%"`), but a formatting change could
    make it parse, and a usage-count column silently becoming a scoring category
    would produce enormous meaningless scores.
- **Absent is NOT zero.** Zero is a hard veto that short-circuits scoring, so
  reading a blank cell as zero would veto on every unfilled cell in a
  deliberately sparse sheet — the most destructive misreading available here.
  `toNumber` is therefore strict, not `Number(x)` (which maps `""` and `" "` to
  `0`).
- **`keys` comes from the sheet's own `Key` column, never from splitting the rule
  id.** The plan originally specified "split on the first underscore", reasoning
  that an OSM _value_ may contain underscores (`surface_fine_gravel`). True but
  incomplete: an OSM _key_ may too — `man_made`, `public_transport`, `leaf_type`,
  `drinking_water`, `recycling_type`, `artwork_type` — and a first-underscore
  split turns those into `man`, `public`, `leaf`, `drinking`, which match nothing
  in Overpass and drop their elements silently. **No split gets both cases
  right**, which is why the explicit column wins.
- **Refused rows are counted, never dropped.** Three kinds, all visible in
  `skipped`: empty ids (8 on the live sheet — spacers and notes), rows that score
  nothing anywhere (**254** on the live sheet), and rows whose field count
  disagrees with the header.
- **The live sheet has 721 rows with ids but only 467 SCORING rules.** The "721
  rules" figure quoted throughout this project's docs counts documentation rows
  too. Pinned by test so the discrepancy cannot be mistaken for a parser bug.
- Per-category thresholds close `OsmToStoreConnectorV2.cs:151`'s open TODO. A
  `__threshold__` row declares them; absent ones default to `1` — the identity,
  and the only defensible default, since higher silently hides regions and lower
  makes every unmapped cell one.

## Examples

```ts
const table = parseRuleTable(csv, { source: url, fetchedAt: Date.now() });
ruleValue(table, "surface_sand", "walkable"); // 5
ruleValue(table, "unknown_tag", "walkable"); // 1 — the identity
```

## Tests

`rule-table.test.ts` — the C# oracle values and the beach = 5 × 7 = 35 product;
category discovery including a new column and the blacklist; absent-vs-zero in
three forms; thresholds; every kind of refused row; and `ruleTableKeys` on
underscore-containing keys.

`key-filter-coverage.test.ts` — measures how much of the table the shipped
Overpass key filter reaches (reported, not thresholded), and asserts the
invariant that actually matters: no fixture element the filter drops would have
scored anything but the identity.
