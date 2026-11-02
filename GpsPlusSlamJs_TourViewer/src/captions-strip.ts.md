# captions-strip.ts

## Purpose

The captions view of a narrated text: a strip at the bottom of the AR view with one chunk of the words being spoken, the spoken word marked and the words still to come dimmer, play, back 10 s, the title and the voice's clock and credit, "Full text" and a progress bar. Built from the narrated-text prototype's `#caption` (`public/prototypes/station-blocks-1-narrated-text/`); styles in `captions-strip.css`.

## Public API

- `captionLayout(win)` - `portrait` (aspect under 0.85), `landscape` (under 520 px high), else `desktop`, by the strip's own media queries; `portrait` without `matchMedia`.
- `CaptionsContent` - `{ key, title, plain, sentences, timing, player, synthetic, voiceCredit? }`: a text whose read-along fits.
- `createCaptionsStrip({ host, openFullText, layout? })` returns `{ show(content), hide(), tick(), state(), dispose() }`.
  - `show` with the same key keeps the place; a new key or timing starts afresh.
  - `hide` hides and makes the strip inert; the voice plays on (the page pauses it).
  - `tick` follows the voice; it redraws only what changed, so it may run every frame.
  - `state()` - `{ shown, key, chunk, word, layout }`.
- `captionCredit(narration)` - "Synthetic voice · credit" as one string (what the strip compares to redraw its credit; the line itself is drawn by the sheet's `fillCredit`, "Synthetic voice" in italics as in the prototype).
- `offsetBySharedTime(segment, ms)` - on a track that marks no words, where the voice is by the share of the segment's time spent.

## Invariants

- On a word track the marked word is the one holding the segment's start; on a sentence or marked track the chunk moves by time share and no word is marked.
- Chunks are re-cut when the layout changes (a phone turned).
- The strip never shows for a stale or missing timing: its caller (`captions-follow.ts`) only gives it live content.

## Tests

- `captions-strip.test.ts` - show and hide, the word mark and the dimmed words, the sentence-track fallback, play, back 10 s, Full text, the layout change, a tap anywhere on the strip kept from being an AR select (`cancelsXrSelect`).
- `playwright-tests/narration-check.spec.js` - where the strip lands at three viewports against the prototype's numbers, and the word mark in a browser.
