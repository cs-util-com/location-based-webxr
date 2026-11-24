# travelling-box-log.ts

## Purpose

The travelling box's field log for the knob sweep. Behind `?debug=1`, a
visitor's walk is logged on the phone, copied as compact text through the
page's clipboard seam (or saved as a file), and replayed offline under any
knob set (`replayPlaces`). So the knobs (threshold, metric, keep, holds,
lock, grow) are chosen from one walk per condition, not from one walk per
knob value. A diagnostic buffer and not app state: nothing reads it but its
own readout, its copy and the replay. That is why it lives beside the
store, like the other per-frame resources.

## Public API

- `TRAVEL_LOG_PERIOD_MS` (100): at least one sample per this many ms.
- `createTravelLog({ knobs, capacity?, eventCapacity? })` returns a
  `TravelLog`. The default capacity is 6000 samples and 2000 events:
  - `frame(sample)`: the controller's `onFrame`. It keeps a sample:
    - on a next-due beat, so 60, 30 and 24 fps all log about 10 a second
      (a pause restarts the beat);
    - and on every frame where the want, the place or the finger changes,
      and on a travel's first frame.
    - Each sample's `dt` is the sum of the app's own settling steps
      (`TravelFrameSample.dtS`, capped by the app at 0.1 s a frame) since
      the sample before; 0 on a travel's first frame.
    - A change of the finger is also an event at that frame's time
      (`press`, `release`). A new travel (the controller's first frame,
      another surface, or a gap of more than 1 s) starts with no finger,
      so a press held when the travel before ended logs no release there.
  - `place(event)`: the controller's `onPlace`, as a `place` event.
  - `mark(at)`: the walker's Mark, as a `mark` event.
  - `samples()`, `events()`: oldest first.
  - `size()`: `{ samples, events, marks, dropped }`. `dropped` counts the
    samples the ring let go.
  - `text()`: the compact text (below).
  - `clear(after)`: empties the log after a `"copy"` or a `"download"`, so
    the next copy holds the next run alone. Until the next frame the
    readout says `log cleared after the copy (n samples)`.
  - `readout(cost | null)`: the `?debug=1` readout's lines. There are none
    before the first frame (or the cleared line). The first line has the
    place and why, the em in px (height and width), the distance, the
    angle, the lens's px per metre and the plateau the growth holds the em
    at (`0.136 / 4.5 x px per metre`). The second line has the log's size
    and, with a cost, the controller's frame and paint counters.
- `parseTravelLog(text)` returns `{ knobs, samples, events, skipped }`.
  Empty lines are passed over. A line that is not JSON, or not a row of
  the format, is skipped and counted, never thrown on (a damaged paste
  still replays).
- `replayPlaces({ samples, events }, knobs)` returns `{ changes, count,
moves, minutes, perMinute, movesPerMinute, afterRelease }`, by the app's
  own rules (`letterGate`, `wantPlace`, `settlePlace`):
  - `changes` and `count` hold every settled change, hidden ones included;
  - `moves` and `movesPerMinute` count only the changes among plate, dock
    and fold: appearing and hiding follow the voice, not the knobs, so
    **the sweep compares `movesPerMinute`**;
  - `minutes` is the travelling time replayed.
- `replaySelfCheck(read)` returns `{ logged, replayed, matched, maxLagMs,
firstMismatch }`, or null when the head has no knobs: the log replayed
  under the knobs in its own head, set against the place changes the app
  logged, pair by pair in order.
- `wireTravelLogButtons({ copy, download, mark, log, write, save, now, appendices? })`
  wires the three debug buttons. With `appendices` (the page passes the
  anchor log, `anchor-debug-log.ts`, and with `?qrperf=1` the QR
  instrument, `qr-perf-report.ts`) the copied and downloaded text is the
  log's text, then each section's `text()` on its own line, and all are
  cleared
  after a copy or download that succeeded. The replay reader skips the
  appended plain-text lines as unreadable (it counts them, never throws),
  so a normal paste now reports skipped lines: one per non-empty line of
  the anchor section. A `skipped` above zero no longer means on its own
  that the paste was damaged; `travelling-box-log.test.ts` pins that the
  appendix leaves the samples and events as the travel text alone reads.
  - Copy log uses `copyWithFeedback`, reading `Copying...`, then
    `Log copied` or `Copy failed`, enabled again after either. A copy that
    succeeded clears the log.
  - Download log is the fallback for a log the clipboard cannot take. It
    reads `Saving...` while `save(text)` runs, then `Log downloaded` (and
    clears the log), its own label again when the dialog was dismissed
    (the log is kept), or `Download failed`. The page's `save` is the
    framework's `downloadBlob` with a `.txt` type (picker first, else an
    `<a download>`).
  - Mark adds a mark at `now()` and labels itself `Mark (n)`.

## The text format (version 2)

One JSON value per line, by time:

- The head: `{"kind":"head","v":2,"knobs":{...},"periodMs":100,
"dropped":0,"droppedEvents":0}`.
- A context line `["S", surface, pxPerM]` before the first sample, and
  again whenever the surface or the lens changes; the samples after it
  belong to it.
