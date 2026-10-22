# editor3d-camera.ts

## Purpose

The 3D editor's camera: an orbit around the tour with the chosen design's
start and limits, the tilt the morph reads, and the clip planes that
follow the camera's clearance over the drawn ground.

## Public API

- `EDITOR_CAMERA` - `fovDeg` 50; `startOffset` [148, 210, 177] (m east,
  up, south of the centre: about 312 m out, 47.7 degrees from straight
  down); `minDistanceM` 2.5, `maxDistanceM` 1100; `maxPolarAngle` 1.48 rad.
- `EDITOR_CLIP` - `minNearM` 0.2, `farM` 8000, `fogStartM` 1400,
  `fogEndM` 5200.
- `startCameraPosition(target, out)` -> `out`, the start for an orbit
  around `target`.
- `tiltDegOf(polarAngleRad)` -> degrees from straight down. RangeError for
  an angle that is not finite.
- `editorClipPlanes({ ellipsoid, cameraEcef, samples })` -> `{ near, far }`:
  near is the globe's fraction (`GLOBE_CLIP.nearFraction`) of the smaller
  of the height over the ellipsoid and the clearance to the drawn-ground
  samples (`reliefClearanceM`), floored at 0.2 m; far is the globe's
  horizon or 8 km, whichever is nearer, and at least twice the near plane.
- `createEditorCamera({ domElement, target, aspect })` ->
  `{ camera, controls, tiltDeg(), dispose() }`: three's OrbitControls with
  damping, zoom to the cursor, no screen-space panning, and the limits
  above.

## Invariants & assumptions

- **The start is above the morph band** (47.7 > 42): the start view shows
  everything upright.
- **The editor's own clip floor and reach:** the globe's 1 m near floor
  clipped an item in front of a camera at the orbit's 2.5 m; 8 km is past
  the fog's end, where the view ends anyway.
- The page sets `near` and `far` every frame and updates the projection.

## Examples

```ts
const { camera, controls, tiltDeg } = createEditorCamera({
  domElement: canvas,
  target,
  aspect: w / h,
});
const { near, far } = editorClipPlanes({ ellipsoid, cameraEcef, samples });
```

## Tests

`editor3d-camera.test.ts`: the start where the design puts it, within its
limits; the start above the morph band; the tilt in degrees; the clip
planes following the clearance over the drawn ground, and falling back
to the height over the ellipsoid with no ground loaded.
