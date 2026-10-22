# walk-no-guess.ts

## Purpose

R-2's hold (visitor walk W4 build plan M4, §1.9 R-2): while the guide
shows no distance (pending, GPS too weak, `'none'`), an any-order tour
with two or more stations to find guesses no station; the guess goes on
the first tick without a distance and comes back only once the distance
has been back, unbroken, for `WALK_NO_GUESS_HOLD_MS`. Without the hold a
fix flickering around the 25 m ceiling would flip "nearest: <title>",
the trail and the HUD's focus with every reading.

## Public API

- `WALK_NO_GUESS_HOLD_MS = 3_000` - the shipped hold.
- `interface NoGuessClock { noGuess: boolean; backAtMs: number | null }`
  - `noGuess`: no station is guessed (the store's `visitorWalk.noGuess`);
  - `backAtMs`: when the distance came back while no guess was made.
- `NO_GUESS_START` - `{ noGuess: false, backAtMs: null }`: the first tick
  without a distance enters at once.
- `noGuessStep(clock, distanceShown, nowMs, holdMs?) => NoGuessClock`
  - without a distance: `{ noGuess: true, backAtMs: null }`;
  - with one: leaves after `holdMs` of unbroken distance, else keeps
    counting from the first tick it came back;
  - returns the same object when nothing changed (the guide dispatches
    only on a change); a non-finite `nowMs` changes nothing.

## Invariants & assumptions

- Pure, no clock of its own: the guide (`station-guide.ts`) keeps the
  `backAtMs` side as its own bookkeeping (`noGuessBackAtMs`, reset with a
  new walk and at the session's end) and writes `noGuess` to the store
  through `noGuessSet`, inside the guide call's one batch.
- Whether the condition applies (any order, two or more unfound offered,
  no chosen target) is the slice's `walkNoGuess`, not this module's: the
  clock runs for every tour, so a tour whose order or offer changes reads
  a clock that is already right.
- A flapping input over T ms makes at most `2 * floor(T / hold) + 1`
  transitions (the property test).

## The sweep (shipped 3 s)

`walk-no-guess.sweep.test.ts` replays two recorded-style streams, 8 seeds
each, over holds of 1, 3, 5 and 10 s. Results (focus changes a minute /
share of time without a guess / time to a guess once the distance is
stable):

- a GPS fix flickering around the 25 m ceiling:
  - 1 s: 5.24 / 51.1 % / 1.0 s
  - 3 s: 2.50 / 58.4 % / 3.0 s
  - 5 s: 1.94 / 62.3 % / 5.0 s
  - 10 s: 1.08 / 68.5 % / 10.0 s
- a code session losing its pose for under a second now and then:
  - 3.60 focus changes a minute at every hold;
  - without a guess 4.7 % / 10.7 % / 16.7 % / 31.7 %.

3 s halves the flicker of 1 s; 5 and 10 s buy less flicker with a guess
missing a sixth to a third of a code session. What would reverse it: a
field test showing the focus still flipping at 3 s (towards 5 s), or
visitors waiting on "waiting for a steady position…" (towards 1-2 s).
Set `WALK_NO_GUESS_SWEEP_OUT=<file>` to write the table again.

## Examples

```ts
let clock = NO_GUESS_START;
clock = noGuessStep(clock, false, 0); // { noGuess: true, backAtMs: null }
clock = noGuessStep(clock, true, 1_000); // { noGuess: true, backAtMs: 1000 }
clock = noGuessStep(clock, true, 4_000); // { noGuess: false, backAtMs: null }
```

## Tests

- `walk-no-guess.test.ts` - entry at once, the hold, a break restarting
  it, the same object on no change, a non-finite clock; the property on
  the number of transitions.
- `walk-no-guess.sweep.test.ts` - the sweep above.
- `station-guide.rules.test.ts` - the hold as the guide applies it.
