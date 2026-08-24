# Synthetic Depth Samples at Exact World Points (test-only helper)

## Purpose

Builds `DepthSample`s whose points unproject EXACTLY to chosen raw-WebXR world positions, through the real perspective-projection path. Complement of `synthetic-occupancy-grid.ts`, which is limited by design boundary to solid box slabs seen from the origin with an identity projection: this helper serves tests that need arbitrary geometry (floors, slopes, noise clusters) observed from an arbitrary camera pose — first consumer is the floor-estimator suite.

## Public API

- **`makeWorldPointSample(cameraPos, worldPoints, cameraRot = LOOK_DOWN) → DepthSample`** — forward-projects each world point (world → view → clip → normalized screen + z-depth) with the same wide-FOV matrix `createDepthUnprojector` will invert. Throws `Error` on a fixture-authoring mistake (a point behind the camera or outside the frustum) so a bad test setup fails loudly instead of silently thinning the grid.
- **`surfacePatch(yAt, extentM, stepM, centerX = 0, centerZ = 0) → Vector3[]`** — regular XZ lattice of surface points spanning `±extentM` around the center, `y` given per `(x, z)` (constant for a flat floor, `x`-linear for a slope, …).
- **`LOOK_DOWN` / `LOOK_UP`** — ±90° pitch quaternions (camera looking straight down / up).
- **`WIDE_TEST_PROJECTION`** — the serializable ~126° square-aspect projection carried by every built sample (`tan(1.1) ≈ 1.96`, so a head-height downward camera sees a metres-wide patch; the default 60° matrix used elsewhere in the tests would clip it).

## Invariants & assumptions

- Round-trip accuracy: `addSample` unprojects each built point back to its world position up to f32 projection round-off — well under a millimetre at room scale, far inside a 15 cm cell.
- Points must satisfy the frustum: `|transverse| / depth < tan(1.1) ≈ 1.96` relative to the camera's view direction; violations throw at build time (never a silently smaller grid).
- Samples go through the genuine fold pipeline (carving included). Because all carving inside one `addSample` happens before any endpoint increment, every placed point's cell is occupied after the call; unlike `synthetic-occupancy-grid.ts` this helper does NOT disable carving, so tests layering multiple samples must order them so later rays cannot pass through earlier surfaces (e.g. add below-floor noise BEFORE the floor above it).
- Test-only: lives in `src/test-utils/` (vitest tsconfig project), is not a tsdown entry, and must never be imported by production code.

## Examples

```ts
const camera: Vector3 = [0, 1.7, 0];
const floor = surfacePatch(() => 0, 0.9, 0.15); // flat floor at y = 0
grid.addSample(makeWorldPointSample(camera, floor)); // camera looks straight down

const slope = surfacePatch((x) => 0.21 * x, 0.9, 0.15); // 12° incline
const ceiling = makeWorldPointSample(
  [0, 0.5, 0],
  surfacePatch(() => 2, 0.6, 0.15),
  LOOK_UP
);
```

## Tests

Exercised (and thereby covered) by `../ar/floor-estimator.test.ts` and `../ar/floor-estimator.property.test.ts`; the throwing fixture guards make any drift from the unprojection convention fail those suites loudly.
