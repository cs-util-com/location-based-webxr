# `cell-mesh.ts`

**Purpose.** Turn scored cells into flat hexagon geometry for the 3D scene, together with the triangle → cell index a pick needs.

## Public API

- `buildCellMesh(cells, { frame, category, threshold, scale, showBelowThreshold }): CellMesh`
- `CellMesh` — `{ cells, positions, colors, indices, cellForTriangle }`.
- `EMPTY_CELL_MESH` — what a cleared or empty snapshot draws.

## Invariants & assumptions

- **It is the SAME grid the map draws, not a similar one.** Band rules come from `classifyScore` and colours from `heatColour` — the functions `map-view.ts` uses. A second colour path would let the two views disagree about a cell's score, and a reader who catches that disagreement has no way to know which to believe, which is worse than the 3D view not showing the grid at all (finding M3).
- **Geometry and the pick index are built in one pass.** A raycast returns a triangle index, which is meaningless without `cellForTriangle`. Built separately they could drift, and a click would open the details panel on a confidently wrong cell.
- **`faceIndex` is the triangle index** for an indexed `BufferGeometry`, which is exactly what `cellForTriangle` is keyed on.
- **One merged buffer, not a mesh per cell.** A working set is ~931 cells; 931 draw calls for flat hexagons would cost more than everything else in the scene combined.
- **Colour is flat per hexagon.** Interpolating across one cell would imply sub-cell variation the data does not claim.
- **The grid sits `GRID_LIFT_M` above the ground.** Coplanar surfaces z-fight, and the flicker reads as a rendering bug rather than as a deliberate overlay.
- **A 5-corner H3 cell (a pentagon) repeats its last corner** rather than emitting a ragged buffer, so the fan keeps a fixed stride and the extra triangle is degenerate — it draws nothing.
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
- `playwright-tests/osm-demo.spec.js` — _"draws the affordance grid too, and a click on it opens the panel"_, which proves the geometry is both drawn **and** correctly indexed. A coloured hexagon nobody can identify would pass a pixel test and still be useless.
