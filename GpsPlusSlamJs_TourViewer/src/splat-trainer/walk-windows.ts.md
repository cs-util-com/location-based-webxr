# walk-windows.ts

## Purpose

Cuts a recorded walk into the units the splat trainer trains one at a
time: segments between tracking jumps, hold-outs for evaluation chosen
over the whole walk, and windows along each segment that overlap a little
at their seams. Pure functions over frame indices.

## Public API

- `WalkFrame` - `{ position, capturedAt }`; the reader's captures
  (`recording-reader.ts`) satisfy it.
- `jumpSegments(frames, jumpSpeedMPerS) -> number[][]` - runs of
  consecutive frame indices. A step between two timed frames faster than
  the jump speed starts a new run; a step with movement and no time
  passing (or time going back) is an infinite speed; a step with an
  untimed frame on either side never cuts. RangeError for a non-positive
  or non-finite speed.
- `holdoutIndices(count, every) -> Set<number>` -
  `i % every === floor(every / 2)`: the middle of every block, never the
  first frame. RangeError for `every` below 2 or not an integer.
- `planWindows(frames, settings) -> WalkPlan` - `{ segments, holdouts,
along, windows }`. `along[i]` is frame `i`'s distance along its
  segment's walk from the segment's first frame (m); ownership decides a
  revisit by it (`splat-ownership.ts`). Each `WalkWindow`:
  - `segment` - its segment's index;
  - `core` - its frames, hold-outs included; the cores partition the
    walk, except the frames of a segment with no training frame at all
    (a segment of hold-outs alone), which get no window;
  - `train` - its core's non-hold-outs plus its segment's non-hold-outs
    within `overlapFraction * windowM` along the walk of the core's first
    and last frame;
  - `holdouts` - its core's hold-outs, topped up while fewer than
    `minHoldouts` with the segment's other hold-outs nearest the core
    along the walk (from either side; on a tie the earlier frame), so a
    window is scored where it trained, not at the far end of a
    neighbour;
  - `tooFewHoldouts`, `tooFewFrames` - the shortfalls a caller shows.

## Invariants & assumptions

- **One window mode: by distance along the walk, in walk order** (time
  mode, the measured choice). The open alternative is a mode by place,
  where a revisited spot is trained by one window from every pass: it
  scored about +1 dB at a revisited place, at three times the frames and
  time, so it is recorded here and not built.
  Frames are binned by their distance along the segment in bins of
  `windowM`; a group with fewer than `minFrames` training frames absorbs
  the bins after it until it reaches `minFrames`, and a short last group
  joins the one before it; a window over `maxFrames`
  is split into `ceil(train / max)` parts of equal training count, a
  hold-out going with the training frame before it. With
  `maxFrames >= 2 * minFrames` (validated) no split part is under the
  minimum, so a core under `minFrames` exists only for a segment that
  short as a whole (`tooFewFrames`).
- **Hold-outs are global.** Chosen over the whole walk before any cut, so
  no hold-out is in any training set, overlap included, and a frame's
  role never depends on the window length.
- **No window crosses a segment**: cores, overlap and borrowed hold-outs
  all stay in the window's segment. The two sides of a jump are in
  different frames of reference.
- **A window always has something to train.** A core with no training
  frame is dropped (only a segment of hold-outs alone, such as one frame
  between two jumps, makes one); the budgets could not size it and the
  trainer could not run it.
- Distances are straight steps between consecutive frames of a segment
  (`distance` and `requirePositive` come from `splat-math.ts`).
- Defensive: settings are validated (RangeError); frames are trusted to
  carry finite positions (the reader refuses any other).

## Examples

```ts
const plan = planWindows(inputs.captures, TRAINER_DEFAULTS);
for (const w of plan.windows) train(w.train, w.holdouts);
```

## Tests

- `walk-windows.test.ts` - jump cuts (fast step, zero time, untimed), the
  hold-out rule, window cutting, the overlap's frames, merging a short
  tail, splitting a dense window, hold-out borrowing nearest-first and its
  shortfall, the distance along the walk, a window with nothing to train
  dropped, no window across a jump, settings rejected.
- `walk-windows.property.test.ts` - over random walks (turns, jumps,
  untimed frames) and settings over the swept ranges: every frame of a
  segment with something to train in exactly one core, and every window
  with a training frame; the distance along the walk exact; no hold-out
  trained on; everything inside one
  segment; core training counts within the limits; hold-out borrowing
  exact.
