# `cell-mesh.ts`

**Purpose.** Turn scored cells into flat hexagon geometry for the 3D scene, together with the triangle → cell index a pick needs.

## Public API

- `buildCellMesh(cells, { frame, category, threshold, scale, showBelowThreshold }): CellMesh`
- `CellMesh` — `{ cells, positions, colors, indices, cellForTriangle }`.
- `EMPTY_CELL_MESH` — what a cleared or empty snapshot draws.

## Invariants & assumptions

- **It is the SAME grid the map draws, not a similar one.** Band rules come from
  `classifyScore` and TREATMENTS from `bandTreatment` — the same functions
  `map-view.ts` uses. A second colour path would let the two views disagree about
  a cell's score, and a reader who catches that disagreement has no way to know
  which to believe, which is worse than the 3D view not showing the grid at all
  (finding M3).
  - **The second half of that sentence used to say "colours from `heatColour`",
    and it was false (W13, finding R3-8).** `heatColour` returns the ramp's
    darkest stop for ANY score at or below the threshold, so a veto, an identity
    and a below-bar cell were one near-black colour here while the map drew them
    red, dashed-outline and dim. The claim was true of WHICH cells are drawn and
    false of what they look like — which is most of why "show cells below the
    threshold" read as doing nothing.
- **An `identity` cell is an OUTLINE with an invisible face.** DEC-7 draws it
  unfilled in 2D because the unfilledness is the statement, and a solid hexagon
  cannot make it — so the boundary goes into `linePositions` and the face stays
  in the triangle buffers at alpha 0. The face is not decoration: picking resolves
  `faceIndex` against these triangles, and DEC-7's stated reason for revealing
  sub-threshold cells at all is that a hidden cell is the one cell you cannot
  click to ask why (DEC-R3-21).
- **`colors` is RGBA, four components per vertex**, for exactly that alpha.
- **Geometry and the pick index are built in one pass.** A raycast returns a triangle index, which is meaningless without `cellForTriangle`. Built separately they could drift, and a click would open the details panel on a confidently wrong cell.
- **`faceIndex` is the triangle index** for an indexed `BufferGeometry`, which is exactly what `cellForTriangle` is keyed on.
- **One merged buffer, not a mesh per cell.** A working set is ~931 cells; 931 draw calls for flat hexagons would cost more than everything else in the scene combined.
- **Colour is flat per hexagon.** Interpolating across one cell would imply sub-cell variation the data does not claim.
- **The grid sits `GRID_LIFT_M` above the ground.** Coplanar surfaces z-fight, and the flicker reads as a rendering bug rather than as a deliberate overlay.
- **The buffers are RAGGED — one vertex per real corner, never a fixed stride.** An H3 boundary is usually 6 corners and 5 at a pentagon, but that is only half the range: a cell straddling an icosahedron **edge** carries extra vertices where the projection distortion is resolved, and `cellToBoundary` returns 7, 8 or (for a pentagon itself) 10. Verified at res 13 — 7-corner cells are ordinary within a ring or two of the 12 pentagons.
  - The earlier fixed 6-corner stride clamped with `Math.min(corner, boundary.length - 1)`, which covered the SHORT case and silently **truncated** the long one: the hexagon drawn was not the cell's footprint and the pick region was wrong along the clipped edge, with nothing thrown and nothing obviously broken. In a view whose whole purpose is being checked against the real world by eye, a cell of the wrong shape is exactly the failure that reads as correct.
  - The cost is that a per-cell vertex offset must be accumulated rather than multiplied, and a triangle index can no longer be divided back into a cell index — which is why `cellForTriangle` is built in the same pass and tested across a MIX of corner counts.
  - The fan itself needs no special case: an H3 boundary is convex at any corner count.
- **ENU `y` is north; the scene's `-z` is north.** The sign flip on `z` is the package's published mesh-frame convention, not an arbitrary choice.
- Pure: no three.js, no DOM — the same split the package uses for buildings.

## Examples

```ts
buildingView.renderCells(
  buildCellMesh(snapshot.cells, {
    frame: enuFrameAt(snapshot.position),
    category,
    threshold: snapshot.threshold,
    scale,
    showBelowThreshold,
  }),
);
```

## Tests

- `cell-mesh.test.ts` — one hexagon per drawn cell as four triangles; every triangle indexed back to its cell (the property a pick depends on); the same band rules as the map; colours from the shared ramp; flat colour per hexagon; empty geometry rather than a throw when nothing is drawn; and the grid lifted clear of the ground.
  - Plus the ragged-boundary cases, against real H3 ids rather than a synthetic shape: a 7-corner cell and a 10-corner pentagon are drawn in full, and a mix of corner counts keeps `cellForTriangle` aligned with every index in range.
- `playwright-tests/` — _"draws the affordance grid too, and a click on it opens the panel"_, which proves the geometry is both drawn **and** correctly indexed. A coloured hexagon nobody can identify would pass a pixel test and still be useless.
