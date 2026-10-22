# `mesh/enu.ts`

## Purpose

WGS84 degrees to local East-North-Up metres, anchored at one origin.

## Public API

- `enuFrameAt(origin): EnuFrame` — `toEnu`, `toLatLng`, `origin`
- `ENU_METRES_PER_DEG_LAT` (39,940,652.7422 / 360, about 110,946.26) and
  `ENU_METRES_PER_DEG_LNG_EQUATOR` (40,075,016.6856 / 360, about 111,319.49,
  times `cos(originLat)` in a frame): the frame's ruler.
- `ringToEnu(ring, frame): EnuPoint[]`
- `signedArea2(ring): number` — **positive means counter-clockwise**
- `isCounterClockwise(ring): boolean`

## Invariants & assumptions

- **All mesh geometry is built in metres, never in degrees. The constants are pinned there and in
  `mesh-orientation.test.ts` and `barrier-gates.test.ts` (their fixtures are
  built with the frame's own ruler).** A degree of
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
- **One ruler with the AR core** (globe city plan 2026-10-05-0040 §14, the
  owner's D-K7, 2026-10-06). The two numbers are `gps-plus-slam-js`'s, whose
  `calcRelativeCoordsInMeters` places the phone in AR while this frame places
  the city; they must agree, or every building stands off the phone by the
  difference. Until 2026-10-06 this frame used 111,320 m both ways: 0.34 %
  longer north-south than the core (3.4 m at 1 km). Neither ruler is the true
  ellipsoid (about 111,170 m a degree north at 47 N, so 0.2 % off), which a
  consumer drawing the true Earth (the globe) corrects locally. OsmDemo's
  `one-ruler.test.ts` compares the two conversions themselves.
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
