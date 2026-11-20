# narration-words-paint.ts

## Purpose

Paints a narrated text's words into a 2D canvas: the one visible box of
the travel mode, shown on the words plate under the reading sign, in flight and at the
dock (one texture, `travelling-box.ts`). The narration box
(`narration-box.ts`) lays the words out in its invisible ghost and hands
the measured layout over; this module draws it. The look is the
travelling box prototype's (`public/prototypes/sign-speaks-r6-2-travelling-box/`)
with the HUD box's numbers (`narration-box.css`).

## Public API

- `WordsPaintLayout` - what the box measured once per text, in its CSS
  px: `width`, `height`, `radius`, the text window `win` (rows plus the
  scrollbar slot), the head row `head` (or null), `fontPx` (one em, the
  plate's 0.136 m), `lineHeight`, `rows`, `lines`, the four `fonts`
  (word, who, disc, hint), `whoColor`, `grey` (alpha of an unsaid word
  and of the disclosure), `tint` (the glass's alpha), the `runs` (the
  name, disclosure parts and words, each with its x in the column, its
  line and its word index) and each word's start `startsMs`.
- `WordsPaintFrame` - what changes per frame: `voiceMs`, `lit`, `scroll`
  (lines), `scrubbing`, `hint`.
- `wordsPaintScale(devicePixelRatio)` - the paint scale, 2.5 to 3 device
  px a CSS px (2.5 for a ratio that is not a number): sharp when the sign
  grows 1.6 times and on a 3x phone, never more texture than a weak GPU
  should upload on a 4x screen.
- `wordsCanvasSize(layout, scale)` - the canvas size in device px
  (rounded up).
- `wordsPaintKey(layout, frame)` - a string that changes exactly when the
  painted image would: the lit word, the fade steps of the fading tail
  (back from the lit word to the first one whose fade has ended), the
  scroll to half a px, a scrub and the hint. Its length is bounded by the
  fade, not by the text.
- `paintNarrationWords(g, { layout, frame }, scale)` - clears and paints:
  the glass (a vertical gradient `rgba(52,58,80,tint)` to
  `rgba(20,24,36,tint)` in a rounded rect, a 1 px white 0.26 edge), the
  runs clipped to the window at their lines less the scroll, the
  scrollbar when there are more lines than rows (track 0.1, thumb 0.5, or
  0.9 while scrubbing, from `narration-box-timeline.ts` `thumbGeometry`),
  and the hint right-aligned in the head row at 0.7 white.

## Invariants & assumptions

- The painter knows nothing of the DOM: the browser's line breaks come in
  through the runs, so the plate and the ghost box (which the visitor
  taps and a screen reader reads) break the same way.
- The fade is the box's CSS: a said word goes from `grey` to white in
  550 ms after a 120 ms delay, in 120 ms while scrubbing; it is painted
  in 8 steps, so a fade costs 8 paints. A paused voice whose fades have
  ended keeps its key: no paints, no texture uploads.
- The words start in order (`startsMs` non-decreasing, as the box hands
  them over), so the fade steps fall from the first said word to the
  lit one; the key's tail relies on it.
- Every run of a line sits on one alphabetic baseline, as in the box:
  (ascent - descent) / 2 of the word font under the line's middle (the
  font's metrics from `measureText`, else 0.35 em), so the smaller
  disclosure shares the words' baseline.
- Deviation from the prototype, kept: the fade runs on the voice's clock
  (`voiceMs`), not the wall clock. A paused voice freezes a fade half
  way, and a scrub fades a word in 120 ms of scrubbed time; the
  prototype's fade ran on in wall time over a pause. The voice's clock
  keeps the paint a pure function of the frame, which is what lets the
  key skip paints.
- Only rows inside the window are drawn; all text is drawn inside the
  window's clip.
- The canvas must have `wordsCanvasSize` for the same scale; the painter
  sets its own transform.

## Example

```ts
const model = box.paintModel(); // null when hidden or not in travel mode
if (model !== null) {
  const key = wordsPaintKey(model.layout, model.frame);
  if (key !== lastKey || model.layout !== lastLayout) {
    paintNarrationWords(g, model, 2.5);
    texture.needsUpdate = true;
  }
}
```

## Tests

- `narration-words-paint.test.ts` (a recording 2D context): the scale and
  each word at its x and line, the scroll and the clip, the name and
  disclosure styles, the shared baseline (with and without font
  metrics), the fade in eight steps and the scrub, the scrollbar only
  with more lines than rows, the hint in the head row, the key (stable
  while paused, changed by each visible change, short on a 400-word
  text) and the paint scale.
- `playwright-tests/travelling-box-check.spec.js` - the painted ink lies
  inside the ghost box's word rectangles in a real browser.
