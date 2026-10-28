# model-views-check.ts

## Purpose

The code of the check page `model-views-check.html`: a WebGL scene with one
tour model mounted in its world view and the visitor's model DOM
(`model-visitor.ts`) over it, driven by the `window.__modelViewsCheck`
hook. See `model-views-check.html.md` for what the page is for.

## Public API

- `startModelViewsCheck(root)` -> `ModelViewsCheck` - builds the renderer,
  the scene, the camera and the visitor DOM under `root`, starts the frame
  loop and installs the hook (`load`, `show`, `lookFrom`, `openNote`, `stop`,
  `state`).
- `checkModelBlock(value)` - `value` as a model block in a world view;
  throws a `TypeError` naming the first bad field (`kind`, `view`, `sizeM`,
  `id`). A check page's input is the caller's, so it is refused rather
  than repaired.
- `viewerFovDeg(width, height)` - the camera's vertical field of view:
  45 degrees across the screen's short side (the prototype's rule); 45 for
  a size that is not positive.

## Invariants

- One model at a time: `show` frees the previous model's view before it
  adds the next.
- The model is sized by `modelScale` and mounted by `mountModelView`, the
  visitor renderer's own path; only the station pose chain is skipped.
- A canvas click is a tap: it picks among the shown models by a ray from
  the click.

## Tests

`model-views-check.test.ts` (the block check, the field of view);
`playwright-tests/model-views.spec.js` drives the page in a browser.
