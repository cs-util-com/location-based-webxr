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
  (survives a new round) or `"round"` (forgotten by it); `secret` labels
  are hidden in the inventory until held.
- **Counter** `{ id, name, keep, start, floor }` - an integer that never
  goes below `floor`.
- Labels and counters share one id namespace (the check reports a clash).
- **Condition** (a state): `{ has }`, `{ lacks }`, `{ counter, atLeast }`.
  A list holds when ALL hold; empty or absent always holds.
- **Effect** (an event): `{ set }`, `{ clear }` (both idempotent),
  `{ add, by }` (`by` a non-zero integer). A list applies in order; a later
  set or clear of the same label wins.
- **Where they sit:** `requires` on a station, an item, a step and a choice
  option; `effects` on a choice option; `outcomes: { correct?, wrong? }` on
  a quiz step. A choice option's `goto` names a step of the same station
  (absent: the next step).
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
- `chooseOption(game, state, option)` - all or nothing: `{ ok: true, state }`
  or `{ ok: false, reason }` with the state untouched.
- `answerQuiz(game, state, outcomes, correct)` - a forced outcome: each
  counter clamps at its floor, an effect the game cannot apply is skipped.
- `nextAvailableStep(game, state, steps, from)` - the first index at or
  after `from` whose requirements hold now, or -1 (the scene ends); a
  `from` below 0 starts at 0, NaN gives -1.
- `inventory(game, state)` - every label in declaration order with `held`,
  `keep`, `secret` and `shown` (`"held"`, `"greyed"`, or `"hidden"` when
  not held and secret), and every counter with its value.
- `startNextRound(game, state)` - round + 1; exactly the held collectible
  labels and the collectible counters' values kept; round counters at
  `start`; labels the game no longer declares dropped.

Exported types: `TourGame`, `TourGameStation`, `TourGameStep`,
`TourGameOption`, `TourGameCondition`, `TourGameEffect`,
`TourGameQuizOutcomes`, `TourGameRunState`, `TourGameAvailability`,
`TourGameChoice`, `TourGameInventory`. The element types (label, counter,
item, block reason, inventory entries) are not exported until a consumer
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
```

## Tests

- `tour-game-rules.test.ts` - each rule by its smallest example.
- `tour-game-rules.property.test.ts` - under random games (with undeclared
  names, zero and fractional adds) and random sequences of choices, quiz
  outcomes and rounds: no floor ever broken, counters stay integers,
  labels sorted and unique; a refused option changes nothing; a new round
  keeps exactly the collectibles; the inventory lists every label once,
  shown exactly by held and secret.
- `tour-game-scenarios.test.ts` - four tours walked end to end: a path
  choice, a key behind a quiz, a merchant with a coin floor, a collectible
  set over two rounds with gated scene steps.
