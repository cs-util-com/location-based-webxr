# `src/rules/default-rules.ts`

## Purpose

The checked-in snapshot of the published affordance rule sheet — the loader's
bottom tier, and the only one that works with no network and no cache.

**GENERATED. Do not hand-edit.** Regenerate with `pnpm run import:rule-table`.

## Public API

- `DEFAULT_RULE_TABLE_VERSION` — the capture date, `YYYY-MM-DD`. Surfaced so a
  demo can say how old the fallback it is running on is.
- `DEFAULT_RULE_TABLE_CSV` — the sheet verbatim, as CSV. Parsed by
  `parseRuleTable` like any other tier, so the snapshot cannot take a shortcut
  the live path does not have.

## Invariants & assumptions

- **It is a snapshot, not a default.** The rule table is fetched at runtime by
  owner decision (plan §2.1); this exists so a first run offline, a rate-limited
  sheet or a bad edit still produces a working table.
- **It must stay parseable by the CURRENT parser.** It goes through
  `parseRuleTable` at load, so a parser change that would reject it fails a test
  rather than only failing in the field.
- **It is deliberately NOT the drift baseline.** Drift is comparative — "did
  this change suspiciously fast?" — and measuring a live sheet against a
  months-old snapshot measures elapsed time instead. `rule-table-loader.ts` says
  so at length; the baseline is the cache, which is why the demo passing a
  `store` is load-bearing (raised in review on #233).
- **Regenerating changes behaviour.** The captured sheet decides what every
  offline run scores, so a re-import is a behavioural change and belongs in its
  own commit with the capture date in the message.

## Examples

```ts
const table = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "snapshot",
  fetchedAt: 0,
});
```

## Tests

`rule-table-loader.test.ts` exercises the tier this file backs — the snapshot is
returned when the live fetch fails and no cache exists, and the returned
`tier`/`degradedBecause` say so rather than presenting it as current data.
`rule-table.test.ts` covers the parser it must survive.

**No sidecar existed until #233's review asked whether the omission was
deliberate.** It was not: the repo's rule has two named exemptions — test files
and pure re-export barrels — and a generated data file is neither. The header
comment in the file carries the provenance; this carries the contract.
