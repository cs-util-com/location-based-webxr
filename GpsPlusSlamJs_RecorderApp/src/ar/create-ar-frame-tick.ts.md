# ar/create-ar-frame-tick.ts

## Purpose

Builds the recorder's per-XR-frame callback — the `onFrame` slot of
`ArSessionCallbacks` — which advances everything that has to move at render
cadence rather than at GPS cadence.

## Public API

- `createArFrameTick(deps: ArFrameTickDeps): () => void` — returns the tick.
  Calling the returned function advances, in order: the perf stats overlay,
  the alignment lerper, the camera follower, and the map overlay's
  reprojection. No return value, no error modes — it makes only optional-chained
  calls, so an empty resources record is a no-op.
- `ArFrameTickDeps`:
  - `resources: ArSessionResources` — every driven object is read from here at
    fire time.
  - `getCamera: () => THREE.Camera | null` — the live render camera; `null`
    before the renderer exists or between sessions.

## Invariants & assumptions

- **`dt` is in SECONDS**, measured between successive ticks (the first tick
  measures from construction time). Both the lerper and the follower are
  frame-rate-independent smoothers and would overshoot ~1000× on milliseconds.
- **Resources are read at fire time.** The tick is constructed before `initAR`,
  when most slots are still `null`; it must pick up whatever appears later. It
  therefore never caches a slot into a local across calls.
- **The lerper is NOT camera-gated.** Alignment interpolation continues when
  `getCamera()` returns `null`; only the follower depends on the camera.
- **The map is reprojected only while visible.** That reprojection is the most
  expensive step in the tick, and the overlay is hidden for most of a session.
- **Keep it cheap.** This runs on every rendered frame of every session. Work
  that can be driven by a store subscription or a throttle belongs in
  [`wire-ar-scene.ts`](wire-ar-scene.ts.md) instead.

## Examples

```ts
const sessionCallbacks: ArSessionCallbacks = {
  // …
  onFrame: createArFrameTick({ resources: arSessionResources, getCamera }),
};
```

## Tests

`create-ar-frame-tick.test.ts` (fake timers) pins: seconds-not-milliseconds
`dt` across successive ticks; no-throw on a fully empty record; pickup of a
resource created after the tick was built; the lerper still advancing with no
camera; the map reprojecting only while visible and receiving the live camera;
and the follower's `(camera, dt)` argument order.
