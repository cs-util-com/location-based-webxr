# `source/overpass-operators.ts`

## Purpose

Answer one question the endpoint list cannot: **which of these URLs share a
quota?** The default pool has five entries and three operators, and every retry
decision depends on the difference.

## Public API

- `operatorForUrl(url): string` — the operator behind a URL. Never throws.
  An unknown host returns its own hostname, i.e. "assume independent".
- `hostnameOf(url): string` — the hostname, or the input unchanged when it will
  not parse.
- `knownOperatorHostnames(): Readonly<Record<string, string>>` — the whole
  table. Exists for the two tests that check coverage of the shipped pool and
  agreement with the script's copy; not for branching.

## Invariants & assumptions

- **Three operators, not five endpoints.** `overpass-api.de`, `lz4.` and `z.`
  are all FOSSGIS; `overpass.private.coffee` and `overpass.kumi.systems` are one
  instance under two names; `maps.mail.ru` is VK. Confirmed from the servers on
  2026-08-19: the three FOSSGIS front-ends answered `/api/status` with one
  connection id and one rate limit, and two named the same backend.
- **Keys are hostnames, not URLs**, so a path change cannot silently un-group a
  host.
- **An unknown host is its own operator, and the default is chosen rather than
  inherited.** The two errors are not symmetric: splitting one operator in two
  costs a single wasted attempt; merging two into one makes a self-hosted
  instance share a stranger's rate limit and throttles it permanently. A
  self-hosted endpoint passed via `endpoints` is exactly the case that must stay
  independent, and exactly the case the table cannot know about.
- **The table is duplicated in `scripts/benchmark-matrix.mjs`, deliberately.**
  That script runs under bare `node` with no build step and cannot import from
  `src`; its header records that as intentional. The duplication is carried by a
  test that asserts the two agree — the same shape the repo already uses for the
  retracted-figures pattern lists across the two roots.

## Who reads it

- `overpass-source.ts`'s `shouldWaitBeforeRetry`. The retry loop rotates
  endpoints on every attempt, and since 2026-08-19 it sleeps **only** when the
  next attempt would return to an operator that has already refused. Before
  that it slept between every attempt, so a 429 from FOSSGIS made the client
  wait out FOSSGIS's quota — up to 30 s, honouring `Retry-After` — and then ask
  VK, whose quota was never the problem. See the twelfth testing session's F2c.

## Examples

```ts
operatorForUrl("https://lz4.overpass-api.de/api/interpreter"); // "fossgis"
operatorForUrl("https://z.overpass-api.de/api/interpreter"); // "fossgis"
operatorForUrl("https://my-own.example/api/interpreter"); // "my-own.example"
```

## Tests

`overpass-operators.test.ts` — the FOSSGIS three-way grouping, the
kumi/private.coffee rename, an unknown host staying independent, no throw on an
unparseable URL, coverage of every entry in the shipped default pool (so a new
FOSSGIS front-end cannot be added to the pool without a table entry and be
silently treated as independent), and agreement with the script's copy.

The retry behaviour that consumes this lives in `overpass-source.test.ts`:
_"does NOT sleep when the next attempt goes to a different operator"_, _"DOES
sleep once the next attempt would return to a refused operator"_, and _"never
sleeps after the LAST attempt"_.
