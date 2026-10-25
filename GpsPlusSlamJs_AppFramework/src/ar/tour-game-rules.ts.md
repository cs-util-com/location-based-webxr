# tour-game-rules.ts

**Purpose:** simple game rules for a tour - labels a visitor holds or not,
integer counters with a floor, what content requires of them, what an
answer's effects change, the inventory, and a second round. Pure,
dependency-free, deterministic.

**Where and why here:** beside `tour-stations.ts`, in the package that owns
the tour format, so a later version of the format's parser can fill these
types and the Tour Viewer and the editor both reach them by the package's
deep import (`gps-plus-slam-app-framework/ar/tour-game-rules`). The types
are this module's OWN: the tour file does not carry game rules yet, and
nothing in the package or any app calls this module so far. Its checks
are `tour-game-check.ts`.

## Model

- **Label** `{ id, name, keep, secret? }` - `keep` is `"collectible"`
  (survives a new round) or `"round"` (forgotten by it); a `secret` label
  is hidden in the inventory until held, and an option it blocks is hidden
  rather than greyed.
- **Counter** `{ id, name, keep, start, floor, secret? }` - an integer that
  never goes below `floor`. `floor` is REQUIRED here: the parser fills in
  the format's default (0) before calling these rules. A `secret` counter
  is not shown in the inventory, and an option it blocks is hidden.
- Labels and counters share one id namespace (the check reports a clash).
- **Condition** (a state): `{ has }`, `{ lacks }`, `{ counter, atLeast }`.
  A list holds when ALL hold; empty or absent always holds.
- **Effect** (an event): `{ set }`, `{ clear }` (both idempotent),
  `{ add, by }` (`by` a non-zero integer). A list applies in order; a later
  set or clear of the same label wins.
- **Where they sit:** `requires` on a station, an item, a step and a choice
  option; `effects` on a choice option; `outcomes: { correct?, wrong? }` on
  a quiz step. A choice option's `goto` names a step of the same station
  (absent: the next step; one naming no step ends the scene).
- **An option** is a choice's option or a quiz answer (its outcome's
  effects): both are all or nothing. Stations, items and scene steps are
  not options: one whose requirement fails is simply absent (passed over,
  for a step).
- **A quiz is shown and answered only as a whole**, whether it is typed
  (text, code, number: one input whose outcome is known only after
  submitting) or a choice of answers: open only when both outcomes could
  be paid, else greyed or hidden as a whole. Greying or hiding just the
  answers the visitor cannot pay for would leave the others standing and
  give the right one away; refusing just those answers would do the same.
  So the rules need no flag for how a quiz is answered: both kinds follow
  one rule.
- **Run state** `{ round, labels, counters }` - JSON-safe: `labels` sorted
  and unique, `counters` an id-to-integer record.

## Public API

- `startRun(game)` - round 1, no label held, every counter at `start`.
- `availability(game, state, { requires?, effects? })` -
  `{ available: true }` or `{ available: false, reason }`, the reason being
  (in this order of precedence) the first failing condition
  (`kind: "requires"`), the first effect the game cannot apply
  (`"invalid-effect"`), or the first counter whose floor the effects'
  RESULT would break (`"floor"`, with `need`, how much is missing). Use it
  for stations, items, steps and options alike.
- `optionDisplay(game, state, { requires?, effects? })` - how a scene
  choice's option shows: `{ shown: "available" }`; `{ shown: "greyed", needs }` when every
  label and counter blocking it is visible, `needs` listing each in order
  (`{ has }`, `{ lacks }`, or `{ counter, need }` - one entry per counter,
  the larger of its requirement's and its cost's shortfall); or
  `{ shown: "hidden" }` when any blocking label or counter is `secret`,
  when what blocks it cannot be read (an undeclared name, an effect the
  game cannot apply, a requirement that is no whole number), or when the
  requirement both has and lacks one label (no need would be enough). A
  secret that does not block the option hides nothing. Not for a quiz's
  answers: a quiz shows as a whole (`quizDisplay`).
- `quizDisplay(game, state, outcomes)` - how a quiz shows, as a whole: a
  typed quiz's single input and a choice quiz's answers alike, judged on
  both outcomes together: `available` only when both outcomes could be
  paid (whichever the answer turns out to be); else `hidden` when either
  outcome would be hidden, else `greyed` with both outcomes' needs merged
  (per counter the larger shortfall, so meeting the needs makes both
  payable). The view greys or hides every answer of the quiz together,
  never one answer alone.
- `chooseOption(game, state, option)` - all or nothing: `{ ok: true, state }`
  or `{ ok: false, reason }` with the state untouched.
