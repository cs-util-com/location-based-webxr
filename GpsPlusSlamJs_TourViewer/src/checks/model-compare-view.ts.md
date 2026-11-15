# model-compare-view.ts

**Purpose:** the state of the asset optimizer check page's one large 3D model view (`asset-optimizer-check.html`): which model is shown, whether the wireframe look is on, and where the camera is, as a pure reducer.

## Public API

- `Vec3`, `CameraPose` (`{ position, target }`), `ModelViewState` (`{ count, shown, wireframe, camera }`), `ModelViewAction`.
- `INITIAL_MODEL_VIEW`: nothing loaded, the original index, the wireframe look off, no camera.
- `modelViewReducer(state, action)`:
  - `loaded` (`count`, `camera`): a new set of models (the original and its variants); the original is shown and the camera framed anew; the wireframe look stays as the viewer left it.
  - `show` (`index`): shows the model at `index` (0 is the original). The camera is never touched.
  - `wireframe` (`on`): the look, kept across every switch.
  - `camera` (`camera`): the viewer orbited or zoomed.
- `framePose(min, max)`: a camera on a box, looking at its centre from above and to the side at 2.6 half diagonals (the whole box in a 40 degree view). The page's large view starts from it and its fixed SSIM drawings use it, so both look from the same place.

## Invariants

- Only `camera` and `loaded` change the camera pose; only `loaded` and `show` change the shown index; `shown` is always below `count` once something is loaded.
- An action that does not apply returns the same state object: an index out of range or not an integer, a count under 1, a pose with a non-finite number. `framePose` throws with words on an empty or non-finite box.
- The three.js objects (renderer, camera, OrbitControls, the loaded scenes, the wire lines) are resources, not state, and stay in the page: the camera follows the controls, and the page writes each orbit into the state with a `camera` action.

## Example

```ts
let state = modelViewReducer(INITIAL_MODEL_VIEW, {
  type: "loaded",
  count: 7,
  camera: framePose([-1, 0, -1], [1, 2, 1]),
});
state = modelViewReducer(state, { type: "wireframe", on: true });
state = modelViewReducer(state, { type: "show", index: 3 }); // same camera, still wireframe
```

## Tests

- `model-compare-view.test.ts`: a switch keeps the camera, the wireframe look survives switches and a new source, refused actions return the state unchanged, the framing of a box.
- `model-compare-view.property.test.ts`: over any sequence of actions, a switch or the wireframe toggle never moves the camera, and the shown index stays in range.
- The e2e `playwright-tests/editor-asset-optimizers.spec.js` ("the large view") checks the same on the page with three.js's own camera after a real drag.
