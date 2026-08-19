# `source/endpoint-order.ts`

## Purpose

Decide, for one tile fetch, **which endpoints to try and in what order** — a
weighted draw over _operators_ rather than a fixed walk over _entries_.

## Public API

- `planEndpointOrder(endpoints, weights, random): readonly string[]` — a
  permutation of `endpoints`. `random` must return `[0, 1)`.
- `OperatorWeights` — `Record<operator, number>`, relative likelihoods.
- `DEFAULT_OPERATOR_WEIGHT` — used for any operator the table omits.

## The three designs this is the third of

1. **Random start** (until 2026-07-28). Spread load, but made the pool order
   decorative: every client drew uniformly, so the slowest instance served its
   full share — measured at 4.2× the fastest host on identical work.
2. **Strict preference order** (2026-07-28 → 2026-08-19). Fastest host always
   first. The cost was named at the time and accepted: _"the cost is herding:
   every client now tries `endpoints[0]` first."_ The twelfth testing session is
   that cost arriving — a 429 on entry 0, reproducibly.
3. **Weighted draw** (this). The measured-best operator is most likely but not
   certain, so the preference survives and the herd spreads.

**And one fact neither of the first two used.** Five entries are three operators
([`overpass-operators.ts.md`](./overpass-operators.ts.md)). A draw over
_entries_ gives FOSSGIS three tickets in every raffle, so a 429 on one predicts
a 429 on the next. This draws over _operators_.

## Invariants & assumptions

- **The result is a permutation.** Every configured endpoint is reachable —
  which the modulo it replaces could not promise: with `maxRetries = 3` and five
  entries, `attempt % length` reached four of five and bare `overpass-api.de`
  was unreachable in the default configuration.
- **Distinct operators come first.** The first _n_ attempts hit _n_ different
  quotas, so a refusal from one says nothing about the next. This makes
  "never spend two attempts on one operator while an untried operator remains"
  true by construction rather than by a check elsewhere; `overpass-source.ts`'s
  `shouldWaitBeforeRetry` relies on it.
- **Within an operator, pool order is kept.** Its entries share a quota, so
  randomising between them buys nothing, and pool order is already the measured
  preference between the FOSSGIS front-ends.
- **Weights are tiers, not latencies.** Overpass timings do not replicate —
  `spatial/resolutions.ts` records identical work at 15.1 / 32.9 / 82.9 /
  91.1 s — so a weight computed as `1 / median` would be a precise function of
  noise. Coarse tiers say "prefer this" without claiming to know by how much.
- **A bad weight degrades, never throws.** Zero, negative and non-finite are
  floored to zero; an all-zero remainder falls back to the first entry rather
  than dividing by zero. `endpoints` is public surface, so this boundary is
  reachable by a caller.
- **An unweighted operator is ordinary, not unreachable.** A self-hosted
  endpoint passed via `endpoints` will not be in the table, and a client that
  silently never used a host the caller configured would be worse than a slow
  one.

## Examples

```ts
const order = planEndpointOrder(endpoints, OPERATOR_WEIGHTS, Math.random);
// attempt N uses order[N] — and there is an order[N] for every N < endpoints.length
```

## Tests

`endpoint-order.test.ts`. The three that carry the design:

- **a permutation** — no endpoint becomes unreachable;
- **every distinct operator before any repeat** — the property the module exists
  for;
- **heaviest first _most_ of the time, not every time** — both halves asserted,
  because a draw that always returned the heaviest would pass an "is it biased?"
  test while being the strict order again. Sampled by sweeping `[0, 1)`
  deterministically rather than with `Math.random`, so it cannot flake.

Plus pool order within an operator, an unweighted operator still being drawn,
malformed weights degrading rather than throwing, and a single-entry pool.
