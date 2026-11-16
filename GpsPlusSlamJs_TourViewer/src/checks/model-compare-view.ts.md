# model-compare-view.ts

**Purpose:** the state of the asset optimizer check page's one large 3D model view (`asset-optimizer-check.html`): where its geometry and texture sliders stand, its options (WebP textures, 8-bit vertex positions, showing the original), whether the wireframe look is on, where the camera is, the loaded model's geometry stops, triangles and size, and which variant is drawn, as a pure reducer; plus the optimizer settings a slider position names.

## Public API

- `Vec3`, `CameraPose` (`{ position, target }`), `GeometryStop` (`{ share, triangles, deviation }`; share null on the default level), `ModelViewState` (`{ stops, trianglesBefore, size, geometry, texture, webp, positions8, original, wireframe, camera, shownKey }`), `ModelViewAction`.
- `TEXTURE_STEPS`: the texture slider's steps, left to right so right means more, as on the geometry slider: 128, 256, 512, 1024, 2048 px and original size (a limit of 16384 px no texture reaches; the optimizer never enlarges). `DEFAULT_TEXTURE_STEP`: the step of the shelf's own limit (`OPTIMIZER_SETTINGS.model.textureMaxSidePx`, 1024).
- `INITIAL_MODEL_VIEW`: nothing loaded, the texture slider on the shelf's limit, every option off, no camera.
- `modelViewReducer(state, action)`:
  - `loaded` (`stops`, `geometry`, `trianglesBefore`, `size`, `camera`, `shownKey`): a new model, with its own geometry stops (the shelf's `detailStops` of `shelf-panel-model.ts`), its triangles and size for the readout, and the variant drawn first; the slider on its default level, the variant shown (not the original), the camera framed anew. The texture step, the options and the wireframe look stay as the viewer left them: they are the viewer's settings, not the model's.
  - `geometry` (`index`) and `texture` (`index`): a slider moved. The camera is never touched.
  - `toggle` (`name`, `on`): `webp`, `positions8`, `original` or `wireframe`.
  - `camera` (`camera`): the viewer orbited or zoomed.
  - `shown` (`key`): the page swapped in another variant ("original" or a `variantSettings` key).
- `variantSettings(state)`: the `Partial<ModelSettings>` of the variant the sliders and options name, and the key the page caches it under. The geometry stop's share is the level kept near (null: the default level, so no `detailShare` and the optimizer's budget decides). Null before a model is loaded. `original` and `wireframe` do not enter the key: they change what is drawn, not what is made.
- `framePose(min, max)`: a camera on a box, looking at its centre from above and to the side at 2.6 half diagonals (the whole box in a 40 degree view). The page's large view starts from it and its fixed SSIM drawings use it, so both look from the same place.

## Invariants

- Only `camera` and `loaded` change the camera pose; only `shown` and `loaded` change `shownKey`; only the wireframe toggle changes the wireframe look; `geometry` stays below `stops` once a model is loaded, and `texture` always names a step.
- An action that does not apply returns the same state object: an index out of range or not an integer, a `loaded` with no stops, its default stop outside them, a stop with a share outside (0, 1] or a negative or non-finite count, or a negative or non-finite triangle count or size, a pose with a non-finite number, an empty key. `framePose` throws with words on an empty or non-finite box.
- The three.js objects (renderer, camera, OrbitControls, the loaded scenes, the wire lines), the cache of made variants and the entry drawn (it holds a three.js object; the state holds its key) are resources, not state, and stay in the page: the camera follows the controls, and the page writes each orbit into the state with a `camera` action.

## Example

```ts
const stop = (share: number | null, triangles: number) => ({
  share,
  triangles,
  deviation: 0.001,
});
let state = modelViewReducer(INITIAL_MODEL_VIEW, {
  type: "loaded",
  stops: [stop(0.12, 120), stop(null, 400), stop(1, 1000)],
  geometry: 1,
  trianglesBefore: 1000,
  size: 2,
  camera: framePose([-1, 0, -1], [1, 2, 1]),
  shownKey: "first",
});
state = modelViewReducer(state, {
  type: "toggle",
  name: "wireframe",
  on: true,
});
state = modelViewReducer(state, { type: "geometry", index: 0 }); // same camera, still wireframe
variantSettings(state)?.model;
// { detailShare: 0.12, textureMaxSidePx: 1024 }
```

## Tests

- `model-compare-view.test.ts`: slider moves and options keep the camera, a new model starts on its default level and keeps the viewer's settings, refused actions return the state unchanged, the drawn variant changes only by its own action, the texture steps start on the shelf's limit, the settings and cache keys a slider position names, the framing of a box.
- `model-compare-view.property.test.ts`: over any sequence of actions, no slider or option moves the camera, changes the wireframe look or the drawn variant, and both sliders stay in range.
- The e2e `playwright-tests/editor-asset-optimizers.spec.js` ("the large view") checks the same on the page with three.js's own camera after a real drag, plus the GPU memory back at its baseline after slider moves and a variant in flight across a model switch.
