# tour-game-check.ts

**Purpose:** the creator's checks over a tour's game rules
(`tour-game-rules.ts`): the mistakes a visitor would otherwise find on
site. Pure, dependency-free, deterministic; nothing calls it yet (the tour
format does not carry game rules yet).

## Public API

- `checkTourGame(game: TourGame): TourGameFinding[]` - structural findings
  first, then reachability, each in declaration order. An empty list means
  no finding, not a proof that the tour plays well.

Findings (`kind`, with where - `at: { station, item? | step?, option? }` -
and, for reachability, `because`):

- `duplicate-name` - a label or counter id declared twice (one namespace).
- `duplicate-id` - two stations (`within: null`), or two steps, items or
  options in one place, with one id.
- `unknown-name` - a condition or effect names something undeclared, or an
  id of the other kind.
- `bad-number` - `start`, `floor` or `atLeast` not an integer, `by` not a
  non-zero integer (`at` is `{ counter }` for a counter's own fields).
- `start-below-floor`.
- `unknown-step` - a `goto` naming no step of its station.
- `label-never-set` - a declared label no effect anywhere sets.
- `unreachable` - a station, item or step no walk can show. Only the
  outermost: an unreachable station's steps and items are not listed.
  `because`: `contradiction` (has and lacks one label), `label-never-set`,
  `label-set-only-by-unreachable-content`, `counter-out-of-reach` (with
  `atLeast` and the bound `max`), `unknown-name`, `bad-number`, or
  `scene-flow` (the scene never arrives at the step).
- `option-never-available` - an option of a reachable step no walk can
  pick; `because` as above, or `floor` (with the bound `max`).
- `choice-may-softlock` - a reachable choice with no free option.

The finding and cause types are not exported until a consumer needs to
name them (dead-code rule); `ReturnType<typeof checkTourGame>` reaches
them.

## Invariants (the exact definitions)

- **Reachability is a sound over-approximation** (a fixpoint, the "delete
  relaxation"): `P`, the labels set by effects of reachable content;
  `max(c)`, the counter's start plus each positive add of reachable
  content once, unbounded when that add's step lies on a loop of its
  scene or the counter is collectible. `has L` could hold when L is in P;
  `lacks L` always (nothing is held at the start); `atLeast n` when
  `max(c) >= n`; a list when each could and it does not both have and
  lack one label. An option could be available when its list could, its
  effects apply, and every counter it lowers by a net d keeps
  `max(c) - d >= floor`. Scene flow: from the first step; a step with a
  requirement may be passed over; a played choice continues through each
  option that could be available (its `goto`, else the next step).
  Sources: those options and both outcomes of every reachable quiz.
- **Promise:** everything reported `unreachable` or
  `option-never-available` is reached by no walk of any round. The
  converse is NOT promised: content needing two round labels that one
  choice gives exclusively is called reachable (pinned as a known
  limitation in the unit tests).
- **Softlock:** a free option has no requirement, effects that apply, and
  no counter going down (net); a pair of otherwise free options requiring
  `has L` and `lacks L` counts as free together. The warning never misses
  a choice some walk reaches with nothing to pick, and may warn about one
  that never is.
- The fixpoint ends (each pass adds a label, raises a bound or stops); a
  cap guards against a defect in that argument.

## Example

```ts
checkTourGame({
  labels: [{ id: 'key', name: 'Key', keep: 'collectible' }],
  counters: [],
  stations: [{ id: 'tower', requires: [{ has: 'key' }], steps: [] }],
});
// [ { kind: 'label-never-set', label: 'key' },
//   { kind: 'unreachable', at: { station: 'tower' },
//     because: { kind: 'label-never-set', label: 'key' } } ]
```

## Tests

- `tour-game-check.test.ts` - every finding by its smallest tour and its
  near miss (a looping payout and a collectible counter are unbounded; a
  has/lacks pair is free), and the known limitation.
- `tour-game-check.property.test.ts` - on random small tours an exhaustive
  search plays every walk of up to three rounds with the rules themselves;
  nothing the check calls unreachable or never available is ever reached,
  and every choice a walk reaches with nothing to pick is reported. Guarded
  against vacuity (both kinds occur). Swept locally over rounds 1-5,
  up to 6 stations and up to 5 steps per station: green throughout; three
  deliberate defects (no unbounded collectible counter, no pass-over edge,
  every choice "free") were each caught.
- `tour-game-scenarios.test.ts` - the four scenario tours are clean.
