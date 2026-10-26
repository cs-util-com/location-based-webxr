# film-scene.ts

## Purpose

The hero film's 3D picture with three.js: the model park, the route as
dots, the pins and their labels, the person and their wedge of view, a
camera fitted to each view, and the phone's screen drawn as the same park
at eye height in a second pass.

## Public API

- `createFilmScene(doc, parts, quality, opts, onContextLost): FilmScene`
  - `parts`: the stage, the element the canvas goes after, the labels
    layer, the dashed line and its dot.
  - `quality: SceneQuality` (`pixelRatioCap`, `shadows`, `eyePass`,
    `antialias`); `FULL_QUALITY` is the prototype's.
  - `opts`: `reducedMotion`, `devicePixelRatio`, `smallScreen` (1024 px
    shadow map instead of 2048).
  - `onContextLost`: called for the live renderer's lost context only.
  - Throws when the renderer cannot start (the caller falls back).
- `FilmScene`: `canvas`, `layout(ly)`, `draw(frame, camera, t)` (true when
  it rendered), `anchors(eye, sw, sh)`, `show()`, `release()`, `bench(n)`,
  `info()`.

## Invariants

- Driven, never running: it schedules no frame of its own, and `draw`
  renders only when a signature of everything visible changed (the camera,
  the route, pins, poster, person, wedge, phone, layout). An idle film
  costs nothing.
- The camera is a function of the timeline: the views are blended with
  the smoothstep easing of the timeline's linear `k`, so a jump or a pause
  mid-move shows the right in-between.
- The walking person's bob is a function of `t` (none with reduced motion).
- The shadow map is drawn once, on the first frame (as the prototype's).
- `release()` removes the lost-context listener first, frees geometries,
  materials and the renderer, forces the context loss (AR needs it), and
  removes the canvas and the labels. A released scene is never reused.

## Tests

Not unit-tested (WebGL). Covered by the harness screenshots against the
prototype and the frame measurement; `landing-film.test.ts` covers its
contract through a fake scene.
