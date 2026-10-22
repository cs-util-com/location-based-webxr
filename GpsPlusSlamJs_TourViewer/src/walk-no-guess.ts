/**
 * R-2's hold (visitor walk W4 build plan 2026-10-21-1105, M4, §1.9 R-2):
 * while the guide shows no distance an any-order tour guesses no station;
 * the guess goes on the first tick without a distance and comes back only
 * once the distance has been back for `WALK_NO_GUESS_HOLD_MS` without a
 * break. Pure: the guide keeps the clock (the time the distance came
 * back is its own bookkeeping) and dispatches `noGuess` to the store only
 * when it changes.
 *
 * @see walk-no-guess.ts.md
 */

/**
 * How long the distance must be back, unbroken, before a station is
 * guessed again: 3 s (the plan's default, kept by the stream sweep in
 * `walk-no-guess.sweep.test.ts` over 1, 3, 5 and 10 s). At 1 s a fix
 * flickering around the 25 m ceiling flips the focus about twice as often
 * as at 3 s (5.2 against 2.5 changes a minute); 5 and 10 s flip less (1.9,
 * 1.1) but leave a code session that drops its pose for under a second
 * now and then without a guess 17 % and 32 % of the time (3 s: 11 %).
 * Reversed by a field test showing the focus flip at 3 s, or visitors
 * waiting on it.
 */
export const WALK_NO_GUESS_HOLD_MS = 3_000;

export interface NoGuessClock {
  /** No station is guessed (R-2's store field). */
  readonly noGuess: boolean;
  /** When the distance came back while no guess was made; null otherwise. */
  readonly backAtMs: number | null;
}

/** No guess withheld before the first tick: the first tick without a
 *  distance enters at once. */
export const NO_GUESS_START: NoGuessClock = { noGuess: false, backAtMs: null };

/**
 * The clock after one tick: `distanceShown` is whether the guide shows a
 * distance now (a code's or GPS within the ceiling). Without one it enters
 * (or stays) at once; with one it leaves after `holdMs` of unbroken
 * distance. The same object when nothing changed; a clock that is no
 * number changes nothing.
 */
export function noGuessStep(
  clock: NoGuessClock,
  distanceShown: boolean,
  nowMs: number,
  holdMs: number = WALK_NO_GUESS_HOLD_MS,
): NoGuessClock {
  if (!Number.isFinite(nowMs)) return clock;
  if (!distanceShown) {
    return clock.noGuess && clock.backAtMs === null
      ? clock
      : { noGuess: true, backAtMs: null };
  }
  if (!clock.noGuess) return clock;
  if (clock.backAtMs === null) return { noGuess: true, backAtMs: nowMs };
  return nowMs - clock.backAtMs >= holdMs
    ? { noGuess: false, backAtMs: null }
    : clock;
}
