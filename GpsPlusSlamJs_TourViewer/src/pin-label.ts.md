# pin-label.ts

## Purpose

A pin's label where a page draws a pin without the world door: the
framework's text sprite on a pill. A station's pin in the phone's AR and
the desktop editor's 3D view is the world door's head on a stem
(`kinds/short-text/pin.ts`); this label stays for what has no door: an
object's renderer (`renderTourObjects`) on a page that passes it no
door, through `seams.ts`. The creator's AR previews pass the door, so
their pins are the head on a stem too. The editor's drawings still
hand it to the station renderer as its required label maker, but a pin
there goes through the door.

## Public API

- `createPinLabel(text)` -> `{ object, dispose() }`: the label's sprite
  (an `Object3D`) and the call that frees its canvas texture and material.
- `pinLabelLayout(text, measure)` -> `{ canvasWidth, canvasHeight,
fontPx, font, scale }`: the pure layout behind it, text widths from a
  `Measure` (`kinds/short-text/plate.ts`; the real canvas in a browser).
- `PIN_LABEL`: its measures (below).

## Invariants & assumptions

- The canvas is 256 px tall and as wide as the text at a bold 56 px
  plus 40 px clear room each side (the pill's 10 px inset and its rounded
  end), at least 512 px. The sprite is 0.3 m tall and keeps the canvas
  aspect, so a longer caption is a longer pill, never a cut one.
- A text wider than the 1536 px cap at 56 px is drawn smaller, down to
  32 px, so every caption up to the format's 40 characters fits within
  the cap; a text still wider (longer than the format allows) widens the
  canvas past the cap rather than clip.
- Measured thresholds (a bold sans stand-in, `pin-label.test.ts`): 40
  lowercase letters fit at the full 56 px; 40 capital W shrink to 38 px.
  A cap of 1280 px would push 40 W below the 32 px floor, which is why
  the cap is 1536.
- The fixed 512 px canvas this replaced cut "This way to the guild
  house" to "way to the guild ho" (the text is drawn centred).
- Transparent with no depth write: the pill's surround must not paint a
  black square over the camera image.
- Browser only for the picture (a canvas); the layout runs anywhere.

## Examples

```ts
const label = createPinLabel("Look up");
group.add(label.object);
// later
label.dispose();
```

## Tests

- `pin-label.test.ts`: every caption length 1..40 in wide letters, narrow
  letters, a sentence and one long word fits the width its text is drawn
  in; the full letter size and height hold where the text fits; a one
  letter pin keeps the 512 px pill; a text past the limit still fits.
- The phone's AR e2e walks run the real sprite (`playwright-tests/ar-fakes.js`
  keeps the real `createLabel` seam: Chromium has the canvas), and
  `playwright-tests/editor3d.spec.js` opens the 3D view; the stations
  layer's unit tests (`editor3d/editor3d-stations.test.ts`) hand in a
  stand-in.
