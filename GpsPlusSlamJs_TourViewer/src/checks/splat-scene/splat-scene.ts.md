# splat-scene.ts

## Purpose

The splat trainer's synthetic scene as pure geometry: a closed room (floor, four walls, ceiling) with an asymmetric object in its middle, the camera walks through it, the lens, the depth a camera would measure at each pose, and each surface's texture. Nothing here draws; `splat-scene-render.ts` renders the boxes and `splat-scene-zip.ts` writes the walk as a recording. Runs in node and in a browser (three.js maths only).

## Public API

- `SCENE_BOXES: readonly SceneBox[]` - every axis-aligned box (`name`, `kind` floor / wall / object, `min`, `max`, texture `seed`) (the room 12 m x 12 m, 3 m high); `OBJECT_CENTRE` the object's foot.
- `lookAt(eye, target) -> ScenePose` - an upright camera at `eye` looking at `target`. RangeError when the two coincide or the view is vertical.
- `sceneWalk(kind, frames, laps = 1) -> ScenePose[]`
  - `straight`: along +x at eye height on z = 3.5, 8 m long, looking towards -z over the object;
  - `loop`: `laps` times round the object at `LOOP_RADIUS_M` (3.5 m), facing it, the frames spread evenly over all laps, the last capture one step short of the first (walked twice, it is a revisit of every place);
  - RangeError for `frames` that is not an integer of at least 2, for `laps` that is not an integer of at least 1, and for a straight walk of more than one lap.
- `sceneProjection(width, height) -> Matrix4` - a centred perspective projection (column-major, float32 values), vertical half angle 0.6 rad, square pixels at the photo size. RangeError for sizes that are not positive integers.
- `castRay(origin, direction) -> { box, point } | null` - the first box a ray meets and the hit point; a box behind another is hidden by it.
- `sceneHitAt(pose, projection, screenX, screenY) -> { box, point } | null` - the first box the pixel ray at those screen coordinates (0 to 1, top-left origin) meets: what the photo shows there and what the depth sample measures.
- `sceneDepthSample(pose, projection, grid, timestamp) -> DepthSample` - a `grid` x `grid` sample at the sampler's screen positions `(i + 1) / (grid + 1)` (top-left origin), each point's z-depth along the camera's -z to `sceneHitAt`'s hit, as float32. RangeError for a grid that is not a positive integer.
- `distanceToScene(p) -> number` - metres from `p` to the nearest box face; 0 on a surface. What a reconstruction is measured against.
- `SURFACE_TINT` - each kind's RGB tint (0 to 1); red over blue about 1.5 floor, 0.9 wall, 0.45 object, which the browser check reads back from the photos.
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
  - `sceneHitAt` naming the object and the floor, and agreeing with every depth point;
  - `castRay` occlusion and a ray that meets nothing; `distanceToScene` on and off a surface;
  - the two-lap loop repeating the one-lap loop at half the step;
  - textures deterministic and distinct; every RangeError.
  - The twice-walked loop against the ownership rules (`splat-ownership.ts`), at ranges 4, 8, 20 and 40 m: at 4 and 8 m (16 m of walk at most) the second lap, 22 m later, is a revisit and owns none of the object's spots; at 20 and 40 m it is one pass and the nearest camera wins, so the second lap owns some. Wall spots are left out on purpose: beyond the range the nearest seeing camera owns a spot whatever the lap. Measured: object spots owned by the second lap 52 of 99 at 2 m (object out of range), 0 at 4 and 8 m, 26 at 12 m, 52 at 20 and 40 m.
