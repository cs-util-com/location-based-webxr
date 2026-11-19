# then-now-slider.ts

## Purpose

The panel a visitor lined up with a then-and-now picture gets on the page's
screen: the year, the caption's first sentence, a switch between two ways
to compare, and the chosen one's control. Fade is a slider from today to
then (the old picture's share); Swipe is a line across the whole screen
with a knob, the old picture left of it and today right of it, as the
chosen prototype `public/prototypes/station-blocks-3-pictures/` has it.

## Public API

- `buildThenNowSlider(host, { year?, caption? }, start, heard)` returns
  `{ set, dispose }`.
  - `start`: `{ mode, fade, split }` (`ThenNowSliderStart`), where the
    panel opens; `mode` is `"swipe"` or `"fade"` (`ThenNowMode`).
  - `heard`: `{ fade(share), mode(mode), split(split) }`
    (`ThenNowSliderListeners`), the visitor's moves.
  - A `role=group` named "Then and now" holding the words, a group named
    "Compare by" with the buttons Swipe and Fade (`aria-pressed`), the
    range row (0 to 100, named "Between today and then", its value text
    the share in percent; hidden in Swipe) and the hint "Drag the line to
    compare" (shown in Swipe only).
  - Before the panel, `.then-now-swipe`: a fixed layer over the whole
    screen, hidden unless Swipe is chosen, holding the line with its two
    labels (the year, or "Then", and "Today") and the knob.
  - The knob is `role=slider` named "Line between then and today" (4 to
    96, its value text "N % then"), focusable. A press takes pointer
    capture, so the line follows the finger past the knob until it is
    lifted (up, cancel or a lost capture); only the pressing pointer
    moves it; the press is kept from the page below (`preventDefault`,
    `stopPropagation`). The arrow keys move it by 5 %, Home and End to
    its ends.
  - `set(share)` moves the fade thumb from the part (the fade-in);
    skipped while the input has focus, so the thumb never moves under a
    finger.
  - `dispose()` removes the panel, the line layer and their listeners
    (the screen's clean-up).
- `firstSentence(text)`: the first sentence, cut at a word to 110 characters.

## Invariants

- A fade share outside 0 to 1 is clamped; one that is not a number shows 0.
- The line's place is a share of the layer's width, clamped to 0.04 to
  0.96 so its knob stays reachable (`then-now-swipe.ts`).
- Only the knob takes a touch: the layer is `pointer-events: none`, so the
  world keeps every other gesture, and the knob is in `pin-sheet.ts`'s
  overlay list, so a press on it in AR is not also a select in the world.
  It is 48 px, a thumb's target, with `touch-action: none`.
- Styling is `then-now-slider.css`, imported here, so every page that
  shows the panel has its look; the screen host's own rule (dropping its
  centring transform while it holds the slider, or the fixed line layer
  would be held to the host's box) is the page's (`index.html`).

## Tests

`then-now-slider.test.ts` (jsdom; pointer capture stubbed, as jsdom has
none); the drag in a real browser: `playwright-tests/then-now-check.spec.js`.
