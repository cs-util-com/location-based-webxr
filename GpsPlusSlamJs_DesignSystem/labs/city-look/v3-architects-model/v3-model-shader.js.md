# v3-model-shader.js

## Purpose

The model's materials: one building material with storey lines and scored
openings in real metres, and the paper treatment of ground, roads and trees.

## Public API

- `modelBuildingMaterial(THREE, tuning)`: the one `MeshStandardMaterial` all
  chunks share.
- `modelMaterialFor(kind, material, tuning)`: the harness's `materialFor` for
  `ground`, `roads` and `trees`; undefined for anything else.

## Invariants and assumptions

- Nothing per frame on the CPU, and one fragment cost per building. No texture.
- Lines work in metres from `aStorey`, never from `aHeight01`, which is
  normalised per feature.
- Lines are filtered analytically by `fwidth`, so they thin out with distance
  instead of aliasing. Openings fade before they would alias.
- No line at the foot of a wall: object-attached wall-foot darkening belongs to
  V4, not here.
- Roof or wall is decided from the screen derivative of the model position, so
  it holds on any library roof, plus `aRoofShell` for sheet undersides.
- The sky's fill loses 75 % of its colour on buildings only and is lifted 1.2x:
  a white card in the harness's blue fill otherwise turns blue. The sun, the sky
  and the cameras are the harness's and unchanged.
- Trees: the crowns' normals are rounded in the vertex shader, the geometry stays.
- Roads lose their class colours: one card tone.

## Example

```js
const material = modelBuildingMaterial(ctx.THREE, tuning);
modelMaterialFor("ground", ownClone, tuning);
```

## Tests

GLSL has no unit test here; `__cityLook.error` and the console catch a compile
failure, and the look is judged on the page.
