# qr-sighting-feeder.ts

## Purpose

One-line: feed the recorder's derived QR placements into the session's
sighting accumulator, together with the alignment as it stood at that moment.

## Public API

- `createQrSightingFeeder(deps): QrSightingFeeder`
  - `deps.readAlignment()` — the session's alignment **right now**.
  - `deps.accumulator` — injectable for tests.
  - Returns `{ onPlacement, noteFrameChange, accumulator, alignmentFor }`.
- `onPlacement(text, placement, timestampMs)` — wire into the debug
  controller's `onPlacement`.
- `noteFrameChange()` - the odometry frame changed. Keeps the alignment the
  closing segment ended with, then starts a new segment. **Call it BEFORE
  the frame change reaches the store**: a tracking restart's reducer wipes
  the alignment (`main.ts` `onRestarted`; the loop-closure wrapper
  `segmentAwareStore` already calls it before dispatching).
- `alignmentFor(segment?)` - the most informed alignment that describes
  odometry segment `segment` (default: the current one), as a
  `QrMintAlignmentNow`, for the save-time mint, which places every sighting
  of a code through it:
  - the current segment: the session's alignment as it stands NOW;
  - an earlier segment: the alignment as it stood when that segment closed;
  - a segment it never saw close: no alignment (matrix and zero `null`), so
    the mint falls back to the sightings' own newest snapshot.

## Invariants & assumptions

- **The alignment is read PER DETECTION, not once at wiring time.** The mint
  places every sighting through `alignmentFor()`, and falls back to the
  newest per-sighting snapshot only when no alignment describes the code's
  segment; the store keeps no alignment history, so a snapshot taken once
  would make that fallback place codes through a stale matrix. (Until
  2026-10-02 every sighting went through its own snapshot, plan DEC-3,
  superseded by the owner.) A test pins that `readAlignment` is called per
  detection and that a burst keeps its LAST value.
- **A closed segment keeps the alignment it ended with** (milestone review
  M1, 2026-10-02). Without it, a code scanned as the recording started and
  followed by a tracking restart fell back to its own newest snapshot - the
  immature one, with the arbitrary yaw the start-at-code fix removed.
  Every segment below the current one was closed by `noteFrameChange`; an
  accumulator reset (store swap) restarts at segment 0, so an entry left
  from before a reset is overwritten before it can be read.
- **The snapshots are memory-only. They are never dispatched or persisted.**
  The recorder records RAW observations so a future algorithm can be
  re-tested against old recordings (decision D-A), and an alignment matrix
  is a DERIVED value. Nothing is lost: replaying the recording re-solves the
  same alignment at the same point.
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
// at save, per code:
const list = sightings.accumulator.sightingsIncludingOpen(text);
const current = sightings.alignmentFor(list.at(-1)?.segment);
```

## Tests

`qr-sighting-feeder.test.ts` — the per-detection alignment snapshot (and that
a burst keeps the last one); pose/size/accuracy passed through untouched; a
frame change forwarded so sightings stay separable; a session with no
alignment yet still folding; `alignmentFor()` reading the LIVE value with
the segment after a frame change; and a closed segment keeping the
alignment it ended with (and an unknown segment getting none).
`qr-level-zip-contributor.test.ts` covers the same through the save: a code
seen at the start and then a tracking restart is minted through the
alignment its segment closed with.