- `answerQuiz(game, state, outcomes, correct)` - the same for a quiz
  answer: the outcome is applied all or nothing, and only while the quiz
  is open as a whole. While either outcome cannot be paid, every answer is
  refused (`{ ok: false, reason }`, the given outcome's reason first, else
  the other's) - the right one included, so a refusal never tells which
  answer is right - and nothing is ever clamped. A counter the outcome
  does not touch is left as it is.
- `stepAfter(steps, from, option?)` - where a scene continues after step
  `from`: the option's `goto` (the first step with that id, backwards
  too), else the next step; -1 (the scene ends) after the last step, for a
  `goto` naming no step, and for a `from` that is no step index. The one
  definition the check and its exhaustive test use too.
- `nextAvailableStep(game, state, steps, from)` - the first index at or
  after `from` whose requirements hold now, or -1 (the scene ends); a
  negative `from` (an ended scene, as `stepAfter` reports it) or NaN stays
  -1. Continue a scene with
  `nextAvailableStep(game, state, steps, stepAfter(steps, i, option))`.
- `inventory(game, state)` - every label in declaration order with `held`,
  `keep`, `secret` and `shown`: `"held"`; a collectible not held
  `"greyed"`, or `"hidden"` when secret; a round label not held always
  `"hidden"` (shown while held, never greyed). Every counter with its
  value, `secret` and `shown` (`"value"`, or `"hidden"` when secret).
- `startNextRound(game, state)` - round + 1; exactly the held collectible
  labels and the collectible counters' values kept; round counters at
  `start`; labels the game no longer declares dropped.

Exported types: `TourGame`, `TourGameStation`, `TourGameStep`,
`TourGameOption`, `TourGameCondition`, `TourGameEffect`,
`TourGameQuizOutcomes`, `TourGameRunState`, `TourGameAvailability`,
`TourGameDisplay`, `TourGameChoice`, `TourGameInventory`. The element
types (label, counter, item, block reason, need, inventory entries) are
not exported until a consumer
needs to name one (dead-code rule); `TourGame['labels'][number]` reaches
them meanwhile.

## Invariants and defensive measures

- **A typo hides, never reveals:** a condition naming an undeclared id, or
  an id of the other kind (`has` on a counter), never holds - `lacks`
  included.
- **The floor is judged on the result of the whole list**, and only for
  the counters the option changes, so a counter already below its floor in
  a malformed state does not block unrelated options.
- **No inherited properties:** ids are path-safe, which admits
  `__proto__`; counters are read with `Object.hasOwn` and records are
  built with `Object.fromEntries` (own properties, no setter).
- A counter missing from a state reads as its `start` (a state saved
  before the counter existed).
- Nothing is cached: every answer is judged at the moment of the call.
- **Parsed input expected:** the game's `labels`, `counters` and
  `stations` arrays (and each station's `steps`) must be present; the
  tour parser guarantees that, and a missing array throws.

## Example

```ts
const game: TourGame = {
  labels: [{ id: 'sword', name: 'Sword', keep: 'round' }],
  counters: [{ id: 'coins', name: 'Coins', keep: 'round', start: 2, floor: 0 }],
  stations: [],
};
const buy = {
  id: 'buy',
  requires: [{ lacks: 'sword' }],
  effects: [{ set: 'sword' }, { add: 'coins', by: -2 }],
};
const r = chooseOption(game, startRun(game), buy); // ok, coins 0, sword held
availability(game, r.ok ? r.state : startRun(game), buy);
// { available: false, reason: { kind: 'requires', condition: { lacks: 'sword' } } }
optionDisplay(game, { round: 1, labels: [], counters: { coins: 1 } }, buy);
// { shown: 'greyed', needs: [{ counter: 'coins', need: 1 }] }
```

## Tests

- `tour-game-rules.test.ts` - each rule by its smallest example.
- `tour-game-rules.property.test.ts` - under random games (with undeclared
  names, zero and fractional adds, secret labels and counters) and random
  sequences of choices, quiz answers and rounds: no floor ever broken,
  counters stay integers, labels sorted and unique; choosing or answering
  never mutates its input; a new round keeps exactly the collectibles; the
  inventory lists every label once, shown exactly by held, keep and
  secret; a greyed option's needs are enough together and each one
  necessary, never name a secret, and an option is hidden only for a
  secret or something unreadable. Deliberate defects each caught
  (2026-10-22): a secret label ignored by the display, the smaller of two
  counter shortfalls kept, a quiz answer applied without its floor, a
  round label greyed. A quiz is offered exactly when both outcomes are
  accepted, its right and wrong answers are accepted or refused together
  (guarded: states where only one outcome is payable on its own occur),
  and its greyed needs are enough together and each necessary for both (a
  defect that never greys the quiz was caught, 5 of 5 seeds; a defect
  accepting the right answer while the wrong one cannot be paid is caught
  by the unit test and this property); the quiz is hidden exactly when
  either outcome would be (a defect hiding it only when both are was
  caught, 3 of 3 runs).
- `tour-game-scenarios.test.ts` - four tours walked end to end: a path
  choice, a key behind a quiz, a merchant with a coin floor, a collectible
  set over two rounds with gated scene steps.
