# `src/mesh/pedestrian-areas.ts`

## Purpose

Mapped pedestrian areas (any `highway=*` with `area=yes`: squares, plazas)
as surfaces draped on the terrain (city objects plan
`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`,
M4b). `isRoad` leaves these to the area builders and the plates refuse every
highway, so before this builder nothing drew the ground a person stands on
in an old town.

## Public API

- `PEDESTRIAN_AREA_SPACING_M` - 12, the terrain's post spacing
  (`TERRAIN_SPACING_M`), held equal by a test rather than imported so the mesh
  builders do not depend on the elevation module.
- `BuildPedestrianAreasOptions` - `{ frame, groundHeightM?, window, spacingM?,
liftM? }`. `liftM` defaults to `pedestrianAreaLiftM()` (minus one road rank
  step, 5 mm under the ground-level paths).
- `PedestrianArea` - `{ feature, mesh }`.
- `buildPedestrianAreas(features, options) -> PedestrianArea[]` - input
  order. `RangeError` for a spacing that is not finite and positive, or a lift
  that is not finite.
- Not on the package entry: `buildCity`'s `roads: { markings }` switches it.

## Invariants & assumptions

- The predicate is the ground tint's `isPedestrianArea`, so tint and mesh
  never classify a square two ways. Skipped: nodes, unclosed rings,
  `isBelowSurface` features, and an area clipped away entirely.
- **Clipped to the window before triangulating** (ear clipping is quadratic in
  ring size, and a relation reaches far outside a fetch).
- **Cut along the terrain's post lines:** each triangle is clipped
  (Sutherland-Hodgman) to every `spacingM` cell it overlaps, so each piece lies
  in one cell and every vertex is sampled on the ground. An intersection is
  added only on a strict crossing; pieces and fan triangles under 1 mm^2, and
  fan triangles whose corners merged into one vertex, are dropped.
- Cut points are shared between neighbouring pieces through a key map
  (0.1 mm). A ground that is not a number reads as 0.
- Every triangle faces up (counter-clockwise in ENU, handed over reversed
  because `MeshBuilder` reflects north onto -z).

## Cost (2026-11-11, sweep of the cut spacing)

- Heidelberg's 4 areas: 1,275 / 639 / 391 / 171 triangles at 12 / 24 / 48 m /
  no cut; 9.2 ms at 12 m.
- Reuss's 28 areas: 2,885 triangles at 12 m, 18.5 ms.
- The default is the terrain's own spacing: coarser cuts float a square
  over a hollow between posts.

## Examples

```ts
const areas = buildPedestrianAreas(features, { frame, window, groundHeightM });
```

## Tests

- `pedestrian-areas.test.ts` - exact coverage, holes left open, the window,
  densified to the post spacing with every vertex on the ground, the default
  spacing equal to the terrain's, the lift under the paths, the drawn set,
  unclosed rings, option refusals, and the shared predicate with the tint.
- `pedestrian-areas.property.test.ts` - a random star polygon at spacings
  2-48 m covers exactly its own area, every triangle facing up.
- `testdata/sites/site-roads.test.ts` - the scene counts, pinned.
