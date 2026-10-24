# pin-label.ts

## Purpose

A pin's label as every view of a tour draws it: the framework's text
sprite on a pill. One recipe for the phone's AR (through `seams.ts`) and
the desktop editor's 3D view (`editor3d/editor3d-scene.ts`), so a pin
reads the same in both.

## Public API

- `createPinLabel(text)` -> `{ object, dispose() }`: the label's sprite
  (an `Object3D`) and the call that frees its canvas texture and material.

## Invariants & assumptions

- A 512 x 256 canvas with a bold 56 px font, the sprite scaled 0.6 x 0.3
  m (the 2:1 aspect of the canvas, the wayfinding HUD's recipe). The text
  sprite's defaults (a 64 px square, a 48 px glyph) are for single
  characters and clipped every word.
- Transparent with no depth write: the pill's surround must not paint a
  black square over the camera image.
- Browser only (a canvas); the text is drawn as given (the framework's
  text sprite owns any clipping).

## Examples

```ts
const label = createPinLabel("Look up");
group.add(label.object);
// later
label.dispose();
```

## Tests

No unit test of its own (a canvas is needed). The phone's AR e2e walks
run it for real (`playwright-tests/ar-fakes.js` keeps the real
`createLabel` seam: Chromium has the canvas), and
`playwright-tests/editor3d.spec.js` opens the 3D view; the stations layer's
unit tests (`editor3d/editor3d-stations.test.ts`) hand in a stand-in.
