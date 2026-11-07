# v4-material.js

## Purpose

The one building material of V4: Lambert with a fragment patch for the wall foot, eave shade, storey lines and window rhythm.

## Public API

`facadeMaterial(THREE, look)` returns `{ material, uniforms }`. Uniforms: `uFoot` (strength, height in metres), `uLine`, `uWindow`, `uEave`. Geometry must carry `aFacade` (see `v4-facade.js`) and vertex colours.

## Invariants and assumptions

- The darkening multiplies albedo, so it holds in full sun; it runs only where `aFacade.w > 0`, which is a wall, so a roof or the ground never receives it.
- Heights are real metres per wall, not the library's per-feature `aHeight01`.
- Line and window detail fades out by metres per pixel, so far views do not shimmer.
- No pass, no draw, no per-frame CPU. A uniform change needs no recompile.
- `fwidth` is core in WebGL2, which three.js requires.
- A real build on a slope needs ground height per wall: `baseY` is one number per volume, right on the flat fixtures only.

## Example

```js
const { material, uniforms } = facadeMaterial(
  THREE,
  parseLook(location.search),
);
uniforms.uFoot.value.set(0, 2.4); // off
```

## Tests

Pure input in `v4-facade.test.mjs`; the shader is judged by eye in the page.
