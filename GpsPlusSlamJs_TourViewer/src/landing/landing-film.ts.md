# landing-film.ts

## Purpose

The landing page's hero film: a model park that shows what a tour is and
how one is made, in eight parts that play once, with a segmented bar
(pause, play, jump to a part) and a caption under the picture. Ported from
the route-and-phone landing prototype, with its scroll drive replaced by a
timeline.

## Public API

- `mountLandingFilm(host, { reducedMotion, onArStarting, requestFrame?, onFallback? }): { destroy() }`
  - `host`: the page's box, a fixed height that the film fills: the
    picture (the stage) takes what the bar and the caption leave. The
    page sizes it so the picture is 9:10 on an upright phone, 3:2 on a
    phone held sideways and 16:9 from 900 px wide (index.html.md,
    "Reserved sizes"); the film lays itself out for any box. Its children are replaced and given back on `destroy`.
  - `onArStarting(stop)`: the film registers its `stop`; the page calls it
    when an AR session starts; returns the unregister (called on destroy).
  - `requestFrame`: the frame scheduler (default `requestAnimationFrame`).
  - `onFallback("no-webgl" | "context-lost")`: once, when it draws flat.
  - Throws `TypeError` for a host that is not an element, or no
    `onArStarting`.
- `createLandingFilm(host, options, tuning?, env?)`: the same with the pace,
  the renderer and the browser parts as seams; returns a handle with
  `snapshot`, `jumpTo`, `toggle`, `renderer`, `segments`, `totalS` (for
  tests). The frame measurements exist only behind `?debug=1` (the
  readout).
- `DEFAULT_TUNING`: speed 0.75, hold 1.5 s, camera 1.1 s, settle 0.22 s,
  start share 0.5, leave share 0.1, full quality.
  - **Full quality is not shown to meet the phone budget** (no frame over
    50 ms). Measured on a production build at 390x844 with the CPU slowed
    4x through the DevTools protocol, 30 s runs: 18 and 24 frames over
    50 ms in about 1 350 at full quality; `film-shadows=0`, `film-dpr=1.5`,
    `film-eye=0` and all off gave 14 to 77, and two repeats of one setting
    differed more than any two settings did. A slowed CPU slows the main
    thread, not the GPU, while three of the four knobs cut GPU work, so a
    desktop cannot decide this. It stays full quality until a phone
    decides it: a phone's `?debug=1` readout over a whole run with fewer
    slow frames under `film-shadows=0` or `film-dpr=1.5` than at full
    quality would make that setting the default.

## What the page sees

- On the host: `data-film-state` (waiting, playing, paused, finished),
  `data-film-beat` (0 to 7), `data-film-moving` ("true" while it plays
  with its start share in view), `data-playing` (the same as
  `data-film-moving`: the cards hold still while it is "true",
  `landing-cards.ts`; a film that plays on with under half of it in view
  does not hold them). All four are removed on `destroy`.
- A `landing-film-change` event on the host, `detail: { status, beat, moving, pausedBy }`,
  only when one of these changes (not every frame). The cards wait while
  `moving` is true.

## Invariants

- Animation frames are requested only while playing.
- The 3D scene is built the first time the film is in view (or played),
  never at mount, so a page that never shows it never creates WebGL.
- A new scene is shown only once its shaders are compiled
  (`FilmScene.prepare`); the flat drawing plays meanwhile (about 0.1 s on
  a desktop, 0.2 to 0.3 s with the CPU slowed 4x). This split the film's
  longest task (build plus first draw, about 550 ms at 4x) into a build of
  about 300 ms and a first draw of about 150 ms. A scene released (AR),
  lost or destroyed while it compiles is freed and never shown; a failed
  `prepare` still shows it (its first draw compiles), and so does one
  whose compile throws at once (`compileAhead` settles then): it is not
  reported as a missing WebGL and is freed like any other scene.
- `stop` (AR): pause, free the renderer (not a fallback), show the flat
  still; a new scene is built the next time the film comes into view or is
  played. It does not restart by itself while still in view. "Comes into
  view" means after it left the view by the player's own rule
  (`hasLeftView`, under the leave share), so the player can never resume
  it on the flat drawing while the renderer waits for a share of 0.
- No renderer is built while the page marks a live AR session
  (`body[data-ar-active="true"]`), whatever the film's own state: a film
  that re-enters the view during the session, or one mounted afresh then
  (a reduced-motion change), waits for the next entry into view after it.
  Nor does it play: during the session the player is told the film is out
  of view, so a view report then (which re-arms its start rule) cannot
  start the flat drawing behind AR.
- A real context loss, no WebGL, or a renderer that will not start: the
  flat drawing on the same timeline and bar, reported once.
- Reduced motion: opens on the last picture with every caption as a list
  and a play button; the film then grows below its box (the stage keeps
  its height) instead of shrinking the picture. A measurement of that
  height under 2 px (taken mid-resize) keeps the last good one, so the
  stage is never left 0 px tall.
- The layout follows the stage, which is what it measures: both the stage
  and the host are observed for size (a caption that wraps past its
  reserved room resizes the stage while the host keeps its size; the
  list's stage height follows the host).
- `?debug=1`: a readout over the picture (`film-debug.ts`): the renderer,
  its pixel ratio and quality, the scene's build time, the film's time,
  the last frames' percentiles (`utils/frame-times`) and the whole run's
  frames over 33, 50 and 100 ms. With it the address's knobs `film-dpr`,
  `film-shadows`, `film-eye` and `film-aa` change the scene's quality,
  so one phone can compare settings (for example
  `/?debug=1&film-shadows=0`). Without `?debug=1` the knobs do nothing.

## Page variables it reads

Each with a fallback: `--ink`, `--ink-dim`, `--paper`, `--map-card`,
`--map-line`, `--map-ink-3`, `--map-route`, `--map-route-soft`,
`--map-paper-3`, `--map-serif`, `--font-ui`. The bar height is
`--lf-bar-h` (5 px; 3, 5 and 8 were tried).

One is the page's to set on the host: `--lf-inset` (0 when unset), the
room between the box's edges and the bar, the caption and the bottom; the
landing sets 16 px upright (the page's gutter, so the caption lines up
with the hero's text) and 12 px elsewhere. The film sets lining figures
itself: the page's face sets old-style ones, which shrank a station's
number and the phone's clock against the prototype.

## Example

```ts
const { mountLandingFilm } = await import("./landing/landing-film.js");
const film = mountLandingFilm(hostEl, {
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  onArStarting: (stop) => arStarting.add(stop),
});
```

## Tests

`landing-film.test.ts` (jsdom, a fake frame queue and a fake scene): no
frames while idle, plays once, reduced motion (and the list stage keeping
its last good height), the AR handoff, the
fallbacks, no renderer and no playing during a live AR session (also
after the handoff, whatever the view reports), a scene whose compile throws
at once shown and freed, the host attributes and
event, `data-playing` (false while it plays mostly out of view), destroy, the
drawing kept while the scene compiles (and a scene ended meanwhile never
shown), the debug readout built with the knobs' quality, and the knobs
ignored without `?debug=1`.

`playwright-tests/landing-film.spec.js` (the real page): waits below the
fold and plays in view, the bar's eight named parts with one current, a
jump, pause and play by a tap and by the keyboard, plays once and offers
Play again, the AR handoff (by a live session and by a tap on Start) and
the new renderer on the next view, no animation frame while paused,
reduced motion, no WebGL, a failed chunk keeping the still, and the
reserved box keeping its size when the film mounts at three viewports.
