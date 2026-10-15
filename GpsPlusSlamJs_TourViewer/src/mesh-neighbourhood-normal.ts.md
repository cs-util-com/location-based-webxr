# mesh-neighbourhood-normal.ts

## Purpose

The mesh cursor's rotation from the neighbourhood of the hit (mesh-cursor smoothing plan
2026-10-15-0944 in `GpsPlusSlamJs_Docs/docs/`): the owner's "sampling from the data around
the cursor position to average it a little bit stronger on the rotation part". One triangle
of a mesh built from noisy depth tilts by degrees from its neighbours; the ring lies flat to
the area-weighted mean of the triangles around the hit instead.

## Public API

- `NeighbourhoodNormalOptions` - `{ radiusM, maxAngleDeg }`.
- `DEFAULT_NEIGHBOURHOOD_NORMAL` - `{ radiusM: 0.3, maxAngleDeg: 45 }`.
- `neighbourhoodNormal(hit, options?) → Vector3 | null` - for a three raycast hit on a
  mesh: the WORLD unit normal of the triangles whose centroid lies within `radiusM` of the
  hit point and whose normal is within `maxAngleDeg` of the hit face's. Nothing counted
  (radius 0, an isolated triangle): the hit face's normal. Null for a hit without a face
  or on an object without at least one triangle of positions. Indexed or not.
  Throws `RangeError` for a negative or non-finite option.

## Invariants & assumptions

- **Area-weighted:** the sum of the raw cross products `(c - b) x (a - b)` (three's own
  face-normal winding) weights each triangle by its area, so a mesher's thin slivers (the
  noisiest normals) cannot outvote a cell.
- **The angle gate** keeps a corner upright: a wall's triangles are 90 degrees from a
  floor's and are left out. The result lies within the gate of the hit face (a convex cone
  of counted normals). A hit face tilted by more than the gate counts mostly itself; the
  smoother's normal time constant then calms that one frame.
- Computed in the mesh's own frame (the grid's raw WebXR, under the world group) and turned
  to world by the normal matrix; the radius assumes a rigid world matrix (rotation and
  translation - the alignment), as the world group is.
- Cost: one pass over every triangle per call, the same order as the raycast itself; no
  allocation but the returned vector. F13 tracks the frame cost on the phone.
- Considered and not used: the framework's `fitPlaneRobust` (`ar/qr/qr-size-from-depth.ts`,
  Least-Median-of-Squares over 200 triples with an array and a median each) - too heavy
  per frame for a robustness the gate gives here; the floor estimator's private
  `fitPlane` solves a different problem.

## Parameter sweeps (synthetic 0.15 m cell floors, 4 seeds, 80 hits each)

- `radiusM` 0.1 / 0.15 / 0.2 / **0.3** / 0.45 / 0.6 m, mean tilt in degrees (the face
  normal's in brackets):
  - 1 cm vertex noise [3.76]: 2.55 / 1.48 / 1.06 / **0.56** / 0.31 / 0.19;
  - 2 cm [7.45]: 5.07 / 2.97 / 2.12 / **1.12** / 0.62 / 0.37;
  - 3 cm [11.04]: 7.62 / 4.51 / 3.20 / **1.70** / 0.95 / 0.57.
  - Verdict: monotone; from 0.2 m up at most half the face's tilt at every noise level.
    0.3 m cuts it 6.6-fold; a larger radius gains little visible (about 1 degree on a 9 cm
    ring) and reaches farther onto neighbouring surfaces.
- `maxAngleDeg` 30 / **45** / 60 / 75 / 90 (radius 0.3 m): a corner 5-25 cm from a wall
  stays within 1.5 degrees for 30-75 and tilts 15-43 degrees at 90 (the wall comes in); on
  a 3 cm noisy floor 30 drops some of the floor's own triangles (2.47 degrees) and 45-90
  give 1.67-1.70. Verdict: 45-75 all work; 45 is the most conservative toward a corner
  when the hit face itself tilts toward the wall (wall excluded and floor kept for a face
  tilt up to min(gate, 90 - gate)).
- The framework's real mesh from noisy depth (`mesh-surface.test.ts`): faces tilt only
  0.6-2.5 degrees (the smooth mesher averages each cell's points), and the ring 3 to 3.7
  times less across depth spacing 5-15 cm and noise 2-5 cm. How much the phone's own
  depth tilts the faces is the owner's test.

## Examples

```ts
const hit = raycastPointer(camera, { x: 0, y: 0 }, [mesh], raycaster);
const normal = hit === null ? null : neighbourhoodNormal(hit);
```

## Tests

`mesh-neighbourhood-normal.test.ts` - the world normal under a turned and moved group; a
noisy floor at least halved; a corner upright with the gate and pulled over without it;
area weighting against a sliver (mutation-checked: an unweighted mean fails it); radius 0
is the face; non-indexed equals indexed; null cases; bad settings; the defaults; a
property (finite, unit, within the gate of the face on any noisy floor at any hit, radius
and gate); the radius and gate sweeps above.
