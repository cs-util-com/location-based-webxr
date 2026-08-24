# panel-geometry.ts

## Purpose

Pure UV-rectangle geometry shared by every in-world panel — the `Rect` type
and a point-in-rect hit test, expressed in the plane's UV space so a raycast
hit can be mapped to "which control did the user tap" without any renderer.

## Public API

- **`Rect`** — `{ x, y, w, h }`, a rectangle in normalized panel UV space
  (`[0,1] × [0,1]`). Convention matches `THREE.PlaneGeometry` intersection
  UVs: origin `(0,0)` is the bottom-left of the front face, `u` → right,
  `v` → up.
- **`contains(rect: Rect, u: number, v: number): boolean`** — whether the UV
  point `(u, v)` lies within `rect` (edges inclusive).

## Invariants & assumptions

- Pure. No dependencies.
- Edges are inclusive, so a hit exactly on a rect boundary counts as inside.

## Examples

```ts
import { contains, type Rect } from 'gps-plus-slam-app-framework/visualization';

const track: Rect = { x: 0.32, y: 0.38, w: 0.6, h: 0.24 };
contains(track, 0.5, 0.4); // true
```

## Tests

- `panel-geometry.test.ts` — `contains` on interior points, each edge, and
  points outside the rect.
