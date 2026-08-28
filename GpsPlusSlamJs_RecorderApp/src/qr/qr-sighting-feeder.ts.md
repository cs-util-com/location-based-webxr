# qr-sighting-feeder.ts

## Purpose

One-line: feed the recorder's derived QR placements into the session's
sighting accumulator, together with the alignment as it stood at that moment.

## Public API

- `createQrSightingFeeder(deps): QrSightingFeeder`
  - `deps.readAlignment()` — the session's alignment **right now**.
  - `deps.accumulator` — injectable for tests.
  - Returns `{ onPlacement, noteFrameChange, accumulator }`.
- `onPlacement(text, placement, timestampMs)` — wire into the debug
  controller's `onPlacement`.
- `noteFrameChange()` — the odometry frame changed.

## Invariants & assumptions

- **The alignment is read PER DETECTION, not once at wiring time.** The mint
  uses each sighting's contemporaneous alignment (plan DEC-3) and the store
  keeps no alignment history, so a snapshot taken once would make that whole
  decision inert. A test pins that `readAlignment` is called per detection and
  that a burst keeps its LAST value.
- **The snapshot is memory-only. It is never dispatched or persisted.** The
  recorder records RAW observations so a future algorithm can be re-tested
  against old recordings (decision D-A), and an alignment matrix is a DERIVED
  value. Nothing is lost: replaying the recording re-solves the same alignment
  at the same point.
- **Detections before the first GPS fix are still folded.** The mint decides
  later whether the evidence is usable; dropping them here would silently lose
  the first visit.
- It owns no derivation of its own — the placements come from the single
  deriver inside `qr-debug-controller.ts`, so the cube that is drawn and the
  evidence that is folded can never disagree.

## Examples

```ts
const sightings = createQrSightingFeeder({
  readAlignment: () => ({
    alignmentMatrix: selectAlignmentMatrix(state),
    zero: selectZeroReference(state),
    alignmentSampleCount: selectGpsPositions(state).length,
  }),
});
createQrDebugController({ ...deps, onPlacement: sightings.onPlacement });
```

## Tests

`qr-sighting-feeder.test.ts` — the per-detection alignment snapshot (and that
a burst keeps the last one); pose/size/accuracy passed through untouched; a
frame change forwarded so sightings stay separable; and a session with no
alignment yet still folding.
