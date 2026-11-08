# `kinds/audio/narration-card.ts` - a narration's player card

## Purpose

The screen part of a narration circle (`spot.ts`): a small panel, open while
the visitor stands inside the circle, with the narration's title, play or
pause, a scrub bar with the time, and the sentence of the transcript being
spoken. Its structure follows the card of the narration prototype
(`public/prototypes/audio-narration-spot-1/`); its look is deliberately plain
and lives behind this one function (plus the `#narration-card-root` rules in
`index.html`) until a look is chosen.

## Public API

- `NarrationControls` - what the card asks of its narration: `toggle()` (the
  circle's tap rule), `seek(ms)`, `timeMs()`, `durationMs()` (0 while not
  known), `playing()`.
- `transcriptSentences(text)` - the sentences, split after `.`, `!` or `?`
  followed by white space; blank or `undefined` gives none.
- `sentenceAt(sentences, timeMs, durationMs)` - the index of the sentence
  spoken at `timeMs`, by each sentence's share of the characters (the format
  keeps no timings, so an even pace is assumed); 0 before the start or while
  the length is unknown, the last past the end, -1 for no sentences.
- `narrationCard(host, { title?, transcript? }, controls)` -> `{ render,
dispose }`: builds the card into `host`; `render()` brings it up to the
  controls (called every frame by the part, and after each of the card's own
  actions); `dispose()` removes it.

## Invariants & assumptions

- DOM: `section.narration-card[data-testid=narration-card]` with
  `aria-label="Narration: <title>"` (title default "Narration"); a head with
  the kicker and an `aria-live="polite"` state; an `h2` title; a row with the
  play button (text and `aria-label` "Play", "Pause" or "Play again"), the
  range input (whole seconds, `aria-valuetext` "m:ss of m:ss") and the time
  "m:ss / m:ss"; a sentence line, hidden without a transcript.
- States: "Playing"; "Heard. Play again?" at or past the end; "Paused" part
  way; "Tap play to listen" at 0.
- The scrub seeks on `change` (let go), not on every `input`; while dragged,
  `render` leaves the thumb where the finger is.
- `render` writes only what changed, so it is cheap to call per frame.
- The scrub is disabled while the length is unknown.

## Examples

```ts
const card = narrationCard(host, block, controls);
card.render(); // each frame
card.dispose(); // on leaving the circle
```

## Tests

`narration-card.test.ts`: the sentence split, `sentenceAt`'s share rule and
a property (always a sentence, never backwards), the title, time, state and
line, the button's play and pause shown at once, "Play again", the scrub's
seek, and the card without transcript or length. `spot-card.test.ts` drives
it through a circle.
