# splat-scene.ts

## Purpose

The splat trainer's synthetic scene as pure geometry: a closed room (floor, four walls, ceiling) with an asymmetric object in its middle, the camera walks through it, the lens, the depth a camera would measure at each pose, and each surface's texture. Nothing here draws; `splat-scene-render.ts` renders the boxes and `splat-scene-zip.ts` writes the walk as a recording. Runs in node and in a browser (three.js maths only).

## Public API

- `SCENE_BOXES: readonly SceneBox[]` - every axis-aligned box (`name`, `kind` floor / wall / object, `min`, `max`, texture `seed`) (the room 12 m x 12 m, 3 m high); `OBJECT_CENTRE` the object's foot.
- `lookAt(eye, target) -> ScenePose` - an upright camera at `eye` looking at `target`. RangeError when the two coincide or the view is vertical.
- `sceneWalk(kind, frames) -> ScenePose[]`
  - `straight`: along +x at eye height, 8 m long, looking over the object;
  - `loop`: once round the object at `LOOP_RADIUS_M` (3.5 m), facing it, the last capture one step short of the first;
  - RangeError for `frames` that is not an integer of at least 2.
- `sceneProjection(width, height) -> Matrix4` - a centred perspective projection (column-major, float32 values), vertical half angle 0.6 rad, square pixels at the photo size. RangeError for sizes that are not positive integers.
- `sceneDepthSample(pose, projection, grid, timestamp) -> DepthSample` - a `grid` x `grid` sample at the sampler's screen positions `(i + 1) / (grid + 1)` (top-left origin), each point's z-depth along the camera's -z, as float32. RangeError for a grid that is not a positive integer.
- `surfaceTexture(kind, seed, size) -> Uint8Array` - RGBA, the feature-match benchmark's corner-rich grey texture (`syntheticTexture`) tinted by kind.

## Invariants & assumptions

- Poses are raw WebXR: metres, +y up, cameras look along local -z, rotations `[x, y, z, w]`. `lookAt` gives the same rotation as the recorder's test walks (`lookAtPose`), up to the sign of the quaternion.
- The room is closed, so every ray from inside meets a surface and every depth point is measured.
- Depth is z-depth (along the camera's -z), the convention `createDepthUnprojector` reads: unprojecting a point gives a point on the scene.
- The object (a low block, an upright on its +x end, a thin post towards -x and +z) is mapped onto itself by no mirror in x or z and no half turn, so a trainer that flips or turns a camera shows it.
- Every box has its own texture seed; the same seed gives the same bytes.

## Examples

```ts
const projection = sceneProjection(320, 240);
const poses = sceneWalk("loop", 24);
const depth = poses.map((p, i) =>
  sceneDepthSample(p, projection, 8, t0 + i * 500),
);
```

## Tests

- `splat-scene.test.ts`:
  - poses against the test walks' `lookAtPose`;
  - the straight walk evenly spaced, upright and seeing the object (`sees`);
  - the loop closed on itself and facing the object;
  - the object's asymmetry; square pixels;
  - the depth straight ahead to the far wall (9.5 m);
  - every depth point, unprojected by the framework, lying on a box;
  - textures deterministic and distinct; every RangeError.
