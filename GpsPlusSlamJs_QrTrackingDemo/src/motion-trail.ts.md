# motion-trail.ts

## Purpose

The QR demo's motion trail (QR near-frontal pose plan 2026-09-23-2314,
§26): the active code's positions over the last ~2 s, so a hand-held
code's path is visible next to its motion mode (owner: "a label, a colour
and a short motion trail"). Pure; `motion-trail-view.ts` draws it.

## Public API

- `createMotionTrail({ spanMs? })` -> `{ add(timestampMs, position),
points(), clear() }`.
  - `spanMs` (default 2000; a non-positive or non-number value takes the
    default): points older than the newest minus `spanMs` are dropped.
  - `add` ignores a non-finite time or position; a time EARLIER than the
    newest starts a new run (the old points are dropped).
  - `points()`: the kept positions, oldest first, as copies.
  - `clear()`: forget everything.
- `TrailPoint = [x, y, z]`.

## Invariants & assumptions

- Positions are whatever frame the caller feeds; `main.ts` feeds the raw
  single-frame QR position (`event.qrPoseWorld`, raw WebXR) and clears the
  trail on a tracking restart and when another code becomes active, so a
  line is never drawn across two frames or two codes.
- Never holds a caller's array: `add` copies in, `points` copies out.

## Examples

```ts
const trail = createMotionTrail();
trail.add(event.timestamp, event.qrPoseWorld.position);
view.update(trail.points(), color);
```

## Tests

`motion-trail.test.ts`: the span, the 2 s default, non-finite input
ignored, a backwards clock starts afresh, `clear`, copies in and out.
