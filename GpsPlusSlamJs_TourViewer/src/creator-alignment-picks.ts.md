# creator-alignment-picks.ts

## Purpose

The running AR visit's per-moment alignments for the creator (owner
decision D33): each object placed or moved, the code measured and each
sighting of the code in hand is settled through the first mature alignment
after its own moment (`visit-alignment-picks.ts`), not the drifted end one.
Split out of `creator-setup.ts` unchanged in the code book refactor plan's
M2 (`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M4 makes the sightings per code, and this is where they will live.

## Public API

- `wireCreatorAlignmentPicks({ arStore, codes, alignmentInfo }): CreatorAlignmentPicks`
  - `alignmentInfo()` - the mint gate's view of the alignment
    (`creator-setup.ts`'s `authorAlignmentInfo`), recorded with each
    alignment the picks see.
- `CreatorAlignmentPicks`:
  - `sync()` - hand the picks the alignment as it stands now, but only
    when the alignment, the zero or the fix count changed (references
    compared, so an unchanged store costs nothing). Called on every store
    change and before every noted moment.
  - `notePlaced(id)` - an object placed or moved now.
  - `setSighting(sighting)` - the visit's sighting of the code in hand
    changed: kept by `creator-codes.ts` and noted now.
  - `noteMeasurement(atMs)` - the code measured in this visit, at the tap's
    moment (the caller syncs first, once the level's id has resolved).
  - `picks()` - the picks so far; `gpsExtent(positions)` - the session's GPS
    extent (40 m maturity, D34; the D31 marker of a re-minted code).
  - `reset()` - a new visit's picks start empty.

## Invariants & assumptions

- Nothing visible depends on the picks: the previews stay rigid as placed;
  only the settle at the visit's end (or at a Finish) reads them.
- Every noted moment syncs first, so a pick never opens at an alignment the
  tracker has not seen yet.
- The walked distance (R1, R3 of D33) is the device fixes' and odometry's,
  stamped on each alignment.

## Tests

Composed, through `wireCreatorSetup`: `authoring-settle.test.ts` (each
object settled through its own moment's pick, the measured code's pick, the
end-alignment fallback). The tracker itself: `visit-alignment-picks.test.ts`.
