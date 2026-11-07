# v3-wall-span.js

## Purpose

Tells each wall vertex where it lies along its wall and how long the wall is, so
the shader can space openings to the wall instead of letting corners cut them.

## Public API

- `wallSpans({ positions, normals, indices })`: `Float32Array` of
  `[metres along the wall, wall length]` per vertex; 0, 0 off a wall.

## Invariants and assumptions

- Assumes wall vertices are not shared between walls, which `extrude.ts` in the
  Osm library guarantees: every wall quad gets its own four vertices.
- A face counts as a wall when its normal's y is below 0.05.
- A wall is one edge of the ring: a facade broken by a node gets two runs of
  openings. Very short edges (curves) get none.

## Example

```js
geometry.setAttribute(
  "aWallSpan",
  new THREE.BufferAttribute(wallSpans(mesh), 2),
);
```

## Tests

`v3-wall-span.test.mjs`.
