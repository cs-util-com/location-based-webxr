# Model import, direction 2: one bench, everything live

A throwaway UX prototype for the step after a creator drops a 3D model
on the editor's asset shelf: making it light enough for visitors'
phones. Linked from nothing in the app.

Open `index.html`. It loads the rock first; the bar at the top switches
to the marble bust or the utility box, or opens your own `.glb`.
`?sample=bust` and `?sample=box` open those directly.

## The direction

No steps and no wizard: one workbench. The large view sits on top and
four cards sit below it, all live at once:

- **File size:** the total in large type, its share of the original,
  and two bars on one scale (original and yours), each split into
  pictures and shape, so the author sees where the bytes are.
- **Shape detail:** a continuous 1 to 100 % slider; the view redraws
  on every drag position. "Show the triangles" draws the mesh as flat
  grey with its wireframe. "8-bit corner points" shows the coarser
  positions in the view and says what it saves.
- **Picture size:** the six steps (original, 2048, 1024, 512, 256, 128) as buttons, each showing the file size it would give. WebP is
  a checkbox that says what it saves at the chosen step.
- **Seen from afar:** a slider that moves the camera away to a
  visitor's distance, with a ruler of the saved levels (full detail,
  then a quarter, then a sixteenth) and where each takes over. A loupe
  in the corner shows, up close, the level the visitor gets at that
  distance. "How fast detail drops" moves the switch distances.

The original-versus-yours switch is the largest control on the page,
at the bottom of the view; Space or O flips it. A double-tap or
double-click on the model looks closer at that spot, which is how the
bust's eyes are inspected: focus an eye, drag the shape slider, flip.

## The never-list, item by item

- **No control that jumps in coarse steps, and every change shows while
  dragging.** The shape slider moves in 1 % steps and redraws on every
  `input` event: each share is an index list over one vertex buffer
  ordered once by the progressive simplifier, so an update takes about
  a millisecond (measured below). The distance and detail-drop sliders
  redraw the same way. The picture steps are the brief's six steps;
  every step shows its size before it is chosen.
- **The camera never resets on a switch.** The original and yours are
  two scene graphs in the same place; the switch only flips their
  visibility. No control touches the camera except the distance
  slider, which moves it along the current view direction (its whole
  point) and returns it to the author's own distance at "up close".
  The measuring run checks the camera before and after a flip.
- **No frozen page while the optimizer works.** The simplifier's
  ordering and its error measurement run in `simplify-worker.js`; the
  picture re-encodes run in `texture-worker.js`, one step after the
  other, the chosen step first. A progress bar shows over the view
  while the chosen step is being made, each step button fills as its
  pictures are made, and the previous pictures stay on the model
  until the new ones are ready.
- **No debug UI with numbers nobody can act on.** Every number is one
  the author acts on: the file size, what a checkbox would save, the
  triangle count with how far the shape moves at most, and the
  distances at which a visitor sees each level. The time-per-update
  line in the bottom right is the brief's measuring hook, kept small.
- **No hidden original.** The original is one tap away at all times,
  with its size on the switch itself.
- **No forced order.** Every control is available at once and in any
  order; the bust's eyes can be checked at any shape share before
  anything else is touched.
- **No `backdrop-filter`, no thin light strokes.** Solid 2 px dark
  borders on opaque cards; nothing translucent sits over the view.

## Where the numbers come from

- **Picture bytes are measured, not estimated:** the texture worker
  re-encodes each image the way the shelf's picture device does
  (`createImageBitmap` with a high-quality resize, an
  `OffscreenCanvas`, `convertToBlob`) with the shelf's formats and
  qualities (colour JPEG 0.85, data JPEG 0.92, PNG kept for alpha and
  PNG data maps, a not-resized result that is not smaller keeps the
  original bytes).
- **Shape bytes are counted** from the chosen level the way the shelf
  writes it: 16-bit positions (8-bit on request), 8-bit normals,
  16-bit texture coordinates, each padded to 4 bytes, 16-bit indices
  while the vertices fit, and the chain of two coarser levels.
- **Above 90 % of the original the editor keeps the original file**,
  and the size card says so.
- The rules live in `bench-sizes.js`; each names the shelf file it
  restates.

## Files

- `index.html`: the thin shell (sample picker, file input, the
  confirmation after "Use this version", `window.modelBench`).
- `bench.js`: the bench itself, a three.js ES module.
- `bench.css`: its look, every rule under `.mb`.
- `bench-state.js`: the author's choices as a pure reducer.
- `bench-sizes.js`: the size rules, formatters and visitor distances.
- `simplify-worker.js`, `texture-worker.js`: the two Workers.
- `model-marble-bust.glb`, `model-utility-box.glb`: the editor test
  samples; the rock is the model LOD prototype's `rock.glb`.

The simplifier is imported from `../model-lod-1/lod-simplify.js`.

## The module API

```js
import { createModelBench } from "./bench.js";

const bench = createModelBench(element, {
  onAccept(settings) {}, // "Use this version"
  onBack() {}, // "Back"
  workerBase, // optional URL of the folder holding the two Workers
});
await bench.load(fileOrArrayBufferOrUrl, "Name shown in the header");
```

- `load(source, name)`: a `Blob`/`File`, an `ArrayBuffer` or a URL of a
  `.glb`. A newer load wins over one still running; a failure is shown
  in words in the view.
- `dispatch(action)`, `getState()`: the bench's state, changed only by
  `benchReducer` in `bench-state.js` (actions `share`, `textureStep`,
  `toggle` for `webp`/`positions8`/`wireframe`, `show`, `flip`,
  `distance`, `drop`). A shelf store can take the reducer over as a
  slice; three.js objects, Workers and made files stay outside it.
- `settings()`: what the editor's model optimizer takes for this
  version: `{ detailShare, textureMaxSidePx, textureType?,
positionBits?, maxPositionError?, distanceBudgetPx }`.
- `metrics()`: the measuring hook: `elements` (DOM elements of the
  bench), `lastUpdateMs`, `medianUpdateMs`, `worstUpdateMs` and
  `updates` for the live shape update, `buildMs` per mesh, `ready`,
  `measured`, `picturesMade`, `shownPictures`, `triangles`, `drawn`,
  `bytes` and `camera`.
- `dispose()`: stops both Workers, frees the GPU resources and empties
  the element.

## Measured (headless Chromium, software WebGL)

The shape slider swept from 100 to 1 and back on a 1440 x 900 page;
time per live update (index lists, chain and size counts):

- Rock (9 932 triangles): median 0.6 ms, ordering in the Worker 0.9 s.
- Marble bust (17 456 triangles): median 1.0 ms, ordering 0.6 s.
- Utility box (4 404 triangles): median 0.2 ms, ordering 0.1 s.

Single updates reached 25 to 118 ms a few times per sweep, which looks
like garbage collection of the per-update index lists; a phone run
should check whether a drag feels it. The bench has about 110 DOM
elements.
