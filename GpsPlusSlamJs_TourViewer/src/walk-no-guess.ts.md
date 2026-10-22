# walk-no-guess.ts

## Purpose

R-2's hold (visitor walk W4 build plan M4, §1.9 R-2): while the guide
shows no distance (pending, GPS too weak, `'none'`), an any-order tour
with two or more stations to find guesses no station; the guess goes on
the first tick without a distance and comes back only once the distance
has been back, unbroken, for `WALK_NO_GUESS_HOLD_MS` - or at once when
it comes back as a code's. Without the hold a
fix flickering around the 25 m ceiling would flip "nearest: <title>",
the trail and the HUD's focus with every reading.

So the hold applies to a GPS distance only. When a code holds the
position and its camera pose drops for a moment, the guess goes for the
drop and comes back on the tick the code's distance returns, with no
hold. Before 2026-10-22 a code's return waited out the full hold like a
fix's; the second sweep below is why that changed. The rules property
(`station-guide.rules.property.test.ts`) draws a code's return among its
precisions and mirrors the skip in its own clock.

## Public API

- `WALK_NO_GUESS_HOLD_MS = 3_000` - the shipped hold.
- `interface NoGuessClock { noGuess: boolean; backAtMs: number | null }`
  - `noGuess`: no station is guessed (the store's `visitorWalk.noGuess`);
  - `backAtMs`: when the distance came back while no guess was made.
- `NO_GUESS_START` - `{ noGuess: false, backAtMs: null }`: the first tick
  without a distance enters at once.
- `noGuessStep(clock, distanceShown, nowMs, holdMs?, byCode?) => NoGuessClock`
  - without a distance: `{ noGuess: true, backAtMs: null }` (`byCode`
    changes nothing then);
  - with one: leaves after `holdMs` of unbroken distance, else keeps
    counting from the first tick it came back;
  - with one that is a code's (`byCode`, the guide passes
    `precisionKind === "code"`): leaves at once, a hold already running
    included;
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
  transitions (the property test) - for a GPS return. A code's return
  is not bounded so: each pose drop is one enter and one leave.

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
- a code session losing its pose for under a second now and then, were
  its return to keep the hold:
  - 3.60 focus changes a minute at every hold;
  - without a guess 4.7 % / 10.7 % / 16.7 % / 31.7 %.

3 s halves the flicker of 1 s; 5 and 10 s buy less flicker with a guess
missing a sixth to a third of a code session - which is why a code's
return skips the hold (below). What would reverse it: a
field test showing the focus still flipping at 3 s (towards 5 s), or
visitors waiting on "waiting for a steady position…" (towards 1-2 s).
Set `WALK_NO_GUESS_SWEEP_OUT=<file>` to write the table again.

## A code's return, and an entry grace, swept

The hold did nothing against a code session's sub-second pose drops: it
only withheld the guess for a hold after each. The second sweep in
`walk-no-guess.sweep.test.ts` (same streams, 8 seeds) crosses an entry
grace (a distance gone for less than G still counts as shown: 0, 0.5, 1,
2 s) with a code's return skipping the hold or keeping it, measuring the
focus changes a minute, the share without a guess, and the share of time
a station is named while no distance is shown (against the rule above):

- code pose drops:
  - grace 0, code holds (before): 3.60 / 10.7 % / 0 %
  - grace 0, code skips (shipped): 3.60 / 1.6 % / 0 %
  - grace 0.5 s, code skips: 2.06 / 0.4 % / 1.3 %
  - grace 1 s or 2 s, either: 0.00 / 0 % / 1.6 %
- the flickering GPS fix (one fix a second; a code's skip does not apply):
  - grace 0 to 1 s: 2.50 / 58.4 % / 0 % (a grace under the fix interval
    does nothing);
  - grace 2 s: 2.25 / 45.4 % / 4.9 %.

Shipped: grace 0, a code's return skips the hold. A code session is
then without a guess only for its drops, and no station is ever named
without a distance. What would reverse it: a field test showing the
sub-second blink of a code session's drops (the guess going and coming
back, 3.6 times a minute in this stream) bothering visitors. A grace of
at least the longest drop (1 s here; 0.9 s drops in the stream) removes
it, at the price of naming the station during the drop; scoped to a
code's distance it would not touch GPS. Set
`WALK_NO_GUESS_REMEDY_OUT=<file>` to write the table again.

## Examples

```ts
let clock = NO_GUESS_START;
clock = noGuessStep(clock, false, 0); // { noGuess: true, backAtMs: null }
clock = noGuessStep(clock, true, 1_000); // { noGuess: true, backAtMs: 1000 }
clock = noGuessStep(clock, true, 4_000); // { noGuess: false, backAtMs: null }
clock = noGuessStep(clock, false, 5_000); // { noGuess: true, backAtMs: null }
clock = noGuessStep(clock, true, 5_400, WALK_NO_GUESS_HOLD_MS, true); // a code: back at once
```

## Tests

- `walk-no-guess.test.ts` - entry at once, the hold, a break restarting
  it, a code's return leaving at once, the same object on no change, a
  non-finite clock; the property on the number of transitions.
- `walk-no-guess.sweep.test.ts` - both sweeps above.
- `station-guide.rules.test.ts` - the hold as the guide applies it, and
  a code's distance naming the station again at once after a drop.
