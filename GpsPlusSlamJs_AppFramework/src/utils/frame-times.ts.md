# frame-times.ts

## Purpose

A ring of the last frame times with nearest-rank p50 / p95 / p99 and the
max, for a LIVE readout. Moved from OsmDemo's `ar-sun-shadow.ts` on
2026-10-03 (DEC-H3; globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`,
PERF-0), gaining p99, so the AR sun shadow status line and the globe lab's
recorder overlay read one implementation.

## Public API

- `createFrameTimes(capacity = 300)` returns:
  - `push(ms)` - adds one frame time; a non-finite or negative value is
    ignored.
  - `summary(): FrameTimesSummary | null` - `{ p50, p95, p99, max, count }`
    over the frames in the ring, `null` before the first accepted value.
  - `RangeError` when `capacity` is not a positive integer.
- `FrameTimesSummary` - the summary's type.

## Invariants & assumptions

- **A window, not a run.** It keeps only the last `capacity` frames (300 is
  about 5 s at 60 Hz). A run of 10,000-26,000 frames needs
  `frame-histogram.ts`, whose counts are cumulative; the plan's review
  (Minor 9) is why both exist.
- The percentiles are the shared nearest rank (`percentile.ts`), so each is
  a frame time that happened; `p50 <= p95 <= p99 <= max` (property test).
- `summary()` sorts a copy of at most `capacity` values: call it at the
  readout's rate (a few times a second), not every frame.

## Examples

```ts
import { createFrameTimes } from 'gps-plus-slam-app-framework/utils/frame-times';

const times = createFrameTimes();
times.push(dtMs); // each frame
times.summary(); // { p50: 16.7, p95: 18.1, p99: 33.4, max: 81, count: 300 }
```

## Tests

`frame-times.test.ts`: the hidden slow frame shows in p95 / p99 / max; the
ring drops the oldest frames and bad values; capacity refusals; a
fast-check property that the summary equals the shared percentile of
exactly the last `capacity` accepted values.
