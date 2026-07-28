# `model/multipolygon-builder.ts`

## Purpose

Stitches multipolygon relation member ways into closed rings, and assigns holes
to the outer rings that contain them.

## Public API

- `stitchRings(segments)` → `{ ok: true, rings } | { ok: false, unclosed }`.
- `isClosedRing(positions)` → boolean.
- `isPointInRing(point, ring)` → boolean (ray casting).
- `groupRingsIntoPolygons(outerRings, innerRings)` → `Ring[][]`, each entry
  being outer-ring-first followed by its holes.
- `signedRingArea(ring)` → shoelace area **in squared degrees**.
- `Ring` — `readonly LatLng[]`, first position equals last.

## Invariants & assumptions

- **Ported from `OsmExtensions.CombineToClosedArea`, generalised twice:**
  - _Any number of rings._ The reference stitches everything into one ring and
    throws if that fails; a real multipolygon can have several outer rings, each
    split across several ways.
  - _Per-segment reversal._ The reference reverses its accumulated result when
    orientation flips, which only survives a single flip. Reversing the incoming
    segment instead handles arbitrarily many, and is why the property test can
    randomly reverse every segment.
- **Chains grow at both ends.** Attaching only at the tail fails when the seed
  segment happens to sit in the middle of a chain.
- **Failure is returned, never thrown**, and carries the partial chains — that
  is what makes a broken relation debuggable rather than merely invalid.
- **Endpoint matching is exact** (see `positionsEqual` in `osm-feature.ts`).
- **`isPointInRing` works in raw degrees.** Correct here because containment is
  purely topological — no distance or area is computed — so the degree
  anisotropy that matters elsewhere (plan §4.5) is irrelevant. **The
  antimeridian is not handled**; a multipolygon spanning it would need splitting
  first, and none exist at the scales this package works at.
- **`signedRingArea` is in squared degrees and is only ever compared
  ring-to-ring** (smallest-containing-ring selection). It is not a real-world
  area and must never be reported as one — squared degrees vary with latitude.
- **A hole contained by nothing is dropped**, not attached to an arbitrary outer
  ring. Silently punching a hole in the wrong building is worse than ignoring a
  malformed member.
- **Nested holes attach to the smallest containing ring**, so a shed inside a
  courtyard inside a block belongs to the courtyard.

## Complexity

`stitchRings` is O(n²) in the number of segments in the worst case (each
extension rescans the pool). Real relations have tens of members, not
thousands, and the constant is tiny; if a pathological relation ever shows up,
the fix is an endpoint hash map, not a library.

## Examples

```ts
const stitched = stitchRings(outerWayGeometries);
if (!stitched.ok) {
  return fail(
    "unclosable-ring",
    relation,
    `${stitched.unclosed.length} open chains`,
  );
}
const polygons = groupRingsIntoPolygons(stitched.rings, innerRings);
```

## Tests

- `multipolygon-builder.property.test.ts` — a ring is cut into pieces, shuffled
  and randomly reversed, then must always stitch back into exactly one closed
  ring; order-independence; disjoint rings never merge; a missing segment
  reports failure; point-in-ring translation invariance; hole assignment by
  containment and by smallest-containing-ring; area sign/magnitude behaviour.
- Example coverage of the stitcher through `osm-geometry.test.ts`.
