# sheet-check.ts

**Purpose:** checks four aligned frames the way an author would look at them (does the mouth move, does the body stay still while talking, does the beckon differ, are the poses one size) and builds the "steady" variant whose talking frames keep the idle body.

## Public API

- `diffShare(a, b, s, dx?)`: the share of pixels differing by more than `diffThr`, compared at half resolution.
- `extents(img)`: the figure's top, bottom and height in a frame.
- `checkFrames(frames, s): FrameCheck`.
  - `bodyDiff`, `headDiff`, `beckonDiff`; per talking frame `{ body, head, headShift }`, where `headShift` is the best sideways shift within `maxShift`.
  - `jitter`: how much the body moves while talking; `figTop`, `figH`, `bandEnd` (where the head band ends, `headBand` of the figure).
  - `warnings`: `mouth` (the talking frames barely differ from idle in the head band, under `mouthMin`), `beckon-same` (the beckon is almost the idle pose), `beckon-left` (the beckon points left), `sizes` (the smallest pose is under 85 % of the tallest).
- `steadyBody(frames, check, s)`: frames 1 and 2 with the idle body under their own head band, blended over a smoothstep feather of `featherFrac`; frames 0 and 3 are the same objects.

## Invariants

- Warnings never refuse; the author decides (as drawn, or steady).
- Pure; never mutates the frames.

## Tests

`sheet-check.test.ts` (a still body passes, a jumping body is measured, each warning on a synthetic sheet made to trigger it, `steadyBody` keeps the idle body and the talking head).
