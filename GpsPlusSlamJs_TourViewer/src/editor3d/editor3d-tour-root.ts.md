# editor3d-tour-root.ts

## Purpose

Where a tour's points stand in the 3D editor's world: one matrix per
point (a station, a code) and the size rule for a placed model. The
tour's centre for the view's frame and first orbit is
`../editor/tour-origin.ts`'s `tourCentre` (the inspector reads the same
centre, and the 3D view's code stays out of the page's first load).

## Public API

- `pointRootMatrix({ ellipsoid, worldFromEcef, place, undulationM }, out)`
  -> `out`: from the point's own north-up-east frame (x north, y up, z
  east, its height on the up axis as the file writes it) to the world.
  Right to left: NUE to east-up-south; down by N; the point's own
  east-up-south frame on the ellipsoid into ECEF; `worldFromEcef`.
  RangeError for a place outside [-90, 90] or not finite (the globe's own
  check) and for an undulation that is not finite.
- `modelScale(model, sizeM)` -> the factor that makes the largest side of
  the model's box at rest `sizeM` (node transforms included, the model's
  own transform left out); 1 for a model with no extent. RangeError for a
  size that is not finite and > 0.
- `GlobeEllipsoid` - the ellipsoid type the globe's frame functions take.

## Invariants & assumptions

- **Heights:** a tour's `alt` is ellipsoidal; the globe's relief draws
  orthometric heights over the ellipsoid, so a point is drawn N lower than
  its file says (N is about 45.7 m at Marienplatz). With the point's own
  height on the up axis, (0, alt, 0) lands exactly on the ellipsoid's
  point at that latitude and longitude, height alt - N.
- **One matrix per point**, never one for the tour: a single tour frame
  would bend a station a few hundred metres out by the frame's flatness.
- **`modelScale` lives here, not in the Globe package:** `sizeM` is the
  tour format's field, and the globe draws no tour items.
- Module-level scratch matrices: not re-entrant, fine for a single-thread
  frame loop.

## Examples

```ts
pointRootMatrix(
  { ellipsoid, worldFromEcef, place: station.geo, undulationM: n },
  root.matrix,
);
model.scale.setScalar(modelScale(model, item.sizeM));
```

## Tests

`editor3d-tour-root.test.ts`: NUE to east, up less N, south at the
frame's centre; a point's height where the ellipsoid puts it, away from
the centre; refusals; the model's largest side scaled to its size, a
model with no extent kept, a bad size refused.
