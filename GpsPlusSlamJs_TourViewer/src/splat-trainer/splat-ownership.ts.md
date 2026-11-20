# splat-ownership.ts

## Purpose

Decides, when the windows' splats are merged into one scene, which window
keeps a splat, and which splats a window crops as background shell.
Ownership depends on the splat's position only, so a spot is kept by at
most one window however many trained it.

## Public API

- `OwnershipCamera` - `{ position, rotation, window }`: a training camera
  of a window's core, raw WebXR pose, looking along its local -z.
- `OwnershipWindow` - `{ segment }`, for adjacency.
- `sees(camera, projection, point) -> boolean` - in front of the camera
  and inside the projection's side planes (column-major `Matrix4`; clip
  `|x| <= w`, `|y| <= w`, `w > 0`). Near and far planes are ignored: they
  are a renderer's choice, not a limit of what the camera saw.
- `createOwnership(cameras, windows, projection, ownRangeM) ->
{ ownerOf(point) }` - the window index, or -1. RangeError for a camera
  naming no window or a non-positive range.
- `shellCrop(points, cameraPositions, keepM) -> boolean[]` - true for a
  point within `keepM` of one of the window's cameras. The caller passes
  `keepFraction * shellDistance`. RangeError for a non-positive distance.

## Rules

1. Of the cameras that see the point within `ownRangeM`, the nearest
   names a window.
2. Revisit: if another window that sees it within range is not that
   window's neighbour (another segment, or more than one window apart),
   the earliest such window keeps it. A spot the walk came back to is
   kept whole by one window, never interleaved from two.
3. Seen by no camera within range: the nearest camera that sees it at any
   distance.
4. Seen by none: -1, dropped by every window.

Neighbours share their seam by rule 1 alone.

These rules and the shell crop are PROVISIONAL: no sweep has compared them
yet (that needs the merged export). `ownRangeM` and `keepFraction` are
swept with them (`trainer-defaults.ts.md`).

## Invariants & assumptions

- **At most one window keeps a spot**: `ownerOf` is a function of the
  position.
- **A spot that only window A's cameras see is A's.**
- **A revisit never goes to the later window** when an earlier,
  non-neighbouring window sees it in range.
- **Only core cameras.** In this window mode the overlap adds no camera:
  every overlap camera is another window's core camera, so the cameras
  passed are each window's core training cameras.
- Each camera uses the recording's one lens (`projection`) and its raw
  capture pose, as trained.
- Cameras are bucketed in a grid of `ownRangeM` cells, so rule 1 looks at
  the 27 cells around a point; rules 3 and 4 scan all cameras, only for
  points nothing sees in range.

## Examples

```ts
const own = createOwnership(cameras, plan.windows, inputs.projectionMatrix, 40);
const kept = splats.filter((s) => own.ownerOf(s.position) === w);
```

## Tests

- `splat-ownership.test.ts` - the view cone (behind, beside, turned
  around, clip planes ignored); nearest in range; none sees; seen only
  from beyond range; a revisit to the earliest; a seam by the nearest;
  segments never neighbours; bad input; the shell crop.
- `splat-ownership.property.test.ts` - over random windows, segments,
  camera poses and points: the keeping window is one that sees the point (or
  -1 when none does) and stable; a spot seen by one window's cameras only
  is that window's; never the later of two non-neighbouring windows that
  both see it in range; the shell crop exact against a brute-force check.
