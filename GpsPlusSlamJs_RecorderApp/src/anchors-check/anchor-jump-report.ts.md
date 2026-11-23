# `anchor-jump-report.ts`

## Purpose

The text of the anchors check: one on-screen line per event and the full
log that "Copy log" copies. Pure functions over the tracker's output.

## Public API

- `percentile(values, p)`: nearest rank on a sorted copy; `null` for none.
- `formatPose(pose | null)`: `p=(x, y, z) q=(x, y, z, w)` with 3 and 4
  decimals, `none` for `null`.
- `onScreenLine(event)`: e.g. `Jump 2: frame switch (camera 0.84 m / 3.1 deg,
0.3-1 m)`; `(settling)` while the settle window is open; `unclear (no
anchor tracked)` without an anchor.
- `verdictCounts(events)`: jumps by main-tolerance verdict (settled pose,
  else the jump frame).
- `buildLog(input)`: the full log.

## What the log prints

- `WebXR anchors check`, the time, the environment lines (user agent, page,
  build commit, `immersive-ar`, `enabledFeatures`, `anchors`,
  `frame.createAnchor`).
- The limits (0.25 m, 5 deg, 500 ms, settle frames, the 0.3-1 m band below
  the 1 m rule) and the three verdict tolerances.
- Frame counts; frame dt, camera step and camera turn per frame as p50, p95,
  p99 and max (the noise floor and the gap distribution).
- Jump counts by verdict and by band; loss and gap counts.
- Anchor and marker pose now, and the step between them.
- Every event: for a jump, dt, the camera step and band, camera before and
  after, `D`, `anchorBefore`, `D * anchorBefore`, the marker, then the anchor
  in the jump frame and settled, each with its distance to both predictions
  and the verdict at tight, main and loose; for a loss or gap, the camera
  step and the anchor before and after with its step.

## Tests

`anchor-jump-report.test.ts`: percentile, pose format, each on-screen line,
the counts, and the log's header, distributions and event lines.
