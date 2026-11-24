# `anchor-jump-report.ts`

## Purpose

The text of the anchors check: one on-screen line per event, the counts
line and the full log that "Copy log" copies. Pure functions over the
tracker's output.

## Public API

- `percentile(values, p)`: nearest rank on a sorted copy; `null` for none.
- `formatPose(pose | null)`: `p=(x, y, z) q=(x, y, z, w)` with 3 and 4
  decimals, `none` for `null`.
- `onScreenLine(event)`. An example:
  `Jump 2: frame switch (0 ms switch, 100 ms switch, 300 ms switch, 1000 ms switch, 2000 ms switch); unexplained 0.84 m / 3.1 deg, 0.3-1 m`.
  - The label depends on the episode's state: `settling, <verdict> so far`
    when the snapshot flags it `pending`; `truncated, not counted
(<verdict> at <delay> ms)` when it was cut short; `<reason>, not counted (<verdict>)` for the tracker's `notCounted` (`no correction`, `unsteady rate`, `long frame`, `moving`); `no anchor, not counted` when the last reading has no
    anchor to judge (none placed yet, or not tracked).
  - A compensated jump shows its `unexplained` step; a loss, a gap or an
    uncompensated jump shows its `raw step`.
  - Losses read `Tracking loss n (1.5 s): ...` and gaps read
    `Frame gap n (600 ms): ...`.
  - Placements, anchor failures, frame errors, anchor read errors and the session lines each get
    their own sentence.
- `verdictCounts(events, kind)`: `judged` (episodes that reached the last
  delay and are not excluded) by the main-tolerance verdict of their last
  reading, then the not counted ones by reason: `no correction`, `unsteady rate`, `long frame`, `moving`,
  `no anchor`, `truncated`, and `settling`.
- `countsLine(events)`: `Nothing judged yet.`, or the judged jumps and
  tracking losses by verdict, then `Not counted: no correction n, unsteady rate n, long frame n, moving n,
no anchor n, truncated n.` over both. This is the walk's stop rule. It is
  conservative by construction: it may leave real episodes out but never
  counts a doubtful one; the log is the authoritative record to re-judge
  offline.
- `buildLog(input)`: the full log. `input` holds the events, the stats, the
  environment, and the anchor now with its tracked flag and the marker.

## What the log prints

- `WebXR anchors check`, the time, and the environment lines: user agent,
  page, build commit, `immersive-ar`, `enabledFeatures`, `anchors`,
  `frame.createAnchor`, `frame errors` when any frame threw and `anchor read errors` when any
  anchor read threw, each with its count and first message.
- The limits: the unexplained step limits, 500 ms, the bands, the reading
  delays and which reading is counted, the counting rules (a proven correction, stillness as a rate over at
  least 100 ms and its shift at the anchor, a steady rate frame, the
  extrapolation ratio, no anchor) and the three verdict tolerances.
- Frame counts, plus frame dt, the raw camera step and turn, and the
  unexplained step and turn per steady frame (on a steady rate, no jump), each as p50, p95, p99 and max. These
  give the noise floor for the limits.
- Counts per kind: judged by verdict, not counted by reason, settling.
  Also the bands of the judged jumps.
- The anchor now (with its tracked flag), the marker now, and the step
  between them.
- Every event. An episode prints:
  - its kind, index, dt, the raw camera step, the unexplained step (or
    `raw step, D uncompensated`), the band and its state, including
    `not counted: <reason>`;
  - the stillness before it: the window's span, its speed in m/s and turn
    rate in deg/s, the anchor distance and the shift that motion gives the
    anchor over the episode (or `unknown` under 100 ms of tracked frames);
  - for a compensated jump, the rate frame with its time, its own
    unexplained step (or `unknown`) and the extrapolation ratio;
  - the camera before (with its time) and the camera after;
  - `D`, `anchorBefore` with its tracked flag, `D * anchorBefore` and the
    marker;
  - every reading: the nominal and actual delay, the tracked flag and the
    raw pose, then the distance to both predictions and the verdict at
    tight, main and loose (or "not judged").
- Placements, failed `createAnchor` calls, the first frame error, the first anchor read error, and
  `session start` / `session end`.

## Tests

`anchor-jump-report.test.ts` builds its episodes with the real tracker, not
by hand. It covers percentile, the pose format, each on-screen line (the
settling label taken from a real snapshot, a truncated label, a walking
loss as moving with its raw step and stillness line, each other reason,
no anchor, both error notes), the counts and
the counts line with the not counted reasons, and the log's header,
distributions and event lines.
