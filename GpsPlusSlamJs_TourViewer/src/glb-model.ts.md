# glb-model.ts

## Purpose

A tour's `.glb` model as a three scene, for the phone's AR (through
`seams.ts`) and the desktop editor's 3D view: one loader for both.

## Public API

- `loadGlbModel(blob)` -> `Promise<Object3D>`: the model's scene, its
  clips in `animations` (where `model-views.ts` plays one); rejects
  when three's GLTFLoader cannot parse the bytes.

## Saved levels of detail

A primitive the asset shelf gave coarser levels (`extras.lod`, which
three's loader copies to `geometry.userData.lod`; format in
`editor/asset-shelf/model-lod.ts.md`) draws through its chain:

- On load the chain accessor becomes the geometry's index and the finest
  level its draw range, so a frame that never runs the hook (a shadow
  pass, a raycast) sees the author's level.
- Each mesh's `onBeforeRender` picks the coarsest level whose deviation
  stays within `LOD_PIXEL_BUDGET` (`glb-lod.ts`, which has the sweep):
  the world box diagonal (the largest axis scale of `matrixWorld`), the
  distance from the camera to the near side of the bounding sphere (a
  camera inside it draws the finest level), the projection's focal
  length and the render target's height (the canvas's when drawing to the
  screen).
- A geometry several meshes share gets its chain once; each mesh sets the
  range just before it is drawn. A clone made with `Object3D.clone` shares
  the geometry but not the hook, so it draws whatever range was set last;
  nothing in the app clones a model today.
- A file without `extras.lod`, or with one that is malformed or does not
  fit its accessor, loads exactly as before.

## Invariants & assumptions

- **Lazy:** three's GLTFLoader is imported on first use, so no page pays
  for it until a model is drawn.
- **Self-contained:** the bytes are parsed with an empty base path, so the
  file reaches nothing outside itself. The tour session has already
  checked the file inert before it gets here (no external URIs, no
  decoders: `checkGlbInert`); this module does not check again.
- The caller owns the returned scene (adding it, scaling it, freeing its
  geometries and materials).

## Examples

```ts
const model = await loadGlbModel(await loadContent("models/bench.glb"));
station.add(model);
```

## Tests

`glb-model.test.ts`: a model through the real optimizer and three's
loader draws its chain (finest first, the finest up close, the coarsest
far away and back again); a file without levels loads as before. The phone's AR e2e
walks run it for real: `playwright-tests/ar-fakes.js` keeps the real
seam, so three's GLTFLoader parses the fixture's minimal `.glb`; the stations layer's unit tests
(`editor3d/editor3d-stations.test.ts`) hand in a stand-in and check a
model that cannot be read is left out.
