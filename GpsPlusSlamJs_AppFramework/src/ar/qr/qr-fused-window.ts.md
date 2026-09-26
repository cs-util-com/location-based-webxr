# qr-fused-window.ts

## Purpose

Which recent detections of one code may be combined: the entry shape and
the window selection shared by the fused QR pose (`qr-fused-pose.ts`) and
the motion detector (`qr-motion.ts`). (QR near-frontal pose plan
2026-09-23-2314, M3b b1, §19, §26.) Its own module so both can use it
without importing each other.

## Public API

- `QrFusedEntry`: `{ timestamp, corners, cameraPose, intrinsics, frameEpoch?,
rawPose?, orderSource? }`. `timestamp` is ms on the producer's own clock (only
  differences count); `frameEpoch` is the tracking-frame epoch (bumped on an
  odometry restart; default 0); `rawPose` is the single-frame world pose
  when the producer solved one; `orderSource` where the corner order came
  from (`finder` / `memory` / `native`), absent when the producer does
  not say.
- `ignoreNativeWhenOrdered(entries, gapMs)` (QR near-frontal pose plan
  §54-§55): the entries without the `native` ones of the RUN ending at the
  newest entry (same epoch, no step over `gapMs`) when that run holds a
  `finder` or `memory` entry - a code's detector-order frames are 90/180
  deg wrong whenever it is rolled past 45 deg in the image, and 6 of 8 of
  them agreed on a stable pose 90 deg off. Entries without a source, an
  all-native run, and anything before a gap or in another epoch are kept
  (so an ordered entry from before a gap never silences the new natives -
  the slice caps by count, not time). The same array comes back when
  nothing is dropped. `selectFusedWindow` applies it first; so do the
  motion detector's `update()` and the fused tracker's motion cut.
- `selectFusedWindow(entries, options?)` (`windowSize`, `gapMs`, `radiusM`,
  `sinceMs`): the window, oldest to newest. Walking back from the newest entry it
  stops at another frame epoch, at a time step above `gapMs` between
  consecutive entries (in either direction, so a clock jump backwards also
  breaks it; a NaN step breaks too) or at an entry older than `sinceMs`; it
  leaves out entries whose raw position is farther than `radiusM` from the
  newest raw position IN THE RUN (so a newest entry whose own solve failed
  does not switch the filter off; entries without a raw pose are kept); at
  most `windowSize` entries.
- `QrFusedWindowOptions`, `FUSED_WINDOW_DEFAULTS` (`windowSize` 8, `gapMs`
  4000, `radiusM` Infinity (off), `sinceMs` -Infinity (off)) and
  `resolveFusedWindowOptions(options)`: a missing, NaN or out-of-range value
  takes its default instead of silently switching a check off. The fused
  pose resolves its own options on top of these.

## Invariants & assumptions

- Pure; the entries are never mutated, the window is a new array.
- `sinceMs` is on the entries' clock; the fused tracker sets it from the
  motion detector (`stillSinceMs`, or the newest timestamp while the code
  moves).

## Examples

```ts
const window = selectFusedWindow(entries, { windowSize: 4 });
```

## Tests

- In `qr-fused-pose.test.ts` (`describe('selectFusedWindow')`, which shares
  that file's walk helpers): the size cap, the gap boundary (exactly
  `gapMs` joins), a backwards clock jump, the epoch, the radius filter and
  its anchor, small out-of-order stamps, a NaN stamp, `sinceMs`, invalid
  options.
- Used by `qr-motion.ts` for the motion window, so the motion tests cover
  it too.
