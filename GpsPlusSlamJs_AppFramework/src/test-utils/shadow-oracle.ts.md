# shadow-oracle.ts

## Purpose

The analytic ground truth for where a directional light's shadow falls
(W4 AR shadows plan `GpsPlusSlamJs_Docs/docs/2026-09-26-0549-ar-shadows-on-occlusion-mesh-plan.md`,
M1). Pure, no three.js, no GPU. The M2 synthetic pixel page (the
`labs/ar-shadows/` look-dev lab, DEC-PRG-2) places its probe pixels with it and asserts dark
inside, clear outside. Test-only: it lives in `test-utils/` (reached through
the `./test-utils/*` subpath) and is re-exported by no barrel, so it stays
off the package's root export surface.

## Public API

- Types: `SphereCaster {kind:'sphere', centre, radius}`,
  `BoxCaster {kind:'box', centre, halfExtents, rotation?}` (unit quaternion
  `[x, y, z, w]`, three's `Quaternion.toArray()` order), `Caster`,
  `PlanePoint [x, z]`, `PlaneEllipse`, `ProbeClass`. `Vec3` is the rig's
  (`sun-shadow-rig.ts`), not a second copy.
- `inShadow(sunDir, q, casters): boolean` - the ray view: the ray
  `q + t·sunDir`, t > 0, hits a caster. Any receiver shape.
- `lightSpaceSignedDistance(sunDir, q, casters): number` - metres,
  perpendicular to `sunDir`, from q's ray to the silhouette edge; negative
  inside, `Infinity` when nothing lies ahead. Over several casters the
  minimum: exact outside, conservative inside.
- `sphereShadowOnPlane(sunDir, sphere, planeY): PlaneEllipse` - semi-axes r
  (across the azimuth) and r / s_y (along it), centre
  `C - ((C_y - h0) / s_y) · s`.
- `boxShadowOnPlane(sunDir, box, planeY): PlanePoint[]` - convex hull of the
  8 corners projected along the sun (counter-clockwise in (x, z)).
- `insideEllipse(e, p, k = 1)`, `convexHull2`, `polygonArea`,
  `convexPolygonSignedDistance`, `projectAlongSun`, `boxCorners` - the
  helpers the known answers are built from, exported for the tests and M2.
- `shadowTexelM(R, N)` = 2R / N; `maxInsideMarginTexels(radius, R, N)` = the
  deepest inside-probe margin a sphere allows (below the swept margin, the
  configuration cannot be judged).
- `classifyProbe(sunDir, q, casters, {texelM, marginTexels})` -
  `'inside' | 'outside' | 'edge'`: the light-space disk of the margin around
  q's ray is wholly shadowed, wholly lit, or neither (no verdict).

## Invariants and assumptions

- `sunDir` is the unit vector TOWARD the light (tolerance 1e-6); the plane
  functions also need it above the horizon (s_y > 0).
- Frame-agnostic, y up, like the rig.
- Casters are closed, except a caster's own light-facing surface is lit
  (t > 0 strictly): a ball's cap is lit, its underside dark.
- Margins are LIGHT-SPACE distances, because a shadow-map texel is a square
  in that space. On a flat floor a ground distance dP maps to between
  dP·sin(e) and dP (property-tested), so a ground margin is never reused as
  a texel margin.
- The plane footprints require the caster wholly above the plane (they throw
  otherwise); the ray and light-space views have no such limit.
- Validation: every public function throws `RangeError` for non-finite or
  non-unit directions, non-finite points, non-positive radii or extents, a
  non-unit quaternion, a negative margin or a non-positive texel.

## Examples

```ts
const s = [Math.cos(0.5), Math.sin(0.5), 0] as const; // ~28.6 deg up, toward +x
const ball = { kind: 'sphere', centre: [0, 0.5, 0], radius: 0.08 } as const;
inShadow(s, [-0.9, 0, 0], [ball]); // true: under the ellipse
const texelM = shadowTexelM(5, 1024); // 0.98 cm
classifyProbe(s, [-0.9, 0, 0], [ball], { texelM, marginTexels: 4 }); // 'inside'
```

## Tests

- `shadow-oracle.test.ts` - hand-computed answers: the overhead circle, the
  30-degree ellipse (-sqrt(3) centre, 2r semi-major), the resting ball under
  the framework `SUN_LIGHT` (63.4 degrees), the 45-degree cube rectangle
  (area 2), the rotated-cube hexagon (area 1 + sqrt(2), by the face-sum projection formula), the
  light-space compression by sin(e), the small-ball feasibility of R 25 / N
  1024 (radius 1.64 texels), and the margin honoured on both sides of the
  edge for 2-8 texels.
- `shadow-oracle.property.test.ts` - over random suns (10-90 degrees),
  spheres and oriented boxes: ellipse and hull agree with the ray, hull
  area obeys the face-sum projection formula, the light-space sign agrees with
  the ray, the ground/light-space bound, and `classifyProbe` soundness for
  R {5, 10, 25} x N {512, 1024, 2048} x margin {2, 3, 4, 6, 8}.
