# tour-game-check.ts

**Purpose:** the creator's checks over a tour's game rules
(`tour-game-rules.ts`): the mistakes a visitor would otherwise find on
site. Pure, dependency-free, deterministic; nothing calls it yet (the tour
format does not carry game rules yet).

## Public API

- `checkTourGame(game: TourGame): TourGameFinding[]` - structural findings
  first, then reachability, each in declaration order. An empty list means
  no finding, not a proof that the tour plays well.
- **Parsed input expected:** the game's `labels`, `counters` and
  `stations` arrays and each station's `steps` must be present, and every
  counter's `floor` filled in (the parser's default is 0). The check does
  not re-validate the shape: a missing array throws.

Findings (`kind`, with where -
`at: { station, item? | step?, option? | outcome? }`, `outcome` being
`"correct"` or `"wrong"` for a quiz - and, for reachability, `because`):

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
  pick: a choice's option, or a quiz outcome; `because` as above, or
  `floor` (with the bound `max`). A quiz is answered only as a whole, so
  an outcome the tour can never pay closes the whole quiz for good: the
  finding names that outcome, the quiz may trap, and the scene flow stops
  there.
- `choice-may-softlock` - a reachable choice or quiz with no free option.
  A quiz - typed or a choice of answers - is ONE option with two outcomes,
  as the rules answer it: it can be answered only when both could be paid
  (greying or refusing only the unpayable answers would give the right
  one away), and it is free only when neither outcome costs. So any cost
  on either outcome warns: the visitor may reach the quiz unable to pay
  and find it greyed or hidden as a whole. The cure is a quiz without
  costs (gains are fine), or a way to earn what it costs before it.
- There is no warning about a quiz giving its answer away: answered only
  as a whole, no quiz can single out its right answer, whatever its
  outcomes cost and whether the counter is visible or secret.

**No reachability verdict on a misread tour:** while any `duplicate-name`,
`start-below-floor` or counter `bad-number` (`start` or `floor`) finding
exists, only the structural findings are returned. The rules and this
check could read such declarations differently (the rules' start state
takes the last of two same-named counters, the check the first), and a
verdict on the wrong reading could call reachable content unreachable.
Skipping was chosen over making both read declarations identically: it is
one rule instead of a second reading to keep in step, and such a tour must
be fixed before its reachability means anything.

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
  lack one label. An option (a choice's option or a quiz outcome) could be
  available when its list could, its effects apply, and every counter it
  lowers by a net d keeps `max(c) - d >= floor`; a quiz could be answered
  when both its outcomes could be available. Scene flow, by the rules'
  `stepAfter`: from the first step; a step with a requirement may be
  passed over; a played choice or quiz continues through each option that
  could be available (a choice's `goto`, else the next step; a `goto`
  naming no step ends the scene, so a payout behind it counts once).
  Sources: the options of reached steps that could be available.
- **Promise:** everything reported `unreachable` or
  `option-never-available` is reached by no walk of any round. The
  converse is NOT promised: content needing two round labels that one
  choice gives exclusively is called reachable (pinned as a known
  limitation in the unit tests).
- **Softlock:** a free option has no requirement, effects that apply, and
  no counter going down (net); a pair of otherwise free options requiring
  `has L` and `lacks L` of a DECLARED label counts as free together. The
  warning never misses a choice or quiz some walk reaches with nothing to
  pick, and may warn about one that never is.
- **The fixpoint ends:** every condition only gets easier as the bounds
  grow, so the set of sources only grows and the bounds are a function of
  it; a pass that changes them adds a source or makes one repeatable, at
  most twice per source. The pass cap is `2 x options + labels + 2`
  (a quiz counting as one option: its two outcomes become sources
  together). Reaching it would mean a
  defect in that argument; the result is then the TOP bounds (every
  declared label could be held, no counter has a bound), which keeps both
  promises - never bounds cut short, which break both.

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
  has/lacks pair is free, but not for an undeclared label; a quiz with one
  free outcome cannot trap), a `goto` naming no step, a chain of options
  the fixpoint climbs one per pass (1 to 300 long), the malformed
  declarations that suppress the reachability verdict, the known
  limitation, and quizzes answered only as a whole: one unpayable outcome
  closes the quiz and stops the scene; different costs, equal costs and a
  secret counter all warn only that the quiz may trap; a quiz without
  costs, or with gains only, is silent.
- `tour-game-check.property.test.ts` - on random small tours (any `goto`,
  backwards, to itself or to no step) an exhaustive search plays every
  walk of up to three rounds with the rules themselves, dropping walk
  states with a counter above 20 so loops stay finite (dropping can hide a
  broken promise, never invent one); nothing the check calls unreachable
  or never available is ever reached, and every choice or quiz a walk
  reaches with nothing to pick is reported. 1000 runs; guarded against
  vacuity per cause (each `unreachable` cause, `floor` and
  `counter-out-of-reach` options, stuck steps all occur). The walk of the
  `goto`-to-no-step tour is pinned beside it. The tours carry secret
  counters, and the walk answers quizzes as the rules allow - only as a
  whole - so a quiz closed by one unpayable outcome is a stuck step the
  softlock promise must cover (guarded: such walks occur).
- Parameters swept locally (2026-10-22), green throughout: the counter
  cap 5-50 against rounds 2-4 (600 runs each), up to 6 stations of up to
  5 steps (300 runs), the chain length 1-2000 (2000 takes 1.6 s). Mutants
  caught: `onLoop` always false (8 of 8 seeds at 1000 runs, 4 of 8 at
  250 - why the run count is 1000), no softlock for a quiz, a pass cap cut
  short returning its bounds (the chain test; the property at caps 1-2).
  The TOP fallback stays green at caps 2-5. With every quiz answered only
  as a whole (2026-10-25): green at counter caps 5/20/40 against rounds
  2-4 (1000 runs each); mutants caught: a quiz whose outcomes the check
  judges one by one (property 5 of 5 seeds, and unit), the rules
  accepting the right answer while the wrong one cannot be paid (property
  3 of 3 seeds - it then reaches steps the check calls unreachable).
- `tour-game-scenarios.test.ts` - the four scenario tours are clean.
