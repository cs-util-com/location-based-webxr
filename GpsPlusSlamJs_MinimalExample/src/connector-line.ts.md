# connector-line.ts

## Purpose

Draws a red line connecting each GPS-anchored **sphere** to its deliberate
floater **cube** in the Step 4 contrast demo, so the pairing — and the growing
drift between them — stays obvious even with several pairs on screen.

## Public API

- `CONNECTOR_LINE_COLOR` — the line colour (`0xff0000`, red).
- `createConnectorLine({ sphere, cube })` → `ConnectorLine`
  - `line`: the `THREE.Line`, already added as a child of `sphere`.
  - `update()`: recompute the cube endpoint to the cube's current world pose.
    Call once per frame. Returns nothing; never throws.

## Invariants & assumptions

- The line is a **child of `sphere`**. Vertex 0 is therefore permanently the
  sphere origin (local `0,0,0`); only vertex 1 is rewritten on `update()`.
- Vertex 1 is the cube's world position expressed in sphere-local coordinates
  (`sphere.worldToLocal(cube.getWorldPosition())`). `update()` refreshes the
  sphere's world matrix first so the conversion uses the sphere's current
  transform (the GPS alignment on `arWorldGroup` moves the sphere).
- `sphere` and `cube` may live under different, arbitrarily transformed parents
  (they do: sphere under `arWorldGroup`, cube under `scene`). The world→local
  conversion is what makes the line span the two frames correctly.
- `update()` is allocation-free in steady state (one reused scratch `Vector3`).

## Examples

```ts
const { line, update } = createConnectorLine({ sphere, cube });
registerXrFrameUpdate(update); // refresh the cube end each frame
```

## Tests

- `connector-line.test.ts` — parenting + end-A-at-origin, end-B equals the cube
  world pose in sphere-local coords under non-trivial parents, end B tracks a
  drifting cube while end A stays put, and the line uses the red material.
