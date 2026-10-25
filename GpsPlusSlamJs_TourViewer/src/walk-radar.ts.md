# walk-radar.ts

## Purpose

The visitor's radar on the page: draws `walk-radar-model.ts`'s model on the canvas in
`#walk-radar` (inside `#ar-root`), writes the precision chip under it, and
keeps what only a view keeps - the range shown last (the adaptive range's
hysteresis), the burst ring of a station just found, the redraw clock and
the ms each draw took.

## Public API

- `WALK_RADAR_HZ = 15` - the most redraws a second.
- `WALK_BURST_MS = 1600` - the burst ring at a station just found.
- `WALK_RADAR_COLOURS` - the canvas's colours; `--walk-gps`,
  `--walk-weak`, `--walk-accent` and `--walk-found` in `index.html` hold
  the same values (a test holds them together).
- `drawWalkRadar(ctx: RadarCanvas, model, options)` - the prototype's drawing, from
  the model's numbers: the background, rings and label, north, the cone,
  the GPS blur, the distance rings, the blips (pulse, burst, the looks),
  the rim arc and the visitor's mark. `options`: `nowMs`, `sizePx`, `dpr`,
  `reduceMotion`, `burstOf(id)`.
- `createRedrawThrottle({ intervalMs, now, setTimer, clearTimer, draw })`
  - `request()` draws at once when the interval has passed, else leaves
    ONE trailing draw at its end; `cancel()` drops it.
- `createRadarBursts()` - `note(stations, nowMs)` starts a burst for a
  station that went from next/left to found/here between two notes;
  `progress(id, nowMs)` is 0..1 while it runs; `reset()`.
- `walkRadarDebugLines(draw, frame)` - the `?debug=1` lines: "radar draw:
  M ms mean, W ms worst (N in 2 s)" and "frame: ..."; "-" before any
  sample.
- `sampleFrameTimes(register, now, window)` - registers a frame-loop
  callback that pushes each tick's `dt` (seconds) as ms at `now()`; a dt
  that is no positive finite number (the first frame) is skipped; returns
  the unregister.
- `WALK_RADAR_PEEK_MS = 2000` - how long the range label and the chip
  show after a tap.
- `wireWalkRadar({ dom, now, setTimer, clearTimer,
projection0, aspect, devicePixelRatio, reduceMotion, observeSize }) =>
WalkRadarView`
  - `render(frame | null)` - null hides the radar; otherwise writes the
    chip's words and `data-kind`, shows the chip only while
    `walkPrecisionChipShown` (hidden for a code's or a good GPS position)
    or during a tap's peek, the wrap's `data-range` (`auto`, `30`,
    `100`, `300`) and the range label's words,
    the wrap's `data-mode` (`frozen` greys
    the canvas in CSS), the wrap's `data-heading` (`none`,
    `provisional` or `confirmed`, from the geometry of that mode: the
    canvas's look made observable), and requests a draw;
  - `observeSize(onChange)` - the page's `ResizeObserver` on the canvas:
    a resize makes the next draw read the canvas's size again;
  - `drawStats(nowMs)` - the draws' rolling 2 s summary;
  - `reset()` - the range (automatic again, the adaptive hysteresis
    forgotten), the bursts and the stats start anew, and a tap's peek
    ends. Called by
    `visitor-stations.ts` `stop`, which runs at the AR session's end and
    at an open tour's close (`archive-open.ts`'s teardown,
    `archive-open.test.ts` holds that).
  - A tap on the radar steps the range (`walkRadarNextRangeM`:
    automatic, 30, 100, 300 m, automatic again), draws the step at once
    and shows the range label (`#walk-range`, `walkRadarRangeLabel`)
    and the chip for `WALK_RADAR_PEEK_MS`; a second tap restarts that
    time. The adaptive range keeps following the stations under a fixed
    step, so automatic resumes where it would be. The tap opens no list:
    the list's doors are the sheet's (the grab, "Can't get there?").

## Invariants & assumptions

