# maker-preview.ts

**Purpose:** the maker's previews: the four outdoor backdrops, the talking and pointing timings, and drawing a cut frame on a canvas.

## Public API

- `BACKDROPS` (`{ id, label, css }`), `Backdrop` (a backdrop id or `checks`). Painting a backdrop (`paintBackdrop`) is module-private.
- `talkIndex(t)`, `beckonIndex(t)`: the frame shown at `t` ms (a 2.8 s talking loop, a 3.2 s pointing loop).
- `canvasOf(img)`, `pngOf(canvas)` (rejects when the browser writes no PNG).
- `drawFigure(canvas, frame, kind)`; `drawFeet(canvas, frame, kind)` (the bottom of the frame enlarged without smoothing, so stray dots show).
- `createAnimSet<T>()`: preview animations by slot (the maker uses each canvas's id). `put(slot, anim)` replaces the one there, so a re-cut that rebuilds the talk-style canvases leaves one animation each and lets the old canvases go; `all()`, `size`.

## Invariants

- The timings are pure; the drawing is the device seam, checked in the browser by `playwright-tests/character-maker.spec.js` and by eye against the prototype.

## Tests

`maker-preview.test.ts` (the timings over whole loops and for negative times, the backdrop list, N re-cuts leaving one animation per slot).
