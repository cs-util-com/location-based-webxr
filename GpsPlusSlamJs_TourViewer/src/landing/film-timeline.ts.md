# film-timeline.ts

## Purpose

The hero film's clock as pure maths: where each of the eight parts sits on
one timeline of seconds, what the film shows at a position (part, phase,
the part's own moment) and where the camera is. The film is a pure
function of this one number, so pausing, jumping and redrawing are free.

## Public API

- `createTimeline<V>(beats: readonly BeatSpec<V>[], pace: TimelinePace): Timeline<V>`
  - `BeatSpec`: `{ durS, views: [{ atS, view }] }`; the first view at `atS`
    0, later ones strictly rising inside the part (a camera move within the
    part, as the last part does).
  - `TimelinePace`: `{ speed, holdS, camS, settleS }`.
  - Throws `RangeError` for no parts, a non-finite or non-positive length,
    a part without a view at 0, views out of order, or a bad pace.
- `Timeline`:
  - `totalS`, `segments: Segment[]` (`{ index, startS, leadS, actS, holdS, endS }`).
  - `positionAt(t): FilmPosition` (`{ beat, phase: "lead" | "act" | "hold", storyT, segmentProgress, finished }`).
  - `cameraAt(t): { from, to, k }`: `k` is the move's linear progress
    in [0, 1] (the scene eases it); standing still is `k` 1.
  - `startOf(i)`: where part `i` starts; `RangeError` for no such part.

## Invariants

- A part's segment is lead, then act, then hold:
  - lead: the camera move (`camS`) when the part opens on another view,
    else `settleS`; part 0 has none. The story shows the part at moment 0
    while the camera arrives, so one thing moves at a time.
  - act: `durS / speed`.
  - hold: `holdS` after every part but the last (the caption is read).
- `totalS` is the sum of the segments; positions are clamped to
  [0, totalS]; NaN and -Infinity read as 0, +Infinity as the end.
- `positionAt` is monotone in `t`; `startOf(i)` maps back to part `i`.

## Example

```ts
const tl = createTimeline(FILM_BEATS, {
  speed: 0.75,
  holdS: 1.5,
  camS: 1.1,
  settleS: 0.22,
});
const p = tl.positionAt(12.3); // { beat: 2, phase: "act", storyT: ..., ... }
```

## Tests

`film-timeline.test.ts` (beat at a time, lengths with speed and hold,
jumps, camera moves, validation) and `film-timeline.property.test.ts`
(monotone, start of each part maps back to it, total, camera `k` in range).
