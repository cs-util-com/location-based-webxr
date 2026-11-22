# travelling-box.ts

## Purpose

The travelling box's controller: the imperative shell around the pure
rules (`travelling-box-rules.ts`). For one travelling surface
(`travel-surface.ts`) it paints one canvas texture, hangs it on the
surface's plate in the world, measures the plate every frame, decides
with the rules whether the plate, the dock or nothing shows, and flies
the texture between plate and dock on a screen-space quad
(`travelling-box-quad.ts`). It forwards fingers on the plate or the
flying quad to the surface's ghost, which takes them itself at the dock.

One texture, drawn on the plate (u = 0) or on the quad (u > 0), never
both; the DOM ghost is invisible and takes pointers only at u = 1.

## Public API

- `createTravellingBox(deps)` returns a `TravellingBox`. `deps`:
  - `surface`, `scene` (the quad is added to it), `camera` (the frame's
    camera, for the measuring), `knobs`;
  - `now()` (ms), `reduceMotion()`, `viewRect()` (the drawing area on the
    page, `TravelViewRect`);
  - optional: `createCanvas()` (default a new DOM canvas), `upload(texture)`
    (e.g. `renderer.initTexture`, so the upload is not in the draw),
    `onPlace(event)` (each settled change: `{ at, surface, place, why }`),
    `onFrame(sample)` (each frame as measured, a `TravelFrameSample`:
    the time `at`, the settling step `dtS` this frame counted (0 on the
    first frame, at most 0.1 s), `first` on the controller's first frame,
    surface, travelling, hide reason, slot, fold, finger, the settled
    place, the want and why, the metrics, the angle, the eye's ground
    distance `distM` and the lens's `pxPerM`, `proj[5] x height / 2`; the
    sample is built only when `onFrame` is given, so a page without the
    field log (`travelling-box-log.ts`) allocates nothing for it),
    `slotFree()` (default true; the page decides who holds the slot),
    `registry` (the page's `travel-registry.ts`: the box joins it when
    made and leaves it on `stop()`).
