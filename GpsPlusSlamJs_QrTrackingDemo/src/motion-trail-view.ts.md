# motion-trail-view.ts

## Purpose

Draws the QR demo's motion trail (`motion-trail.ts`, plan §26) as a
three.js line in the motion mode's colour, under `arWorldGroup`.

## Public API

- `createMotionTrailView(parent)` -> `{ update(points, color), dispose() }`.
  - `update`: the line through `points` (oldest first) in `color` (a CSS
    colour string; `null` = white). Hidden below two points.
  - `dispose`: detaches it from `parent` and frees the geometry and
    material.

## Invariants & assumptions

- **Frame:** the points are raw-WebXR positions (like the QR pose), while
  `arWorldGroup`'s local space is NUE, so the line hangs off a static
  `WEBXR_TO_NUE` basis node - the same construction as the framework's
  `qr-debug-view.ts`. Without it the trail would sit East/North-swapped
  beside the code on a device.
- The geometry's position attribute is replaced on each update (a trail is
  ~16 points at 8 Hz); frustum culling is off so the moving bounds are
  never stale.

## Examples

```ts
const trailView = createMotionTrailView(arWorldGroup);
trailView.update(trail.points(), MOTION_COLORS[state]);
```

## Tests

`motion-trail-view.test.ts`: the basis node (WEBXR_TO_NUE, no auto
update) under the parent, hidden below two points, the positions written,
the colour and its neutral default, `dispose` detaches.
