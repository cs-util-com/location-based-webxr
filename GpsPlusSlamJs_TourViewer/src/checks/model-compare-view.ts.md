# model-compare-view.ts

**Purpose:** the state of the asset optimizer check page's one large 3D model view (`asset-optimizer-check.html`): where its geometry and texture sliders stand, its options (WebP textures, 8-bit vertex positions, showing the original), whether the wireframe look is on, and where the camera is, as a pure reducer; plus the optimizer settings a slider position names.

## Public API

- `Vec3`, `CameraPose` (`{ position, target }`), `ModelViewState` (`{ stops, geometry, texture, webp, positions8, original, wireframe, camera }`), `ModelViewToggle`, `ModelViewAction`.
- `TEXTURE_STEPS`: the texture slider's steps, left to right so right means more, as on the geometry slider: 128, 256, 512, 1024, 2048 px and original size (a limit of 16384 px no texture reaches; the optimizer never enlarges). `DEFAULT_TEXTURE_STEP`: the step of the shelf's own limit (`OPTIMIZER_SETTINGS.model.textureMaxSidePx`, 1024).
- `INITIAL_MODEL_VIEW`: nothing loaded, the texture slider on the shelf's limit, every option off, no camera.
- `modelViewReducer(state, action)`:
  - `loaded` (`stops`, `geometry`, `camera`): a new model, with its own geometry stops; the slider on its default level, the variant shown (not the original), the camera framed anew. The texture step, the options and the wireframe look stay as the viewer left them: they are the viewer's settings, not the model's.
  - `geometry` (`index`) and `texture` (`index`): a slider moved. The camera is never touched.
  - `toggle` (`name`, `on`): `webp`, `positions8`, `original` or `wireframe`.
  - `camera` (`camera`): the viewer orbited or zoomed.
- `variantSettings(state, shares)`: the `Partial<ModelSettings>` of the variant the sliders and options name, and the key the page caches it under. `shares` are the geometry stops' shares in slider order (null: the default level, so no `detailShare` and the optimizer's budget decides); the page builds them with `detailStops` of `shelf-panel-model.ts`, so the slider has the shelf's own stops. Null before a model is loaded, or when `shares` does not match the state's stops. `original` and `wireframe` do not enter the key: they change what is drawn, not what is made.
- `framePose(min, max)`: a camera on a box, looking at its centre from above and to the side at 2.6 half diagonals (the whole box in a 40 degree view). The page's large view starts from it and its fixed SSIM drawings use it, so both look from the same place.

## Invariants

- Only `camera` and `loaded` change the camera pose; only the wireframe toggle changes the wireframe look; `geometry` stays below `stops` once a model is loaded, and `texture` always names a step.
- An action that does not apply returns the same state object: an index out of range or not an integer, a `loaded` with no stops or its default stop outside them, a pose with a non-finite number. `framePose` throws with words on an empty or non-finite box.
- The three.js objects (renderer, camera, OrbitControls, the loaded scenes, the wire lines) and the cache of made variants are resources, not state, and stay in the page: the camera follows the controls, and the page writes each orbit into the state with a `camera` action.

## Example

```ts
let state = modelViewReducer(INITIAL_MODEL_VIEW, {
  type: "loaded",
  stops: 7,
  geometry: 4,
  camera: framePose([-1, 0, -1], [1, 2, 1]),
});
state = modelViewReducer(state, {
  type: "toggle",
  name: "wireframe",
  on: true,
});
state = modelViewReducer(state, { type: "geometry", index: 1 }); // same camera, still wireframe
variantSettings(state, [0.05, 0.12, 0.25, 0.35, null, 0.5, 1])?.model;
// { detailShare: 0.12, textureMaxSidePx: 1024 }
```

## Tests

- `model-compare-view.test.ts`: slider moves and options keep the camera, a new model starts on its default level and keeps the viewer's settings, refused actions return the state unchanged, the texture steps start on the shelf's limit, the settings and cache keys a slider position names, the framing of a box.
- `model-compare-view.property.test.ts`: over any sequence of actions, no slider or option moves the camera or changes the wireframe look, and both sliders stay in range.
- The e2e `playwright-tests/editor-asset-optimizers.spec.js` ("the large view") checks the same on the page with three.js's own camera after a real drag.