- Never per frame through the store: the radar's geometry is a canvas
  and closures; the store holds only the events (precision kind, tracking
  loss, the walk's statuses).
- The redraw is requested on every stations tick (a camera frame or a
  store change) and drawn at most 15 times a second; the trailing draw is
  a real timer, so the last state is always drawn.
- The canvas is `clientWidth * min(max(dpr, 1), 2)` device pixels; a
  canvas without a size (hidden) is not drawn.
- The canvas's size is read once and again only after a resize (or while
  it read 8 px or less): reading `clientWidth` is a layout read, and a
  draw follows the sheet's DOM writes of the same render, so a read per
  draw forced a layout up to 15 times a second.
- The canvas's tints (`rgba()` of the GPS blur, the weak blur, the
  focus's pulse, a find's burst) are derived from `WALK_RADAR_COLOURS`,
  whose values `index.html`'s `--walk-*` tokens hold (`walk-radar.test.ts`
  ties the two, and every `rgb()` tint of the walk's CSS to a token).
- The range follows the live distances of the stations still to find
  (next, left, and a tour in order's later ones), and
  holds the shown range while frozen.
- A burst never replays an old find: the first render of a walk only
  records the states.
- Reduced motion: no focus pulse, no wobble of the GPS dot, the pending
  rings stand still.
- The DOM types are structural (`Pick<HTMLElement, ...>` and a canvas with
  `getContext("2d")`), so the tests need no DOM.

## Measured: the redraw candidates (headless Chromium, desktop)

The `?debug=1` e2e reads the draw time on the town tour at the code (two
runs): **1.32 and 1.47 ms mean per draw, 6.6 and 8.3 ms worst** over 2 s
(the worst is an early draw). The candidates, by drawing
time a second, reported and not gated (the phone decides):

- every frame (60 Hz): about 80-90 ms of drawing a second, 1.3-1.5 ms of
  each 16.7 ms frame;
- 15 Hz (shipped): about 20-22 ms a second;
- on change only, and a CSS rotation for the heading with a redraw on
  change: bounded by the store's changes rather than the frame rate; not
  built, since 15 Hz already stays far below the 50 ms frame budget here.

**What the draw time covers:** the JavaScript of one draw, the 2D
canvas calls recorded; the raster of those calls and the compositing of
the canvas happen later in the browser's own pipeline and are not in it.
The frame line is the one to judge the radar's cost by on the phone.

The frame line reads "-" headless: the fakes run no XR render loop, so
nothing calls the frame loop's callbacks; the phone's readout fills it. A
desktop is not a phone: the field check's numbers are the phone's.

## Examples

```ts
const radar = wireWalkRadar({
  dom: { wrap, button, canvas, chip, chipText, rangeLabel },
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as number),
  projection0: () => seams.xrProjection0(),
  aspect: () => innerWidth / innerHeight,
  devicePixelRatio: () => devicePixelRatio,
  reduceMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  observeSize: (onChange) => new ResizeObserver(onChange).observe(canvas),
});
radar.render({ stations, order, kind, accuracyM, live, snapshot });
```

## Tests

- `walk-radar.test.ts` - the throttle (one trailing draw, 15 a second,
  cancel), the bursts (find, no replay, skip is no find), the drawing (no
  station distance label, frozen greys and "?", reduced motion, a burst
  ring, a non-finite accuracy drawn without a throw on a canvas whose
  radial gradient refuses non-finite radii; a provisional heading's
  dimmer north without the cone), the view (chip words and modes, the
  heading's word, the tap's range steps and its 2 s peek of the label and
  the chip, the reset back to automatic, index.html's button name and the
  announced label, device pixels and the throttle, no size no draw, the
  range's hysteresis and reset, a tour in order's later stations in the
  range, the size read once until a resize), the colour tokens against `index.html` (and every
  `rgb()` tint of the walk's CSS, and the canvas's tints), the debug
  lines, the frame sampler.
- The page: `playwright-tests/visitor-walk-radar.spec.js` (a tap steps
  the range and opens no list, the chip per precision, the rows' and the peek's directions,
  tracking lost, the frozen radar that a move leaves and a skip changes,
  the `?debug=1` lines, north drawn provisional at once and confirmed by
  tracking while the arrows wait; the radar, rows and frozen tests on a tour of
  stories and on one with items) and
  `playwright-tests/visitor-walk-layout.spec.js` (positions and gaps,
  the range label and the chip after a tap included).
