# `source/operator-health.ts`

## Purpose

Tracks how well each Overpass **operator** has served this source, and scales
the caller's base weights by it — so the endpoint draw moves away from a host
that is refusing and back when it recovers.

Owner decision D1, 2026-09-21: adapt rather than re-tune. See
[the decision record](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-21-1020-osm-latency-owner-decisions-followups.md).

## Public API

- `createOperatorHealth(): OperatorHealth`
  - `record(operator, outcome)` — `outcome` is `"success" | "failure" | "ours"`.
    `"ours"` is **dropped, not counted**.
  - `weightsFrom(base): OperatorWeights` — the base weights scaled by observed
    health. An operator with no observations comes back **identical**, so a
    fresh session draws exactly as the constants say.
  - `snapshot()` — the decayed tallies, for diagnostics.
- `DEFAULT_HEALTH_FLOOR` — 0.1, the smallest share of its base weight an
  operator can fall to.
- `OperatorOutcome`. (`OperatorTally` is deliberately NOT exported - nothing
  outside names it, and the root knip stage rejects an export with no importer.
  It is reachable as `snapshot()`'s return type.)

## Invariants & assumptions

- **It never reaches zero.** A zero weight removes an endpoint from the draw
  entirely, so a host that recovers is never tried again and never earns the
  success that would restore it — a transient outage made permanent by the
  mechanism meant to route around it. The floor is a safety net, not a knob:
  swept over 0.05 / 0.1 / 0.25 the simulated results were identical.
- **It is inert while everything works.** The ratio is 1 for an operator that
  keeps succeeding, so a healthy pool is drawn exactly as the base weights say.
  This is the property that makes reacting fast safe, and it is asserted
  directly.
- **It forgets.** Counts decay by `DECAY` per observation, so an operator that
  recovered stops being punished. Without it a host demoted in the first minute
  carries that for the session — the same staleness a static weight already has.
- **It ignores our own faults.** A 400 or 414 is a malformed query, reported
  honestly by whichever host received it. Demoting that host would walk the
  pool one endpoint at a time while the query stayed broken. An **abort** is not
  evidence either: the caller left, and the host may have been about to answer.
- **Per source instance.** Two sources in one page are two clients with two
  quotas and two experiences; sharing the tally would let one source's outage
  steer the other's draw.

## How the parameters were chosen

Not by taste. The measured 2026-09-21 per-host outcomes (5 whole tiles per
endpoint, counterbalanced) were resampled into 30-tile sessions and the
parameters swept. Mean time per tile:

- static, as shipped (`4 / 3 / 1`) — **39.5 s**
- adaptive, `prior` 3 — 33.9–34.8 s
- adaptive, `prior` 2 — 32.8–33.9 s
- adaptive, `prior` 1 — **30.4–30.7 s**
- static, tuned to that day (`8 / 1 / 0`) — 22.3 s

And against the counter-scenario the measured day cannot show — a synthetic pool
where every host is healthy — **every** setting swept gave **17.9 s**, which is
the static weights' own figure. So a fast-reacting prior costs nothing when
nothing is broken, and saves the most when something is.

**Two honest limits on that.** The day-tuned static is the best of the three,
because the sweep resamples the very day it was tuned to; the whole argument for
adapting is that the pool moves (`maps.mail.ru` was 3/3 on 2026-09-20 and 1/5 a
day later), and one day's data cannot show that. And `PRIOR = 1` was chosen
against an intuition that had already been written into a test — that a small
prior would "chase noise". The measurement found no noise to chase, and the test
was rewritten to assert what the measurement supports.

`DECAY` and the floor made almost no difference across the swept ranges. `PRIOR`
did.

## This is NOT the adaptive deadline rejected on 2026-09-20

The two are one observation apart and point opposite ways. A **deadline** that
adapts learns to be patient with a slow host — exactly backwards. A **weight**
that adapts learns to avoid it.

## Examples

```ts
const health = createOperatorHealth();
health.record("fossgis", "failure");
planEndpointOrder(endpoints, health.weightsFrom(DEFAULT_OPERATOR_WEIGHTS), rng);
```

## Tests

- `operator-health.test.ts` — the module itself, written against the ways a
  feedback loop breaks rather than the way it works: never zero, reversible,
  forgets, ignores our own faults, inert while healthy.
- `overpass-source.test.ts`, "the draw learns which operators are actually
  serving" — the wiring. A tracker nothing feeds does nothing, so these assert
  that the source classifies each attempt correctly and that the classification
  reaches the draw. The central one was verified by **reverting** the wiring and
  watching it go red; a first version of it read the last endpoint of each tile
  instead of the first and was vacuous.
