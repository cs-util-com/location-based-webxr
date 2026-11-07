# v3-city-mesh.js

## Purpose

Builds V3's buildings: the library's volumes from V3's tags, an inferred roof
sheet where the rules allow one, merged per chunk with the metres and tones the
model shader reads.

## Public API

- `buildModelCity(features, ctx, { material, tolerance })`: `THREE.Mesh[]`, one
  per chunk, all sharing `material`. `ctx` is the harness's variant context.

## Invariants and assumptions

- Runs once at load. Per vertex it writes `color` (wall tone), `aRoofTint`,
  `aFinish` (wall, roof), `aStorey` (base y, storey metres, eave y), `aRoofShell`
  (1 on a roof sheet) and `aWallSpan`. That is 14 floats a vertex against
  V0's 5 (`aHeight01`, `aFeatureRand`, colour), and no extra draw call: chunks
  use the library's `chunkKeyFor` and 920 m cell.
- It merges itself because the library's `chunkMeshes` carries only its own
  attributes; `mergeMeshes` keeps order, which the attribute walk relies on.
- An inferred roof goes on a volume without a `parentFeature` only. The library
  still builds that volume's flat cap at the eave, hidden under the sheet: about
  two triangles a house that are never seen.
- A tagged building reaches `buildCity` as the same feature object.
- Barriers are matte paper without lines.

## Example

```js
buildModelCity(features, ctx, { material, tolerance: ROOF_TOLERANCE });
```

## Tests

No unit test: it needs the served library. Its decisions live in
`v3-model-rules.js`, `v3-roof-shell.js` and `v3-wall-span.js`, which have tests;
this file is checked by the page itself.
