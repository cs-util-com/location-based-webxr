# `anchor-debug-log.ts`

## Purpose

The anchor section of a visitor's `?debug=1` Copy log, and two lines of the
AR debug readout: what the phone field test of the deferred anchors
(`gps-plus-slam-app-framework/ar/deferred-anchors`) reads its numbers and
its verdict from. A diagnostic buffer beside the store, like the
travelling-box log (`travelling-box-log.ts`); it exists only on that debug
path.

## Public API

- `summarizeSamples(values): SampleSummary | null`
  - `{ p50, p95, max, mean, count }` of the finite values (any order, the
    input is not mutated); null when none is finite.
  - p50 and p95 are the framework's nearest rank
    (`gps-plus-slam-app-framework/utils/percentile`), so each is a value
    that occurred.
- The field test's limits, all inclusive:
  - `PASS_P95_LIMIT_MS = 0.5`: the anchor pass p95, deferral on.
  - `FRAME_REGRESSION_LIMIT_MS = 1`: the frame p95 with the deferral on
    minus with it off.
  - `MIN_FRAME_SAMPLES = 300`: frames each half needs before the two are
    compared (5 s at 60 frames a second; one 15 s turn of `anchors=ab`).
- `createAnchorDebugLog({ passes = 3600, lines = 2000 }?): AnchorDebugLog`
  - `RangeError` for a size that is not a positive integer.
  - `pass(sample)`: one `DeferredAnchorPassSample` from the framework's
    pass observer. Keeps its pass ms, its traversals and its frame time
    (`dt * 1000`; none for a `dt` that is not positive) in three bounded
    rings of `passes` each, one set of rings for the deferral on and one
    for off (`sample.deferring`), and counts it as seen. Its `commits` are
    counted at once (the list is valid during the call only): by kind, and
    for each `out-of-view` commit its frames out of view against its queue.
  - `entry(logEntry)`: a framework log entry; only the `DeferredAnchors` tag
    is kept, as `HH:MM:SS.mmm <message>` (local clock, like the console's
    timestamps). The oldest line goes once `lines` are held, and the count
    of dropped lines is reported.
  - `text()`: the section, for example

    ```
    --- anchors ---
    deferral on and off in turns (anchors=ab)
    passes 5400 seen, last 5400 summarized
    pass ms p50 0.041 p95 0.118 max 0.903 (n 2700)
    traversals per pass mean 0.212 max 1 (n 2700)
    frame ms p50 16.7 p95 18.3 max 41.2 (n 2700)
    deferral off: pass ms p50 0.010 p95 0.030 max 0.200 (n 2700), frame ms p50 16.7 p95 17.9 max 40.1 (n 2700)
    commits 14: first 3, out-of-view 9, window 2
    out of view: most 2 frames (queue up to 3), 0 over their queue
    --- verdict ---
    pass p95 0.118 ms (limit 0.5): PASS
    frame p95 regression 0.4 ms (on 18.3, off 17.9, limit 1): PASS
    out-of-view commits within their queue (9 of 9): PASS
    lines 3
    14:02:11.512 window opened (jump)
    14:02:13.530 window closed
    14:02:20.004 commit out-of-view: station:a, waited 6420 ms, moved 2.00 m, 384 frames pending, out of view 2 frames (3 queued)
    ```

    - The unlabelled pass, traversal and frame lines are the deferral-on
      passes; the `deferral off:` line appears once there are off passes.
    - The deferral line reads `deferral on`, `deferral off (anchors=0)`,
      `deferral on and off in turns (anchors=ab)` (both kept), or
      `deferral -` before the first pass.
    - A criterion without its data prints `not measured` and what it
      needs, never PASS: `pass p95: not measured (no pass with the deferral
on)`, `frame p95 regression: not measured, open with &anchors=ab (on
n <a>, off n <b>, need 300 each)`, `out-of-view commits within their
queue: not measured (none yet)`.
    - `-` stands for a summary without samples.

  - `readout(nowMs)`: the readout's two lines, for example
    `anchors ab: pass p95 0.12 max 0.90 ms, trav 0.21/pass, frame p95 18.3 ms (2700)`
    and `anchor test: pass PASS, frame PASS, queue -` (`-` for not
    measured). The first shows the deferral-on numbers, or the off ones
    when the session has none; its label is `on`, `off` or `ab`. Empty
    before the first pass. Recomputed at most once a second (the readout
    renders every camera frame), and at once when the clock goes back.
  - `clear()`: empties the rings, the counts, the commit counts and the
    lines.
- `startAnchorDebugLog(): { log, stop() }`: a log fed by
  `observeDeferredAnchorPasses` and `subscribeToLogs`; `stop` ends both
  feeds (the page never calls it).

## Invariants

- Bounded: 2 x 3 x 3600 doubles (about 170 KB) and at most 2000 lines,
  whatever the walk's length. 3600 passes are about 60 s at 60 frames a
  second per deferral state.
- The frame time is the anchor pass's `dt`, the interval between two XR
  frames, not the anchors' cost: its p95 is what shows dropped frames (a
  dropped frame doubles one interval). The anchors' own cost is the pass
  time, read through `pass p95`. The frame time has samples only once an
  anchor set runs; the pass time is measured by the framework only while an
  observer is set, so a page without `?debug=1` pays nothing.
- The pass criterion reads the deferral-on passes only: the off half of an
  `anchors=ab` session runs a cheap follow pass that would pull the p95
  down. The frame criterion compares the two halves of one session, so
  the walk, the content and the phone's heat are the same for both.
- The queue criterion: the set traverses one key per pass, round robin, so
  a key out of view with `q` keys queued commits within `q` passes; a
  commit with `outFrames > queued` counts as over its queue and fails it.
- Pass times are `performance.now()` spans, which a browser coarsens
  without cross-origin isolation: on a phone opening the page without it
  they come in steps of about 0.1 ms, so a cheap pass reads 0 or 0.1 and
  the p95 and max, not the p50, carry the signal.
- The switches (`?anchors=0`, `?anchors=ab`, the dev jump) act only with
  `?debug=1` (`anchor-test-switches.ts`).
- With several anchor sets every set's passes land in the same rings (the
  Tour Viewer has one).
- Parameters the verdicts rest on: the two limits (from the field test's
  pass criteria) and `MIN_FRAME_SAMPLES`. A smaller minimum gives a frame
  verdict sooner on fewer frames; a larger one may need more than one
  turn of `anchors=ab` per half.

## Example

```ts
const anchorLog = startAnchorDebugLog().log;
wireTravelLogButtons({ ...buttons, appendix: anchorLog });
debugLines = () => [...anchorLog.readout(performance.now())];
```

## Tests

- `anchor-debug-log.test.ts`: the summary, the section's lines, the bounded
  rings and lines, the deferral-off wording, the once-a-second readout and
  `clear`, the size refusals, the verdicts (not measured without data, the
  pass p95 on the deferral-on passes only and inclusive, the frame p95
  regression of an A/B session both ways and its sample minimum, the
  commits by kind and the queue check both ways), and the framework's log
  lines reaching `startAnchorDebugLog` until `stop`.
- `anchor-debug-log.property.test.ts`: the summary against
  `nearestRankPercentile` with junk values mixed in, its order and mean,
  the ring always summarizing exactly the newest passes, and the pass
  verdict matching the nearest-rank p95 of the deferral-on passes for any
  mix of on and off passes.
- `travelling-box-log.test.ts`: the section appended to the copied and
  downloaded text and cleared with it.
