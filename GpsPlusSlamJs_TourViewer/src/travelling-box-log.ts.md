# travelling-box-log.ts

## Purpose

The travelling box's field log for the knob sweep. Behind `?debug=1`, a
visitor's walk is logged at 10 Hz on the phone, copied as text through the
page's clipboard seam, and replayed offline under any knob set
(`replayPlaces`). So the knobs (threshold, metric, keep, holds, lock,
grow) are chosen from one walk per condition, not from one walk per knob
value. A diagnostic buffer and not app state: nothing reads it but its own
readout, its copy and the replay. That is why it lives beside the store,
like the other per-frame resources.

## Public API

- `TRAVEL_LOG_PERIOD_MS` (100): one sample per this many ms.
- `createTravelLog({ knobs, capacity?, eventCapacity? })` returns a
  `TravelLog`. The default capacity is 6000 samples (ten minutes) and 2000
  events:
  - `frame(sample)`: the controller's `onFrame`. It keeps one sample per
    period on a next-due beat, so 60, 30 and 24 fps all log about 10 a
    second, and a pause restarts the beat. A change of the finger is an
    event at that frame's time (`press`, `release`), whatever the beat.
  - `place(event)`: the controller's `onPlace`, as a `place` event.
  - `mark(at)`: the walker's Mark, as a `mark` event.
  - `samples()`, `events()`: oldest first.
  - `size()`: `{ samples, events, marks, dropped }`. `dropped` counts the
    samples the ring let go.
  - `text()`: JSON lines. A head line comes first: `{kind:"head", v, knobs,
periodMs, dropped, droppedEvents}`. Then every sample (`kind:"s"`) and
    event, by time.
  - `readout(cost | null)`: the `?debug=1` readout's lines. There are none
    before the first frame. The first line has the place and why, the em in
    px (height and width), the distance, the angle, the lens's px per metre
    and the plateau the growth holds the em at
    (`0.136 / 4.5 x px per metre`). The second line has the log's size and,
    with a cost, the controller's frame and paint counters.
- `parseTravelLog(text)` returns `{ knobs, samples, events, skipped }`.
  Empty lines are passed over. A line that is not JSON, has no finite `t`
  or has an unknown kind is skipped and counted, never thrown on (a damaged
  paste still replays).
- `replayPlaces({ samples, events }, knobs)` returns
  `{ changes, count, minutes, perMinute, afterRelease }`. It holds the
  settled changes a walk would have made under `knobs`, by the app's own
  rules (`letterGate`, `wantPlace`, `settlePlace`).
- `wireTravelLogButtons({ copy, mark, log, write, now })` wires the two
  debug buttons:
  - Copy log uses `copyWithFeedback`, reading `Copying...`, then
    `Log copied` or `Copy failed`, and enabled again after either.
  - Mark adds a mark at `now()` and labels itself `Mark (n)`.

## Invariants and assumptions

- A sample is stored rounded: px to 0.01, NDC to 0.001, metres to 0.01,
  degrees to 0.1, px per metre to 0.1. A non-finite value is stored as 0.
  `growth` is `signGrowth(distM)`, the growth the app's sign applied
  there.
- **The replay:**
  - It starts each travel hidden, as the app does, on another surface or
    after a gap of more than 1 s.
  - Its time step is the sample gap, capped at 0.2 s, so a missed frame is
    not a pause.
  - It resolves holds at 10 Hz, so a replayed change can land up to one
    sample (0.1 s) later than on the phone.
  - The lock counts from the logged releases.
  - With `grow: false` it divides the logged em by the logged growth: the
    words of a sign that did not grow.
  - It replays the words' letter gate only, the one gate a words surface
    has.
- `afterRelease` counts the plate-dock changes within 1 s after a release:
  the "it moved when I let go" the lock exists against.
- `perMinute` is over the travelling time replayed (the sample gaps while
  `travelling`), 0 when there is none.
- **The grow knob in the app:** the app's reading sign always grows; `tb.grow`
  is decided by the replay alone, as the plan's parameter section says.
- **Defensive:** non-finite times are ignored, and a capacity that is not a
  positive integer falls back to the default.

## Examples

```ts
const log = createTravelLog({ knobs });
createTravellingBox({ ..., onFrame: (s) => log.frame(s), onPlace: (e) => log.place(e) });
// later, offline:
const read = parseTravelLog(pasted);
for (const thr of [10, 12, 14, 16]) {
  console.log(thr, replayPlaces(read, { ...knobs, thr }).perMinute);
}
```

## Tests

`travelling-box-log.test.ts` covers:

- the 10 Hz beat at 60, 30 and 24 fps;
- the ring and its `dropped`;
- the press and release events at their frame's time;
- the text round trip through `parseTravelLog`, its skipped lines;
- the readout's lines;
- the buttons (busy, done, the mark count);
- the replay:
  - a surface change and a long gap start hidden;
  - the lock across a logged release;
  - a retreat docks earlier the higher the threshold, and earlier without
    growth;
  - a wider keep band changes place more often over a minute.
