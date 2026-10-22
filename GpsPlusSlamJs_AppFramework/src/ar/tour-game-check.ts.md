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
  pick: a choice's option, or a quiz outcome (a wrong answer whose cost the
  tour can never pay is never available, and the quiz then gives its
  answer away); `because` as above, or `floor` (with the bound `max`).
- `choice-may-softlock` - a reachable choice or quiz with no free option.
  A typed quiz (`typed: true`) is ONE option with two outcomes: it can be
  answered only when both could be paid (so one outcome the tour can never
  pay closes it, reported on that outcome, and stops the scene flow), and
  it is free only when neither outcome costs.
- `quiz-may-give-answer-away` (with `counter`) - a reachable choice quiz
  (not typed) whose two outcomes could each be paid but change a VISIBLE
  counter by different nets, the lower one negative. Then at some value of
  that counter the dearer outcome's answers are greyed beside the
  cheaper's, which shows the visitor which answer is right. The remedy
  the view should suggest: equal costs on both outcomes. It does not fire
  for a typed quiz (one input for both), for a secret counter (the answers
  are hidden, not greyed - though hiding the dearer outcome's answers
  singles out the right ones as well, so that case is a known gap), or
  when one outcome can never be paid (that is
  `option-never-available`, the "always" case).

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
  lowers by a net d keeps `max(c) - d >= floor`. Scene flow, by the rules'
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
- **Giving the answer away:** with both outcomes payable at the bound, a
  visible counter with nets `a != b`, `min(a, b) < 0`, has values in
  `[floor, max(c)]` where the cheaper outcome is payable and the dearer is
  not (the bound guarantees one), so the warning is an over-approximation
  like the softlock one: it never misses a quiz some walk reaches showing
  one outcome's answers available and the other's greyed (that walk's
  state lies in the range), and may warn about one no walk reaches so.
- **The fixpoint ends:** every condition only gets easier as the bounds
  grow, so the set of sources only grows and the bounds are a function of
  it; a pass that changes them adds a source or makes one repeatable, at
  most twice per source. The pass cap is `2 x options + labels + 2`
  (options counting each quiz's two outcomes). Reaching it would mean a
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
  limitation, typed quizzes against choice quizzes (one unpayable outcome
  closes a typed input; any cost may trap it), and the give-away warning
  with its near misses (equal costs, upward costs, typed, secret counter,
  an outcome never payable).
- `tour-game-check.property.test.ts` - on random small tours (any `goto`,
  backwards, to itself or to no step) an exhaustive search plays every
  walk of up to three rounds with the rules themselves, dropping walk
  states with a counter above 20 so loops stay finite (dropping can hide a
  broken promise, never invent one); nothing the check calls unreachable
  or never available is ever reached, and every choice or quiz a walk
  reaches with nothing to pick is reported. 1000 runs; guarded against
  vacuity per cause (each `unreachable` cause, `floor` and
  `counter-out-of-reach` options, stuck steps all occur). The walk of the
  `goto`-to-no-step tour is pinned beside it. The tours also carry typed
  quizzes (answered only when both outcomes are payable) and secret
  counters, and a third promise is held: every choice quiz a walk reaches
  with one outcome available and the other greyed is reported as
  `quiz-may-give-answer-away` or as an outcome never available (guarded:
  both the walk state and the warning occur).
- Parameters swept locally (2026-10-22), green throughout: the counter
  cap 5-50 against rounds 2-4 (600 runs each), up to 6 stations of up to
  5 steps (300 runs), the chain length 1-2000 (2000 takes 1.6 s). Mutants
  caught: `onLoop` always false (8 of 8 seeds at 1000 runs, 4 of 8 at
  250 - why the run count is 1000), no softlock for a quiz, a pass cap cut
  short returning its bounds (the chain test; the property at caps 1-2).
  The TOP fallback stays green at caps 2-5. With typed quizzes and the
  give-away promise added: green at counter caps 5/20/40 against rounds
  2-4 (1000 runs; cap 40 with 4 rounds takes 17 s); mutants caught 5 of 5
  seeds each: no give-away warning (property and unit), a typed quiz
  treated as a choice quiz (property and unit), the warning firing on a
  secret counter (unit only - over-warning breaks no promise).
- `tour-game-scenarios.test.ts` - the four scenario tours are clean.