- `TravellingBox`:
  - `frame()`: one step; call once per animation frame, after the camera
    and the scene are placed and before the render;
  - `hit(x, y)`: `{ quad, depth, linePx }` when page point (x, y) is on the
    drawn words and they take a finger there, else null;
  - `pointerDown(e, target)`: begins a forwarded press when `hit` says so,
    captures the pointer on `target` and listens there for move, up,
    cancel and `lostpointercapture`; false when not taken;
  - `ownsTap()`: a press is down, or ended less than `CLOSING_TAP_GRACE_MS`
    ago (the XR select that follows a finger must not also act);
  - `pressing()`, `state()` (`TravellingBoxState`: surface id, place, why,
    want, u, presence, metrics, angle, which mesh shows, the ghost's
    pointer, the plate's and the drawn quad's corners relative to the
    view in polygon order TL TR BR BL, the dock rect, both texture ids,
    paints), `cost()` (`TravellingBoxCost`);
  - `stop()`: ends a press, leaves the registry, disposes the quad and
    the texture (and takes it off the plate's material), unhangs the
    plate, gives the plate back at full opacity, and gives the ghost its
    pointers and its visibility back. Idempotent; every later call is a
    no-op, and `hit` answers null from then on.

## One frame, in order

1. Two guards: a `frame()` from inside a `frame()` is a no-op, and a
   second frame in the same millisecond adds nothing. dt is the gap,
   capped at 0.1 s.
2. `layout()`; a new layout object sizes the canvas and hangs the plate.
3. Measure from the frame's camera: the plate's 4 corners and centre in
   clip space, `plateMetrics`, the plate's quad on the page, the facing
   angle; the corners are kept as the last seen while the centre is on
   screen.
4. The dock: the ghost's resting rect (`restingRect()`), in NDC of the
   view.
5. `wantPlace` with the surface's gates and hide reason, on the plate's
   side of the hysteresis while the settled place is the plate (a flight
   home included), then `settlePlace` with the finger and the time
   since its release. A fold (the slot taken, the surface able to fold)
   is treated as hidden here: the mark is not drawn yet.
6. Appearing (at zero presence) snaps u to its target; words still
   fading out fly from where they are. Otherwise u steps toward 0
   (plate) or 1 (dock) over `knobs.fly`, and not at all while a finger
   is down.
7. The presence fades in or out over 0.3 s; reduced motion snaps both.
8. The plate shows at u = 0, the quad at u > 0 (with a dock), both at the
   presence's opacity; the ghost takes pointers at u = 1. The ghost and
   its pointers are set only while the surface travels: a surface shown
   at the bottom keeps its own box, and gets it back (visible, taking
   pointers) on the frame its travel ends.
9. A paint (and an upload) only while something shows and the paint key
   changed.

The quad's corners are written in its `onBeforeRender`, from the render's
own camera (the XR eye's in AR): the plate's corners if on screen, else
the last seen, else the dock's flat corners, flown by `flightClip` at
`easeInOutCubic(u)`.

## Invariants and assumptions

- The plate and the quad are never visible on the same frame.
- The first frame shows nothing: the presence starts at 0, so the words
  fade in over 0.3 s (as in the prototype).
- `hit` is null at presence 0.5 or less, outside plate or dock, at u = 1
  (the ghost takes the finger itself) and with nothing hung. A press's
  `linePx` is one line of the words as drawn: the quad's height times
  the line height over the box height.
- A plate's hit depth is its corners' mean clip w; the quad's is 0, so a
  registry (`travel-registry.ts`) puts it on top.
- The ghost's resting rect is read at layout (the surface's job), never
  per frame from `getBoundingClientRect`.
- No allocation per frame in the measuring path: the matrices, vectors,
  clip arrays and both quads' corners are kept and written in place
  (`quadOfClipInto`); `state()` copies them for its reader. Small
  per-frame garbage is left elsewhere: the rules' result objects
  (`plateMetrics`, `wantPlace`, `settlePlace`), the surface's layout
  (its paint model), the gates' array, the hide rule's input, the paint
  key's string and the screen tuples of `midSpan` and `screenOf`.
- A corner counts as on screen only beyond the camera's near plane where
  that is further than the rules' margin (`TRAVEL_MIN_W`): WebXR clips at
  0.1 m, taken from the camera.
- Cost counters: frames, gaps over 33, 50 and 100 ms, the frame's work
  (average and max) and the paints (count, average, max).

## Examples

```ts
const travel = createTravellingBox({
  surface,
  scene,
  camera,
  knobs: TRAVELLING_BOX_DEFAULTS,
  now: () => performance.now(),
  reduceMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  viewRect: () => view,
  upload: (t) => renderer.initTexture(t),
});
```

With `registry` in the deps the box joins it itself.

## Tests

- `travelling-box.test.ts` (node, a real `PerspectiveCamera`, a fake
  surface): plate at 3 m and dock at 16 m after the hold; turned away and
  back; a finger freezes the place and the flight, the move after the
  lock; the flight starts from the last corners on screen; the plate xor
  the quad, the ghost's pointers only at u = 1; repaints on a key change
  only and never while hidden; the two frame guards; the render camera,
  not the frame's; no press at the dock or off the words; reduced motion;
  the place events and the cost counters; each frame reported to
  `onFrame` with its distance, lens and finger; `stop` (the quad, the
  texture off the plate, the registry left so a press reaches the live
  plate behind); a surface that does not travel is never ghosted; the
  hysteresis held during the flight home; words shown again mid-fade fly;
  a plate inside the camera's near plane is not seen.
- `playwright-tests/travelling-box-check.spec.js` drives it on the check
  page in a browser: the beats, the flight against independent endpoints,
  the gestures and the layout pins.
