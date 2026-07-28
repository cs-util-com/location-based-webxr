# `rules/rule-table-loader.ts`

## Purpose

Loads the rule table through three tiers: live CSV → persisted cache →
checked-in snapshot. Includes the drift guard.

## Public API

- `loadRuleTable(options?): Promise<LoadedRuleTable>` — **never throws**.
- `snapshotRuleTable(now?): RuleTable`
- `checkDrift(candidate, previous, maxDrift): string | undefined`
- `RULE_TABLE_CSV_URL`, `DEFAULT_TTL_MS` (100 min, matching C#),
  `DEFAULT_MAX_RULE_DRIFT` (1/3)

`LoadedRuleTable`: `{ table, tier, degradedBecause? }`.

## Invariants & assumptions

- **Loading never throws.** An app with a stale table works; an app with no table
  has no affordance data at all, and the snapshot is always present. Every
  degradation is reported through `onWarn` **and** named in `degradedBecause`, so
  "why are my scores the old ones?" is answerable from the return value.
- **The TTL short-circuits the network.** Without it the sheet would be fetched
  on every start-up of every app — third-party load we have no right to create.
- **The drift baseline is the CACHE, never the snapshot.** This is the subtle
  one. Drift is a rate-of-change test, so it needs a baseline of comparable age.
  Against the shipped snapshot it measures _elapsed time_: months after a release
  the sheet has legitimately moved on, so a first run (which by definition has no
  cache) would reject the live table, never write a cache, and reject it again
  forever — pinned to a snapshot nobody maintains, silently. That is a worse
  failure than the bad edit the guard exists for.
  - What protects a first run is the **structural** validation in
    `parseRuleTable`, which needs no baseline: unparseable CSV, an over-long
    column name, and a table with no categories are all refused outright. A first
    run therefore cannot accept a login page or a truncated file.
  - A category missing relative to the snapshot on a first run is **warned about
    and accepted**, because the snapshot ages.
- **A vanished category is rejected outright** when a cache exists: some app is
  scoring on it and would silently start getting the identity for everything.
- **The rule-volume threshold is loose (1/3) on purpose.** Real tuning sessions
  change many rows, and a guard that fires on legitimate work gets switched off.
- **`writeCache` uses the INJECTED clock.** Mixing it with `Date.now()` puts the
  cache timestamp on a different time base from the TTL comparison that reads it;
  under an injected clock a just-written entry then reads as fresh forever (a
  negative age is less than any TTL), silently disabling the live fetch. This was
  a real bug, caught by the TTL test.
- The snapshot is stored as **raw CSV**, not a pre-parsed object, so every test
  that uses it exercises the parser.

## Examples

```ts
const { table, tier, degradedBecause } = await loadRuleTable({ store });
if (tier !== "live") console.info(`rules from ${tier}: ${degradedBecause}`);
```

## Tests

`rule-table-loader.test.ts` — the snapshot's shape and every C#-pinned value; the
live tier and its cache write; TTL short-circuit and expiry; stale-cache
fallback; degradation on five distinct failure shapes (network error, HTTP error,
login page, empty body, truncated field); corrupt cache and read-only store; and
the drift guard's reject/accept cases including the first-run acceptance.
