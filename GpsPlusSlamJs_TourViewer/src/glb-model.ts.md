# glb-model.ts

## Purpose

A tour's `.glb` model as a three scene, for the phone's AR (through
`seams.ts`) and the desktop editor's 3D view: one loader for both.

## Public API

- `loadGlbModel(blob)` -> `Promise<Object3D>`: the model's scene; rejects
  when three's GLTFLoader cannot parse the bytes.

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

No unit test of its own (the loader is three's). The phone's AR e2e
walks run it for real: `playwright-tests/ar-fakes.js` keeps the real
seam, so three's GLTFLoader parses the fixture's minimal `.glb`; the stations layer's unit tests
(`editor3d/editor3d-stations.test.ts`) hand in a stand-in and check a
model that cannot be read is left out.
