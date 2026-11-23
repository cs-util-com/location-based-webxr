# `anchor-debug-log.ts`

## Purpose

The anchor section of a visitor's `?debug=1` Copy log, and one line of the
AR debug readout: what the phone field test of the deferred anchors
(`gps-plus-slam-app-framework/ar/deferred-anchors`) reads its numbers from.
A diagnostic buffer beside the store, like the travelling-box log
(`travelling-box-log.ts`); it exists only on that debug path.

## Public API

- `summarizeSamples(values): SampleSummary | null`
  - `{ p50, p95, max, mean, count }` of the finite values (any order, the
    input is not mutated); null when none is finite.
  - p50 and p95 are the framework's nearest rank
    (`gps-plus-slam-app-framework/utils/percentile`), so each is a value
    that occurred.
- `createAnchorDebugLog({ passes = 1800, lines = 200 }?): AnchorDebugLog`
  - `RangeError` for a size that is not a positive integer.
  - `pass(sample)`: one `DeferredAnchorPassSample` from the framework's
    pass observer. Keeps its pass ms, its traversals and its frame time
    (`dt * 1000`; none for a `dt` that is not positive) in three bounded
    rings, counts it as seen and keeps its `deferring` flag.
  - `entry(logEntry)`: a framework log entry; only the `DeferredAnchors` tag
    is kept, as `HH:MM:SS.mmm <message>` (local clock, like the console's
    timestamps). The oldest line goes once `lines` are held, and the count
    of dropped lines is reported.
  - `text()`: the section, for example

    ```
    --- anchors ---
    deferral on
    passes 5400 seen, last 1800 summarized
    pass ms p50 0.041 p95 0.118 max 0.903 (n 1800)
    traversals per pass mean 0.212 max 1 (n 1800)
    frame ms p50 16.7 p95 18.3 max 41.2 (n 1800)
    lines 3
    14:02:11.512 window opened (jump)
    14:02:13.530 window closed
    14:02:20.004 commit out-of-view: station:a, waited 6420 ms, moved 2.00 m
    ```

    `-` stands for a summary without samples, `deferral off (anchors=0)`
    for the switch.

  - `readout(nowMs)`: the readout's line, for example
    `anchors on: pass p95 0.12 max 0.90 ms, trav 0.21/pass, frame p95 18.3 ms (1800)`;
    empty before the first pass. Recomputed at most once a second (the
    readout renders every camera frame), and at once when the clock goes
    back.
  - `clear()`: empties the rings, the counts and the lines.
- `startAnchorDebugLog(): { log, stop() }`: a log fed by
  `observeDeferredAnchorPasses` and `subscribeToLogs`; `stop` ends both
  feeds (the page never calls it).

## Invariants

- Bounded: 3 x 1800 doubles and at most 200 lines, whatever the walk's
  length. 1800 passes are about 30 s at 60 frames a second (60 s at 30).
- The frame time is the anchor pass's `dt`, so it has samples only once an
  anchor set runs; the pass time is measured by the framework only while an
  observer is set, so a page without `?debug=1` pays nothing.
- With the deferral off (`?anchors=0`, development builds only) the set
  still runs a cheap follow pass each frame; its time is in the numbers.
- With several anchor sets every set's passes land in the same rings (the
  Tour Viewer has one).

## Example

```ts
const anchorLog = startAnchorDebugLog().log;
wireTravelLogButtons({ ...buttons, appendix: anchorLog });
debugLines = () => [...anchorLog.readout(performance.now())];
```

## Tests

- `anchor-debug-log.test.ts`: the summary, the section's lines, the bounded
  rings and lines, the deferral-off wording, the once-a-second readout and
  `clear`, the size refusals, and the framework's log lines reaching
  `startAnchorDebugLog` until `stop`.
- `anchor-debug-log.property.test.ts`: the summary against
  `nearestRankPercentile` with junk values mixed in, its order and mean,
  and the ring always summarizing exactly the newest passes.
- `travelling-box-log.test.ts`: the section appended to the copied and
  downloaded text and cleared with it.
