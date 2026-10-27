# film-floor.ts

## Purpose

The hero film without WebGL: the same park drawn flat in SVG with the
same camera angles and the same fitting, used when WebGL is missing, the
renderer will not start, after a real context loss, and as the still
while AR has the GPU.

## Public API

- `drawFloor(S: SceneState, phoneOn: boolean, ly: FilmLayout): { viewBox, markup, lead }`
  - `markup`: polygons sorted back to front, the route's dots, pins, and
    label pills (`g.lf-lb` with `text.lf-nm`).
  - `lead`: where the dashed line from the phone starts (the person's
    head), in stage px, or null (overview, phone off).
- `floorSignature(S, phoneOn)`: changes only when something visible in
  the drawing changes.

## Invariants

- Pure strings; the caller sets the markup and then fits each label pill
  to its measured text (`landing-film.ts`, `getComputedTextLength`).
- The drawing jumps between views (no camera move), as the prototype's.
- A playing film without WebGL redraws only when the signature changes.

## Tests

`film-floor.test.ts`.
