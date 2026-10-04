# qr-fused-pose-tally.ts

## Purpose

The lock counts of ONE stream of fused QR pose results (QR near-frontal
pose plan §66): how many were stable, why the rest were not, and which were
re-reads. The QR demo's `?qrperf` report (`fused-tally.ts`) and the
TourViewer's `?debug=1` readout count by this one rule (DEC-H3), so their
numbers compare.

## Public API

- `createFusedPoseTally(): FusedPoseTally`
  - `add(result: QrFusedPose): boolean` - count one result; `false` when
    it was a re-read.
  - `summary(): FusedPoseCounts` - a copy of the counts so far.
- `FusedPoseCounts`: `locks`, `reReads`, `stable`, `empty`,
  `nativeIgnoredLocks`, `notStable: { views, fit, fallback, motion, order }`.

## Invariants & assumptions

- **Re-read:** the same `frameEpoch` and an EQUAL finite `newestTimestamp`
  as the last counted result (plan §57 #6): the fused window did not read
  the newest detection - since plan §54, an ignored native frame. A re-read
  counts in `reReads` and nowhere else. A new epoch, an older timestamp (a
  clock step back) or a NaN timestamp is never one.
- **Every lock lands in one bucket:** `locks = stable + sum(notStable)`,
  because the tracker gives every non-stable result a reason (an `unknown`
  result carries `views`). `empty` counts the `unknown` ones again, apart:
  "nothing in this frame yet" (an evaluation right after a restart) is not
  "too few views".
- **One tally per stream.** Keep one per code when the counts are read per
  code (the TourViewer); the demo keeps one across its codes, as its report
  always did, so its re-read check compares consecutive results of any code.
- `summary()` returns a copy; later adds do not change it.

## Examples

```ts
const tally = createFusedPoseTally();
const source = createFusedQrPoseSource({
  entriesOf,
  onEvaluated: (result) => tally.add(result),
});
// ...
const { locks, stable, notStable } = tally.summary();
```

## Tests

- `qr-fused-pose-tally.test.ts` - the buckets, the re-read rule and its
  non-cases, `empty`, the native count, the copy.
- `qr-fused-pose-tally.property.test.ts` - every add is a lock or a
  re-read, and every lock is in exactly one bucket.
