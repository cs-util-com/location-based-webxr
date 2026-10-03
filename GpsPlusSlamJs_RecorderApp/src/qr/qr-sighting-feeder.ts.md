# qr-sighting-feeder.ts

## Purpose

One-line: feed the recorder's derived QR placements into the session's
sighting accumulator, and keep, per code, the alignment the save-time mint
will place it through.

Which alignment is owner decision D28, revised 2026-10-02: the FIRST MATURE
alignment at or after the code's last sighting, maturity being a session GPS
extent of 80 m (`QR_MINT_MATURE_GPS_EXTENT_M`). The rule lives in the
framework's `qr-mint-alignment-tracker.ts`, so the measurement that chose it
(`qr-anchor-mint.start-at-code.test.ts`) runs the same code; this module
feeds it.

## Public API

- `createQrSightingFeeder(deps): QrSightingFeeder`
  - `deps.readAlignment()` — the session's alignment **right now**: matrix,
    zero, GPS fix count, optional GPS accuracy and optional GPS extent
    (`createGpsExtentTracker`). Without the extent no alignment counts as
    mature and every code falls back to the alignment at save.
  - `deps.accumulator` — injectable for tests.
  - Returns `{ onPlacement, noteAlignment, noteFrameChange, reset,
accumulator, alignmentFor }`.
- `onPlacement(text, placement, timestampMs)` — wire into the debug
  controller's `onPlacement`. Folds the detection and (re)opens the code's
  alignment snapshot at the alignment now.
- `noteAlignment()` - the alignment may have changed (a GPS fix is a store
  change): every code still waiting for a mature alignment follows it, and
  freezes at the first mature one. `wire-qr-recording.ts` calls it once per
  animation frame on store changes.
- `noteFrameChange()` - the odometry frame changed. Freezes every waiting
  code of the closing segment at the alignment it ended with, then starts a
  new segment. **Call it BEFORE the frame change reaches the store**: a
  tracking restart's reducer wipes the alignment (`main.ts` `onRestarted`;
  the loop-closure wrapper `segmentAwareStore` already calls it before
  dispatching).
- `reset()` - discard every sighting and every kept alignment (the Start
  Recording store swap).
- `alignmentFor(text)` - the `QrMintAlignmentNow` the save-time mint places
  every sighting of `text` through:
  - its frozen snapshot: the first mature alignment at or after its last
    sighting, or the alignment its segment closed with;
  - while it is still waiting in the current segment: the session's
    alignment as it stands NOW (the save before maturity, which is the
    start-at-code fix);
  - a code it never saw: the alignment now.

## Invariants & assumptions

- **The alignment is read per detection AND per store change.** The store
  keeps no alignment history, so a code left behind can only be frozen at
  the first mature alignment if the feeder hears of every change (a test in
  `wire-qr-recording.test.ts` pins the store-change path).
- **Why not the alignment at save for every code.** A code seen
  mid-recording and then walked away from inherits all SLAM drift after its
  sighting through it (8.6 m p50 at 500 m away, 1 % and 1 degree per 100 m);
  the first mature alignment keeps it at 1.1-1.7 m. A short recording never
  reaches 80 m, so it gets the alignment at save, which is the start-at-code
  fix (72 degrees heading p50 through the sighting's own immature snapshot,
  about 4 through the walked one).
- **A segment that closes freezes its waiting codes** (milestone review M1,
  2026-10-02). Without that, a code scanned as the recording started and
  followed by a tracking restart fell back to its own newest snapshot - the
  immature one, with the arbitrary yaw the start-at-code fix removed. A code
  that matured before the restart keeps its mature alignment.
- **The snapshots are memory-only. They are never dispatched or persisted.**
  The recorder records RAW observations so a future algorithm can be
  re-tested against old recordings (decision D-A), and an alignment matrix
  is a DERIVED value. Nothing is lost: replaying the recording re-solves the
  same alignments at the same points.
- **Detections before the first GPS fix are still folded.** The mint decides
  later whether the evidence is usable; dropping them here would silently lose
  the first visit.
- It owns no derivation of its own — the placements come from the single
  deriver inside `qr-debug-controller.ts`, so the cube that is drawn and the
  evidence that is folded can never disagree.

## Examples

```ts
const extent = createGpsExtentTracker();
const sightings = createQrSightingFeeder({
  readAlignment: () => ({
    alignmentMatrix: selectAlignmentMatrix(state),
    zero: selectZeroReference(state),
    alignmentSampleCount: selectGpsPositions(state).length,
    gpsExtentM: extent.update(selectGpsPositions(state)),
  }),
});
createQrDebugController({ ...deps, onPlacement: sightings.onPlacement });
store.subscribe(() => sightings.noteAlignment()); // coalesced per frame
// at save, per code:
mintQrAnchorFromSightings({ ..., currentAlignment: sightings.alignmentFor(text) });
```

## Tests

`qr-sighting-feeder.test.ts` — the per-detection alignment snapshot (and that
a burst keeps the last one); pose/size/accuracy passed through untouched; a
frame change forwarded so sightings stay separable; a session with no
alignment yet still folding; and the mint-time alignment: the alignment at
save before maturity, the first mature alignment after the sighting (and
not a later one), a new sighting re-opening the code, the closing alignment
of a segment for a waiting code (and the live one for a code never seen),
and reset forgetting both.
`qr-level-zip-contributor.test.ts` covers the same through the save: a code
seen at the start and then a tracking restart is minted through the
alignment its segment closed with, and a code left behind through the
mature alignment of its sighting rather than the one at save.
`wire-qr-recording.test.ts` pins that store changes reach `noteAlignment`.
