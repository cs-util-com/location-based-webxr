# narration-words-paint.ts

## Purpose

Paints a narrated text's words into a 2D canvas: the one visible box of
the travel mode, shown on the words plate under the reading sign (and, in
a later step, in flight and at the dock). The narration box
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
- `wordsCanvasSize(layout, scale)` - the canvas size in device px
  (rounded up).
- `wordsPaintKey(layout, frame)` - a string that changes exactly when the
  painted image would: the lit word, any said word's fade step, the
  scroll to half a px, a scrub and the hint.
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
  disclosure styles, the fade in eight steps and the scrub, the scrollbar
  only with more lines than rows, the hint in the head row, and the key
  (stable while paused, changed by each visible change).
- `playwright-tests/travelling-box-check.spec.js` - the painted ink lies
  inside the ghost box's word rectangles in a real browser.
