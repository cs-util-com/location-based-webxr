# landing/card-play.ts

## Purpose

The landing's step cards: which picture moves, and when. A state machine
with no DOM (unit-tested in node); `landing-cards.ts` feeds it how much of
each picture is in view and the reader's taps, and renders what it says. The page's cards are described in `index.html.md`, "The landing".

## Public API

- `createCardPlay(options): CardPlay`
  - `options.durationsMs` - each card's sequence length in ms, one per card
    (the card count). Throws for an empty list or a value that is not a
    positive finite number.
  - `options.reducedMotion` - nothing starts by itself; "Show again" plays
    once.
  - `options.timer` - `{ now(), set(fn, ms), clear(id) }`: the browser's
    clock and `setTimeout` in production, `test-support/manual-timer.ts` in
    the tests.
  - `options.render(index, state)` - called with a card's new state, only
    when it changed (an idle page calls nothing and schedules nothing).
  - `options.startShare`, `options.settleMs`, `options.holdMs` - overrides of
    the constants below (the sweep's seam; the page uses the defaults).
- `CardPlay`
  - `seen(index, share)` - how much of picture `index` is in view, 0 to 1,
    of as much of it as can be (the caller divides the intersection ratio
    by `min(1, viewport height / picture height)`). Non-finite reads as 0.
  - `tap(index)` - the picture's pause button: pause, or resume.
  - `showAgain(index)` - restart now, clearing the pause, no settle delay.
  - `setBlocked(blocked)` - the film above plays: no card moves by itself,
    and the one moving stops at its last frame.
  - `state(index)` - `{ phase: "still" | "playing" | "holding", paused,
run }`; `run` counts the starts, so a renderer restarts the sequence on
    a new run.
  - `destroy()` - cancels every timer; later calls do nothing.
- Constants: `START_SHARE` 0.9, `SETTLE_MS` 300, `HOLD_MS` 2000.

## Invariants & assumptions

- At most one card moves (`phase !== "still"` and not paused).
- Only the card most in view with at least `START_SHARE` moves; on a tie
  (within 0.001) the card already moving keeps its place, so two pictures
  fully in view do not take turns.
- A card starts only after it has stayed the one to move for `SETTLE_MS`: a
  fast scroll starts nothing.
- It loops: `playing` for its duration, `holding` (its last frame) for
  `HOLD_MS`, then `playing` again with `run + 1`, until it leaves the view,
  another card is more in view, the film plays, or it is tapped.
- A pause freezes the card in its phase (the renderer pauses its CSS
  animations) and holds until the next tap or "Show again", across any
  scroll. While the card most in view is paused, nothing moves. A resume
  goes on from the frozen moment when the card is still the one to move,
  else it shows its last frame.
- "Show again" moves its card even while the film plays or under reduced
  motion (the reader asked); when its run ends the card keeps looping only
  if it is the one to move, else it returns to its last frame.
- Indices outside the cards are ignored.

## Parameters and the sweep

The constants rest on a sweep at 390x844 and 844x390 in the real page
(start share 0.6, 0.75, 0.9 and 1.0; settle 150, 300, 600 ms; hold 1.5, 2,
3 s). Results and the value that would reverse each choice: see the
landing's notes in `index.html.md` ("The landing").

## Examples

```ts
const play = createCardPlay({
  durationsMs: [2000, 2600, 3300, 2600, 2600],
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  timer: {
    now: () => performance.now(),
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: (id) => window.clearTimeout(id),
  },
  render: (i, state) => drawCard(i, state),
});
play.seen(2, 0.95);
```

## Tests

- `card-play.test.ts` - each rule alone: the settle delay, the start share,
  the loop, leaving the view, the most-in-view rule and its tie, pause and
  resume from the same moment, a pause across a scroll, a paused leader,
  "Show again", reduced motion, the film, renders only on change, destroy,
  bad input.
- `card-play.property.test.ts` - any interleaving: one moving card at most,
  the pause follows the taps, nothing moves by itself over the film or under
  reduced motion, a card moving by itself is enough in view, and only real
  changes are rendered.
