# qr-mint-alignment-tracker.ts

## Purpose

One-line: decide, per QR code, which alignment the save-time mint composes it
through - the FIRST MATURE alignment at or after the code's last sighting
(owner decision D28, revised 2026-10-02; candidate a3 at 80 m).

Maturity is a session GPS extent of at least `QR_MINT_MATURE_GPS_EXTENT_M`
(80 m, `../../state/gps-extent-tracker.ts`). Until a code's alignment matures
its snapshot follows the alignment; a new sighting re-opens it. A recording
saved before maturity falls back to the alignment at save; a segment that
closes first (tracking restart, loop closure) freezes a waiting code at the
alignment it closed with.

Why not the alignment at save for everything (a2, shipped on 2026-10-02 and
replaced the same day): a code seen mid-recording and then walked away from
inherits all SLAM drift after its sighting (8.6 m p50 at 500 m away, 1 % and
1 degree per 100 m). The first mature alignment keeps it at 1.1-1.7 m while
keeping the start-at-code heading fix (a short walk never reaches the floor,
so it is the alignment at save there).

## Public API

- `QR_MINT_MATURE_GPS_EXTENT_M = 80` - the maturity floor, the shared
  `MATURE_GPS_EXTENT_M` of `../../state/alignment-maturity.ts` under the
  mint's name (one constant for the mint, the GPS anchor's
  `'mature-alignment'` start-up and the Tour Viewer's settle, D33); that
  constant's doc comment
  carries the measured reason, the swept range and the reversing value
  (10-20 m).
- `createQrMintAlignmentTracker(options?)`
  - `options.matureGpsExtentM` - the floor; must be positive and finite,
    else `RangeError` (a caller bug, not data).
- `noteSighting(text, now)` - a detection of `text` with the alignment now
  (a `QrMintAlignmentNow`, including `segment` and `gpsExtentM`). Opens or
  re-opens the code; freezes it at once when `now` is already mature.
- `noteAlignment(now)` - the alignment changed: every open code of
  `now.segment` moves to it, and freezes when it is mature. An alignment with
  no matrix or no zero is ignored.
- `closeSegment(closing)` - segment `closing.segment` ends: its open codes
  freeze at `closing` (or keep their snapshot when `closing` is unusable). A
  code already frozen at a mature alignment keeps it.
- `alignmentFor(text, live)` - the alignment to mint through: the frozen
  snapshot; or `live` while the code is still open in `live.segment` (the
  save before maturity); or the open snapshot of another segment (not
  reachable when every frame change goes through `closeSegment`). A code
  never reported gets `live`.
- `reset()` - forget every code.

## Invariants & assumptions

- **Maturity needs a known, finite extent and a usable alignment.** An
  absent or NaN `gpsExtentM` is never mature, so a caller that cannot
  supply the extent gets the alignment at save for every code (a2).
- **The extent is monotonic within a segment's store**, so once mature at a
  sighting, every later sighting is mature at once: the snapshot is then the
  alignment of the code's LAST detection.
- **Memory only.** Nothing here is dispatched or persisted (decision D-A);
  a replay re-solves the same alignments.
- **The caller reports in time order:** detections and alignment changes as
  they happen, a frame change BEFORE it reaches the store (a restart's reducer
  wipes the alignment).

## Examples

```ts
const tracker = createQrMintAlignmentTracker();
tracker.noteSighting(text, { ...readAlignment(), segment }); // per detection
tracker.noteAlignment({ ...readAlignment(), segment }); // per store change
tracker.closeSegment({ ...readAlignment(), segment }); // before a restart
mintQrAnchorFromSightings({
  sightings,
  spansFrameChange,
  nowIso,
  currentAlignment: tracker.alignmentFor(text, { ...readAlignment(), segment }),
});
```

The Recorder's `qr-sighting-feeder.ts` is the production caller.

## Tests

- `qr-mint-alignment-tracker.test.ts` - following until the first mature
  alignment and freezing there; freezing at the sighting when already
  mature; the fallback to the live alignment before maturity; re-opening on
  a new sighting; per-code independence; the closing alignment of a segment
  and a mature alignment surviving a close; unusable alignments and unknown
  extents; reset; the floor option.
- `qr-anchor-mint.start-at-code.test.ts` - the shipped path end to end on
  simulated recordings through the real store and solver: the start-at-code
  heading and position, and a code left 500 m behind (default run); the
  opt-in sweeps measure the `a3-80 shipped` column against every candidate.
