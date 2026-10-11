# alignment-maturity.ts

## Purpose

One-line: the maturity floor of an alignment (`MATURE_GPS_EXTENT_M` = 40 m of
session GPS extent) and the pure pick behind "the FIRST MATURE alignment at or
after a moment" - the one rule through which an object seen or placed at that
moment gets its global position.

Three callers fold the same pick (DEC-H3, one implementation):

- the Recorder's QR mint (`../ar/qr/qr-mint-alignment-tracker.ts`, owner
  decision D28 revised): a code through the first mature alignment at or
  after its last sighting;
- the GPS anchor's `'mature-alignment'` start-up
  (`../visualization/gps-anchor.ts`, D33): an object placed live gets its GPS
  point fixed through the first mature alignment at or after its placement;
- the Tour Viewer's authoring settle (`GpsPlusSlamJs_TourViewer/src/visit-alignment-picks.ts`,
  D33): each note, each measured code and each sighting of a stored code.

Why: an alignment fitted to the END of a long walk sees an object placed
early displaced by all the SLAM drift walked after it (8.4-8.6 m p50 at
500 m with 1 % and 1 degree per 100 m); the alignment at the moment itself
has a yaw of GPS noise while the walk is short (41 degrees p50 below 5 m of
extent). The first mature one keeps both: about 1.2 m, flat in the distance
walked after.

## Public API

- `MATURE_GPS_EXTENT_M = 40` - the floor (owner decision D34, lowered from
  80 m); its doc comment carries the
  measurement, the swept range and the values that reverse it.
- `AlignmentMoment` - `{ alignmentMatrix, zero, gpsExtentM? }`: the alignment
  as it stands at one moment (column-major odometry-NUE -> GPS-world NUE, the
  GPS zero, the session extent from `gps-extent-tracker.ts`).
- `MatureAlignmentPick<A>` - `{ alignment, mature }`.
- `isUsableAlignment(a)` - a matrix and a zero.
- `isMatureAlignment(a, floorM = 40)` - usable, and a finite extent at or
  above the floor.
- `checkMatureGpsExtentM(floorM)` - the floor to use (40 when absent);
  `RangeError` unless positive and finite (a caller bug, not data).
- `openMatureAlignmentPick(now, floorM?)` - the pick at the moment itself.
- `advanceMatureAlignmentPick(pick, now, floorM?)` - one alignment change
  after it: a mature pick stays; an open one moves to `now` when `now` is
  usable.

## Invariants & assumptions

- **Fixed once mature.** No later alignment moves a mature pick (property
  test).
- **Equals the search.** Folding a sequence gives the first mature moment
  (the opening moment included), else the last usable one, else the opening
  one (property test against a brute-force search).
- **Defensive:** an unknown, NaN or infinite extent is never mature (the
  floor is the only evidence that the yaw is observable); an unusable `now`
  (no matrix or no zero: a GPS gap, a reset store) never replaces a usable
  pick.
- **No copies, no history.** The pick keeps the caller's object; a caller
  that reuses its matrix arrays copies them first (the GPS anchor does). The
  store keeps only the current alignment, so the caller folds while it
  evolves; a session that ends before maturity falls back to the latest
  usable alignment the pick followed (the caller's "settle now").
- **The floor is a session property.** "Mature" means the session's extent
  reached the floor, not that it grew by the floor after the moment: once
  the session is mature an object is fixed through the alignment of its own
  moment, so no drift accumulates between the object and its fix. Waiting
  for the floor MORE after each object (an alternative reading of D33) would
  add the drift of those metres, and an object placed inside an area already
  walked might never see the extent grow and fall back to the end-of-visit
  alignment - the regression this rule removes.

## Examples

```ts
let pick = openMatureAlignmentPick({ alignmentMatrix, zero, gpsExtentM });
// on every alignment change:
pick = advanceMatureAlignmentPick(pick, {
  alignmentMatrix: next,
  zero,
  gpsExtentM: extentNow,
});
if (pick.mature) {
  /* place the object through pick.alignment, once */
}
```

## Tests

- `alignment-maturity.test.ts` - the 40 m constant; maturity needs a matrix,
  a zero and a finite extent; a bad floor throws; follow-then-freeze; frozen
  at the moment when already mature; an unusable alignment never replaces a
  usable one; a caller floor.
- `alignment-maturity.property.test.ts` - the fold equals the search over the
  history; a mature pick never moves.
- Callers: `../ar/qr/qr-mint-alignment-tracker.test.ts`,
  `../visualization/gps-anchor.mature-alignment.test.ts`, the Tour Viewer's
  `visit-alignment-picks.test.ts` and `visit-settle.left-behind.test.ts`.
