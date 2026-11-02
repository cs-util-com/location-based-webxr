# model-views-check.ts

## Purpose

The code of the check page `model-views-check.html`: a WebGL scene with one
tour model mounted in its world view and the visitor's model DOM
(`model-visitor.ts`) over it, driven by the `window.__modelViewsCheck`
hook. See `model-views-check.html.md` for what the page is for.

## Public API

- `startModelViewsCheck(root, mode?)` -> `ModelViewsCheck` - builds the
  renderer, the scene, the camera and the visitor DOM under `root`, starts
  the frame loop and installs the hook (`load`, `show`, `lookFrom`,
  `openNote`, `stop`, `state` - the shown view, the card and the shown
  discs; `noteAt(index, liftM)` - a note's place lifted along its normal,
  projected by the page's camera into page pixels, worked out apart from
  the markers' own code (`notesOnScreen`, `notePoints`) so the e2e's
  expectation for each disc's centre is independent of what it checks). `mode` defaults to the URL's
  (`checkPageMode`); in `demo` it also shows the stand-in in `hotspots`,
  frames it (`demoCamera`), lets a drag orbit it (OrbitControls, no pan,
  never under the ground, off in `toy`) and adds the view bar
  (`nav.mvc-views`, one design-system `.btn` per view, the shown one
  `aria-pressed`).
- `checkPageMode(search)` - `"hook"` when the URL names `hook` (any value
  but `0`), `"demo"` otherwise.
- `demoBlock(view)` - the demo's block for the stand-in: three notes, two
  named sections, the clip `swing` playing by itself; an unknown view
  reads `placed`.
- `demoCamera(sizeM)` - the demo camera's eye and target for a model
  `sizeM` tall at the origin (about 2.5 sizes from its middle, above it);
  RangeError for a size that is not finite and > 0.
- `checkModelBlock(value)` - `value` as a model block in a world view;
  throws a `TypeError` naming the first bad field (`kind`, `view`, `sizeM`,
  `id`, `pose`, `pose.position` - three finite numbers, `pose.rotation`
  - four). A check page's input is the caller's, so it is refused rather
    than repaired.
- `freeShown(station, { model, handle })` - takes a shown model off the
  page in the visitor renderer's order: its view disposed (the model's
  own materials back), the model removed from `station`, then its
  geometries and materials freed (`disposeObject3D`).
- `viewerFovDeg(width, height)` - the camera's vertical field of view:
  45 degrees across the screen's short side (the prototype's rule); 45 for
  a size that is not positive.

## Invariants

- One model at a time: `show` frees the previous model (`freeShown`)
  before it adds the next, so switching views never leaks GPU memory.
- The model is sized by `modelScale` and mounted by `mountModelView`, the
  visitor renderer's own path; only the station pose chain is skipped.
- A canvas click is a tap: it picks among the shown models by a ray from
  the click. A press that moved 8 px or more (an orbit) is not a tap.
- The hook is installed in both modes; in `hook` mode nothing is drawn
  until a caller shows a block, so a test owns the whole scene.

## Tests

`model-views-check.test.ts` (the block check and its pose, the field
of view, the mode, the demo's block and camera, `freeShown`'s order);
`playwright-tests/model-views.spec.js` drives the page in a browser.
