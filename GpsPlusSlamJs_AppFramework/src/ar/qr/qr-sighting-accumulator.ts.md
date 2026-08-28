# qr-sighting-accumulator.ts

## Purpose

One-line: fold a stream of QR detections into per-code **sightings** — the
bursts that happen each time someone walks up to a printed code — so a whole
recording can be minted from them.

The mint cannot read this back from the detection slice at save time: the
recorder's ring holds the last 100 entries, which at the default 125 ms
cadence is about **twelve seconds**. A three-minute walk with ten sightings
has lost every early one by the time the session stops. So the fold happens as
detections arrive, and memory stays O(sightings) rather than O(detections).
Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-B.

## Public API

- `DEFAULT_SIGHTING_GAP_MS: number` — longest pause inside one sighting.
- `createQrSightingAccumulator(options?): QrSightingAccumulator`
  - `observe(observation)` — fold one already-solved detection in.
  - `noteFrameChange()` — the odometry frame changed; close open bursts and
    start a new segment.
  - `sightingsIncludingOpen(text)` — **what a mint should read**: every
    sighting including the visit in progress, without ending it.
  - `hasOpenBurst(text)` — is a visit in progress?
  - `flush()` — close every open burst. **Idempotent.** Note that it
    MUTATES: the mint runs on every 60-second crash-safety sync, and flushing
    there would end the visit in progress, so the next detection starts a new
    one and one visit is split into two — both then carrying near-maximum
    recency weight, double-counting a single viewpoint.
  - `sightings(text)` — closed sightings for one code, oldest first.
  - `codes()` — every code seen.
  - `spansFrameChange(text)` — whether this code's sightings straddle a frame
    change.
  - `reset()`.
- Types `QrSightingObservation`, `QrSighting`,
  `QrSightingAccumulatorOptions`.

## Invariants & assumptions

- **A sighting is a run of detections of one code with no gap longer than
  `gapMs`.** Standing at a poster is one sighting; walking a loop and coming
  back is two. The boundary decides what the fixedness gate compares, so an
  off-by-one here would silently merge a walk-away and a return into a single
  "visit" and hide the very disagreement the gate measures.
- **The odometry frame is part of the model.** A tracking restart or a loop
  closure changes the frame while stored QR poses stay in the old one, so
  sightings on either side are not comparable — comparing them reads as a
  moved poster, or worse averages two frames into a plausible-looking anchor.
  `noteFrameChange()` closes the open burst and increments the segment, and
  `spansFrameChange()` lets the mint decline honestly.
- **`sightings()` never reports an open burst; `sightingsIncludingOpen()`
  does, without closing it.** Under recency weighting the last sighting counts
  most, and stopping a recording right after a final scan leaves that burst
  open — so the mint must see it. Reading it non-destructively is what lets
  the mint run repeatedly (every crash-safety sync) without changing the
  answer.
- **Per-burst state carries the burst's LAST alignment, zero, sample count and
  GPS accuracy**, because the mint uses each sighting's contemporaneous
  alignment and the end of a burst is the moment the session knew most.
- **Poses per burst are capped** (`maxPosesPerSighting`, default 32) and the
  most RECENT are kept: a visitor standing at a poster produces detections
  indefinitely, and later frames in a burst come from more viewpoints with a
  more converged size estimate. `detectionCount` still counts **every**
  detection; `posesUsed` says how many the aggregate saw.
- **Aggregation is delegated**, not reimplemented: `aggregateQrPose` for the
  robust pose and its spreads, `interpolatingMedian` for the size.
- **Non-finite input is dropped silently** — a detection with a NaN in its
  pose is not evidence, and throwing on the detection path would take the
  recording down.
- `DEFAULT_SIGHTING_GAP_MS` is a **guess until the field recordings measure
  the real gap distribution**. It only has to separate "still looking at it"
  from "walked a loop and came back", and the planned walks leave ~30 s
  between visits.

## Examples

```ts
const acc = createQrSightingAccumulator();

// on every derived detection
acc.observe({
  text,
  timestamp,
  odomPose,
  sizeM,
  alignmentMatrix: selectAlignmentMatrix(state),
  zero: selectZeroReference(state),
  alignmentSampleCount: selectGpsPositions(state).length,
});

// on odometryTrackingRestarted / arLoopClosureDetected
acc.noteFrameChange();

// at mint time — NON-destructively, because this also runs on every
// crash-safety sync and flushing there would split the visit in progress
for (const text of acc.codes()) {
  if (acc.spansFrameChange(text)) continue; // not comparable
  mintFrom(acc.sightingsIncludingOpen(text));
}
```

## Tests

- `qr-sighting-accumulator.test.ts` — one burst folded; bursts split by the
  gap; a single detection still counts; an open burst is never reported and
  flush is idempotent; codes stay independent under interleaving; a frame
  change splits bursts 125 ms apart and bumps the segment; `spansFrameChange`;
  the robust aggregate sitting on the cluster rather than the outlier; the
  median size and the last alignment; the pose cap with the full detection
  count preserved; non-finite input dropped; reset; and the non-destructive
  read — it includes the visit in progress, reading it twice does not split
  it, and it agrees with what `flush()` would have produced.
- `qr-sighting-accumulator.property.test.ts` — over arbitrary timelines: the
  split count equals the number of gaps exceeding the threshold; every
  detection is accounted for exactly once; sightings stay ordered and
  non-overlapping; and interleaving another code changes nothing.

No fixtures required.
