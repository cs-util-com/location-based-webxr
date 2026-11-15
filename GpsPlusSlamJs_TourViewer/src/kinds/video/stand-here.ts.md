# `kinds/video/stand-here.ts` - the rules of a stand-here video

## Purpose

Pure rules of the `standHere` free view: how far its projection has
developed from where the visitor stands and looks, when it starts, what the
card's guide line says, when its captions show and how the projection and
its footprints are shaded. Ported from the chosen station-blocks video
prototype's measures. `video-world.ts` drives them per frame,
`video-look.ts` draws the shade.

## Public API

- Measures:
  - `STAND_HERE_RAMP_M` `[4.5, 1]` - the ground distance from the spot (m)
    where it begins to develop, and where it is whole.
  - `STAND_HERE_FACE_DEG` `[32, 12]` - the angle between the view's middle
    and the video where it begins to develop, and where it is whole.
  - `STAND_HERE_RATE` 1.6 per second - how fast the develop eases.
  - `STAND_HERE_PLAYS_AT` 0.6 - a waiting video starts past it.
  - The guide (module-private): said until develop 0.55, "Face the video"
    within 1.2 m of the spot.
  - `STAND_HERE_CAPTIONS_AT` 0.5 - captions show past it.
- `standHereTarget(spotM, offDeg)` -> 0..1: the product of two smoothsteps;
  both null (no viewpoint) is 1; any other non-number is 0.
- `standHereDevelop(develop, target, dtS)` -> 0..1: an exponential ease,
  the same after one long step as after many short ones; a step that is no
  positive number is no step; the develop and the target are clamped to 0..1
  first (a non-finite one reads 0), so no input overflows into NaN.
- `standHereGuide(develop, spotM, hasViewpoint)` -> the line or null:
  "Stand on the footprints · N m" beyond the on-spot distance, "Face the
  video" on it, null once developed or without a viewpoint.
- `StandHereShade` / `standHereShade(develop, seconds)`: the clip's
  opacity, sepia tone, warm tint, ellipse feather, and the footprints' and
  their pulse's opacity.
- `standHereCaptions(develop)` -> whether captions show.

## Invariants & assumptions

- The creator's start trigger is never read: standing there is the start.
- Walking off or turning away fades the projection back toward the ghost;
  a video that started keeps playing while the visitor is there.
- Time to play on the spot, facing it, from 0: `-ln(1 - 0.6) / rate`,
  0.57 s at 1.6/s (0.37 to 0.92 s over rates 1 to 2.5/s). Facing it
  straight, the target passes the play threshold within about 2.5 m of the
  spot.

## Examples

```ts
const target = standHereTarget(spotM, offDeg);
develop = standHereDevelop(develop, target, dt);
if (develop > STAND_HERE_PLAYS_AT) start();
```

## Tests

- `stand-here.test.ts` - each measure's edge, the guide lines, captions,
  the shade at 0 and 1, nonsense input.
- `stand-here.property.test.ts` - develop stays in 0..1 and one long step
  equals many short ones.
- `video-world.test.ts` - the rules driven by frames.
