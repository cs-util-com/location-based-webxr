# then-now-slider.ts

## Purpose

The panel a visitor lined up with a then-and-now picture gets on the page's
screen: the year, the caption's first sentence and a slider from today to
then (the old picture's share).

## Public API

- `buildThenNowSlider(host, { year?, caption? }, fade, changed)` returns
  `{ set, dispose }`.
  - A `role=group` named "Then and now" holding a range input (0 to 100,
    named "Between today and then", its value text the share in percent).
  - `changed(share)` hears the visitor's moves (0 to 1).
  - `set(share)` moves the thumb from the part (the fade-in); skipped while
    the input has focus, so the thumb never moves under a finger.
  - `dispose()` removes the panel and its listener (the screen's clean-up).
- `firstSentence(text)`: the first sentence, cut at a word to 110 characters.

## Invariants

- A share outside 0 to 1 is clamped; one that is not a number shows 0.
- Styling is the page's (`index.html`, `.then-now-slider`).

## Tests

`then-now-slider.test.ts` (jsdom).