- A sample row of 11 integers: `[t, dt x 1e4, letterPxH x 1e3,
letterPxW x 1e3, linePx x 10, ndcX x 1e3, ndcY x 1e3, angleDeg x 10,
distM x 100, flags, state]`.
  - `flags`, one bit each from bit 0: first, travelling, slotFree,
    canFold, finger, valid, onScreen.
  - `state` is `place + 4 x want + 16 x why`, indices into
    `plate, dock, fold, hidden` and the `TravelWhy` list in source order.
  - `hideWhy` is not stored: it is null unless travelling, and while
    travelling a hidden want's reason is the surface's own, so it is read
    back from `why`.
- Events: `["p", t, surface, place, why]`, `["d", t, surface]` (press),
  `["u", t, surface]` (release), `["m", t]` (mark).

**Size, measured** (`travelling-box-log.test.ts`, a synthetic walk with
every value varying): about 55 bytes a sample, so a 6-minute walk at 10 Hz
is about 198 KB and the full ring (6000 samples) about 329 KB, against an
Android clipboard limit of about 1 MB. Copy stays the primary path;
Download is there for a log that will not go.

## Invariants and assumptions

- A stored record must be a JSON object that is no array: the guard is the
  framework's shared `isJsonObject` (`utils/json-guards`, deep-imported),
  not a local copy.
- A sample is stored rounded: letter px to 0.001, line px to 0.1, NDC to
  0.001, metres to 0.01, degrees to 0.1, px per metre to 0.1, `dt` to
  0.1 ms. A non-finite value is stored as 0. `growth` is
  `signGrowth(distM)`: approximately the growth the app applied (the sign
  grows by its root's distance, the logged distance is the plate's, about
  1.4 % apart at the default layout).
- **The replay:**
  - It starts each travel hidden, as the app does, on a sample flagged
    first, on another surface or after a gap of more than 1 s; a release
    logged before that sample is not this travel's (unless at its time).
  - Its time step is each sample's `dt`, the app's own capped steps, so a
    stall counts as the app counted it (at most 0.1 s a frame).
  - **Resolution:** under the knobs the walk ran with, every frame where
    the app's want or place changed is a sample, so the replay meets each
    settled change at the app's frame, apart from rounding near a
    threshold (the 60 Hz walk test matches with a lag of 0 ms). Under
    other knobs the replay sees the walk only at its samples: a want that
    flips between two samples under those knobs is seen up to one beat
    (0.1 s) late, and a reversal shorter than a beat can be missed.
  - The lock counts from the logged releases; `afterRelease` counts the
    plate-dock changes sooner than 1 s after one (`< 1 s`), the "it moved
    when I let go" the lock exists against.
  - With `grow: false` it divides the logged em by the logged growth: the
    words of a sign that did not grow.
  - It replays the words' letter gate only, the one gate a words surface
    has.
- `perMinute` and `movesPerMinute` are over the travelling time replayed
  (the samples' `dt` while `travelling`), 0 when there is none.
- **The grow knob in the app:** the app's reading sign always grows; the
  address carries no `tb.grow` (`travelling-box-knobs.ts`), growth is
  decided by the replay alone.
- **Defensive:** non-finite times are ignored, and a capacity that is not a
  positive integer falls back to the default.

## The sweep, step by step

1. **Self-check first:** `replaySelfCheck(parseTravelLog(pasted))`. A
   whole log should give `firstMismatch: null` and a `maxLagMs` near 0.
   A log whose ring dropped its start (`dropped` in the head) can begin
   mid-travel, so its first pairs may differ; a mismatch further in means
   the replay does not stand for this walk, and its sweep is not read.
2. Then each knob set: `replayPlaces(read, { ...read.knobs, thr })` and
   so on, comparing `movesPerMinute`, `afterRelease` and the dock times.

## Examples

```ts
const log = createTravelLog({ knobs });
createTravellingBox({ ..., onFrame: (s) => log.frame(s), onPlace: (e) => log.place(e) });
// later, offline:
const read = parseTravelLog(pasted);
console.log(replaySelfCheck(read));
for (const thr of [10, 12, 14, 16]) {
  console.log(thr, replayPlaces(read, { ...read.knobs!, thr }).movesPerMinute);
}
```

## Tests

`travelling-box-log.test.ts` covers:

- the 10 Hz beat at 60, 30 and 24 fps, and a sample at each change with
  the app's summed steps;
- the measured size of a 6-minute walk and of the full ring;
- the ring and its `dropped`;
- the press and release events at their frame's time, and no release at a
  new travel's first frame;
- the text round trip through `parseTravelLog`, its skipped lines;
- the readout's lines;
- the buttons: the copy (busy, done, cleared), the failed copy, the
  download (busy, failed, dismissed, saved and cleared), the mark count;
- the replay:
  - a surface change and a long gap start hidden;
  - the lock across a logged release (`afterRelease` 1 without a lock,
    0 with a 1 s one);
  - a retreat docks earlier the higher the threshold, and earlier without
    growth;
  - a wider keep band changes place less often over a minute;
  - `moves` leaves out appearing;
  - `replaySelfCheck` on a matching and a mismatching log.

`travelling-box.test.ts` drives the real controller through a scripted
60 Hz walk (out and back, a sway across the keep band with a tremble, a
finger, turned away, a one-frame step back while the dock is pending, a
400 ms stall) into the log, and checks the replay under the same knobs
gives the logged changes in order, each within 200 ms, and
`replaySelfCheck` matches them all with a lag of 0.
