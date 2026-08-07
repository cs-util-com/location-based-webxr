# `model/osm-tags.ts`

## Purpose

Converts an OSM tag into the key used to look it up in the affordance rule
table.

## Public API

- `RULE_KEY_SEPARATOR` — `'_'`.
- `toRuleKey(key, value)` → `` `${key}_${value}` ``.
- `toRuleKeys(tags)` → one key per tag, in insertion order.
- `splitRuleKeyForDiagnostics(ruleKey)` → `{ key, value } | undefined`.
  **Diagnostics only** — see the caveat below.

## Invariants & assumptions

- **The separator is `_`, not `=`.** The plan's prose says `key=value`; the
  published rule sheet and the C# reference both use `key_value`. The sheet
  wins, because it is the actual data: verified on 2026-07-28, 721 of its 729
  rows carry `_` in the `seperator` (sic) column, and its `id` column is built
  as `Key + seperator + Value`. This is recorded as a deviation in the plan.
- **The failure mode is silent**, which is why it is pinned by tests. A wrong
  separator makes every lookup miss; every feature then scores 1 (the
  multiplicative identity) and the index looks like "nothing mapped here"
  rather than like a bug.
- **No normalisation of any kind** — no lowercasing, trimming or unit parsing.
  The rule table is keyed on raw OSM values.
- **`splitRuleKeyForDiagnostics` is not a true inverse and cannot be.** Both OSM
  keys and values contain underscores, so `public_transport_platform` splits to
  `public` / `transport_platform`. The name is deliberately unwieldy so it is
  not reached for casually. Never use it to round-trip a key back into a tag.

## Examples

```ts
import { toRuleKey, toRuleKeys } from "./osm-tags.js";

toRuleKey("surface", "sand"); // "surface_sand"
toRuleKeys({ surface: "sand", natural: "beach" });
// ["surface_sand", "natural_beach"]  -> beach cell scores 5 * 7 = 35 walkable
```

## Tests

- `osm-tags.test.ts` — pins the separator and seven exact ids read out of the
  live sheet (the same ones the C# oracle uses), asserts that no normalisation
  happens, and documents the diagnostic splitter's known wrongness with a test
  that asserts the wrong answer on purpose.
