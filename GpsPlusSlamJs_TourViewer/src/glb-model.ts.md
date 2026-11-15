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
  level (the author's) its draw range. The chain must be an unsigned
  integer list (8, 16 or 32 bits); a float accessor named as the chain is
  refused and the file loads as if it had none.
- Each mesh's `onBeforeRender` picks the coarsest level whose deviation
  stays within `LOD_PIXEL_BUDGET` (`glb-lod.ts`, which has the sweep):
  the world box diagonal (the largest axis scale of `matrixWorld`), the
  distance from the camera to the near side of the bounding sphere (a
  camera inside it draws the finest level), the projection's focal
  length and the render target's height (the canvas's when drawing to the
  screen).
- The draw range lives on the geometry, persists between passes and is
  read by the shadow pass and by a raycast too, so each sets the range it
  needs first: `onBeforeShadow` casts the level this mesh's last frame
  picked (the author's before its first frame), and the mesh's
  `raycast` hits the author's level, then restores the frame's range.
- An instanced mesh (`EXT_mesh_gpu_instancing`) draws every instance with
  one range, so it always draws the author's level: a level picked for
  the instance at the origin would thin the near ones.
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
far away and back again), casts its shadow with the level it draws, is
picked at the author's level, draws an instanced mesh at the author's
level and ignores a chain that is no integer list; a file without levels
loads as before. The optimized fixture is made once per file. The phone's AR e2e
walks run it for real: `playwright-tests/ar-fakes.js` keeps the real
seam, so three's GLTFLoader parses the fixture's minimal `.glb`; the stations layer's unit tests
(`editor3d/editor3d-stations.test.ts`) hand in a stand-in and check a
model that cannot be read is left out.
