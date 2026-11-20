# splat-ownership.ts

## Purpose

Decides, when the windows' splats are merged into one scene, which window
keeps a splat, and which splats a window crops as background shell.
Ownership depends on the splat's position only, so a spot is kept by at
most one window however many trained it.

## Public API

- `OwnershipCamera` - `{ position, rotation, window, along }`: a training
  camera of a window's core, raw WebXR pose, looking along its local -z;
  `along` is its distance along its segment's walk (`WalkPlan.along` of
  `walk-windows.ts`).
- `OwnershipWindow` - `{ segment }`, for revisits.
- `sees(camera, projection, point) -> boolean` - in front of the camera
  and inside the projection's side planes (column-major `Matrix4`; clip
  `|x| <= w`, `|y| <= w`, `w > 0`). Near and far planes are ignored: they
  are a renderer's choice, not a limit of what the camera saw.
- `createOwnership(cameras, windows, projection, ownRangeM) ->
{ ownerOf(point) }` - the window index, or -1. RangeError for a camera
  naming no window, a camera whose `along` is not finite, a camera too far
  from the origin to key (more than about 65 000 cells of `ownRangeM`) or
  a non-positive range.
- `shellCrop(points, cameraPositions, keepM) -> boolean[]` - true for a
  point within `keepM` of one of the window's cameras. The caller passes
  `keepFraction * shellDistance`. RangeError for a non-positive distance
  or a camera too far from the origin to key (as above, in cells of
  `keepM`).

## Rules

A point's seeing cameras are those that see it within `ownRangeM`.

1. The nearest seeing camera names a window; on equal distance the lower
   camera index wins.
2. Revisit: another window `w` is a revisit of that window `n` when they
   lie in different segments, or when every seeing camera of `w` is more
   than `2 * ownRangeM` along the walk from every seeing camera of `n`.
   Then the earliest such window `w0` marks the first pass: of the
   windows before `n` that are no revisit of `w0` (`w0` included), the
   one with the nearest seeing camera keeps the point (lower camera index
   on a tie). So a spot the walk came back to is kept by the first pass
   alone, never interleaved from two passes, and within that pass by its
   closest view: on an out-and-back walk the earliest window of the way
   out may see the spot from 36 m while a later window of the same pass
   stands 5 m from it.
3. Seen by no camera within range: the nearest camera that sees it at any
   distance (lower index on a tie).
4. Seen by none: -1, dropped by every window.

Windows that saw the spot on one pass share their seam by rule 1 alone,
however many windows apart they are: on a straight walk a window's
cameras see far ahead, into the windows after the next, and that is not a
revisit.

**Why `2 * ownRangeM`.** Two cameras that both see a point within range
are at most `2 * ownRangeM` apart in space. On one pass the walk between
them is about as long as that straight line, so their gap along the walk
stays near or under it; on a revisit the walk went away and came back, so
the gap along the walk is about the length of the loop. The threshold
misreads:

- a loop shorter than `2 * ownRangeM` along the walk (at the default 40 m,
  under 80 m), whose two passes are then shared by rule 1 like a seam;
- a single pass that winds (a zigzag whose walk is far longer than the
  straight line between two seeing cameras), which can read as a revisit.

Measured on the tests' synthetic walks: a straight walk needs the factor
above about 0.8 at 40 m (a gap of about 31 m between window 0's and
window 2's seeing cameras); a 220 m loop holds at 2x for every range up
to about 100 m.

These rules and the shell crop are PROVISIONAL: no sweep has compared them
yet (that needs the merged export). `ownRangeM` and `keepFraction` are
swept with them (`trainer-defaults.ts.md`).

## Invariants & assumptions

- **At most one window keeps a spot**: `ownerOf` is a function of the
  position.
- **A spot that only window A's cameras see is A's.**
- **A revisit never goes to the later window** when an earlier window
  that is a revisit of the nearest sees it in range.
- **Only core cameras.** In this window mode the overlap adds no camera:
  every overlap camera is another window's core camera, so the cameras
  passed are each window's core training cameras.
- Each camera uses the recording's one lens (`projection`) and its raw
  capture pose, as trained.
- Cameras are bucketed in a grid of `ownRangeM` cells keyed with the
  framework's `packCellKey` (`gps-plus-slam-app-framework/ar/cell-key`),
  range-checked with `cellCoordsInKeyRange` two cells inside the key's
  limit so a query's neighbours are always keyable; a point beyond that
  is farther than a cell from every camera and finds none. Rule 1 looks
  at the 27 cells around a point; rules 3 and 4 scan all cameras, only
  for points nothing sees in range.
- The revisit test merges the two windows' sorted `along` lists, so it
  costs their length, not its square.
- `distance` and `requirePositive` come from `splat-math.ts`.

## Examples

```ts
const own = createOwnership(cameras, plan.windows, inputs.projectionMatrix, 40);
const kept = splats.filter((s) => own.ownerOf(s.position) === w);
```

## Tests

- `splat-ownership.test.ts` - the view cone (behind, beside, turned
  around, clip planes ignored); nearest in range; none sees; seen only
  from beyond range, and a nearer camera beyond range losing to a farther
  one within it; a straight walk planned by `planWindows` never read as a
  revisit and a real loop read as one, each at ranges 20 / 40 / 80 m; a
  revisit to the earliest; an out-and-back walk
  whose spot goes to the nearest window of the first pass, not its
  earliest; a camera too far out to key refused and a spot far out
  answered by rules 3 and 4; a seam by the nearest; segments always a
  revisit; bad input; the shell crop.
- `splat-ownership.property.test.ts` - over random windows, segments,
  camera poses, distances along the walk and points: the keeping window is
  one that sees the point (or -1 when none does) and stable; a spot seen
  by one window's cameras only is that window's; exact against a
  brute-force reference of rules 1-4, also with cameras on shared integer
  positions to force ties; every spot of a straight forward walk (random
  heading, step, window length 15 / 30 / 60 m, range 20 / 40 / 80 m) its
  nearest seeing camera's; the shell crop exact against a brute-force
  check.
