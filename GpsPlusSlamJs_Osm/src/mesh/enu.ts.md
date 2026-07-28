# `mesh/enu.ts`

## Purpose

WGS84 degrees to local East-North-Up metres, anchored at one origin.

## Public API

- `enuFrameAt(origin): EnuFrame` — `toEnu`, `toLatLng`, `origin`
- `ringToEnu(ring, frame): EnuPoint[]`
- `signedArea2(ring): number` — **positive means counter-clockwise**
- `isCounterClockwise(ring): boolean`

## Invariants & assumptions

- **All mesh geometry is built in metres, never in degrees.** A degree of
  longitude is ~111 km at the equator and ~71 km at 50.8° N — a ~36 % anisotropy
  that shears buildings. Web Mercator does not fix it: its scale factor there is
  ~1.58, so unprojected Mercator metres are 58 % too long. Both errors are
  smooth and plausible, which is what makes them expensive to find.
- **The frame is anchored, not free.** The longitude scale depends on latitude,
  so recomputing `cos(lat)` per point would make two points at different
  latitudes use different scales and silently curve straight walls.
- **`signedArea2` is the plain shoelace sum.** The trapezoid variant computes the
  same magnitude with the OPPOSITE sign, and mixing the two makes a triangulator
  clip reflex vertices. Not hypothetical: it shipped in the first draft of
  `triangulate.ts` and turned a 300 m² result into 750 m². The differential test
  against `earcut` is what found it — convex shapes hid it completely.
- Accuracy is ~0.05 % over a 3 km scene, far below OSM's own footprint error.
- The origin should be near the content, or float32 vertex buffers lose
  precision where it matters.

## Examples

```ts
const frame = enuFrameAt(userPosition);
const ring = ringToEnu(feature.geometry, frame);
```

## Tests

`buildings.test.ts` — the metre conversion and its latitude scaling, the round
trip, and a square footprint staying square in metres where it differs by ~36 %
in degrees.
