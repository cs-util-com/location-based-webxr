# visit-log.ts

## Purpose

The page-side log of the creator's AR visits (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3 and §7 #4, milestone M3b): each visit's GPS track and fused path, and
each code as that visit measured it, for the summary after Finish
(`summary-model.ts`). The store wipes the track, the odometry and the
alignment at every AR exit (`teardownArSessionState`), so the settle - which
runs while the store still holds the visit - copies what the summary needs
here, and `creator-setup.ts` writes it into the draft (`writeDraftVisit`,
one file per visit) so a reload keeps it.

## Public API

- `buildVisitLogEntry(input: VisitLogInput): VisitLogEntry` - the entry of
  one visit from the store's slices as the settle reads them:
  `gpsPositions` and `odometryPositions` (paired index for index),
  `alignment` (the store's at the visit's end: what the codes go through),
  `pathAlignment` (what the visit's objects settled through: what the fused
  path goes through), `zero`, an optional `storeAccuracyM` fallback, and the
  `codes` the visit saw (`levelId` + raw WebXR `odomPose`).
- `VisitLogEntry`: `visitId`, `atMs`, `gpsAccuracyM` (median of the device
  fixes' reported accuracies, else the store's median, else null),
  `baselineM` (largest horizontal extent of the walk), `gps` (thinned raw
  device fixes with their accuracy), `fused` (thinned odometry through
  `pathAlignment`), `codes` (`levelId` + `geo`).
- `codeVisitPoses(entries, levelId): CodeVisitPose[]` - the input of
  `combineCodeVisits` for one code (a visit without an accuracy hands NaN,
  which the combiner skips), from the code's latest move boundary on
  (`entries` oldest first).
- `serializeVisitLogEntry(entry): string` / `parseVisitLogEntry(text)` - the
  draft file: compact arrays, degrees rounded to 7 decimals (about 1 cm),
  accuracy to 0.1 m; read back defensively (null for a file that is not
  this version's entry; a bad point or code costs itself).
- `createVisitLog(): VisitLog` - the in-memory log: `record` (replaces a
  visit settled again), `restore` (a restored draft's visits; a live one is
  kept), `entries` (oldest first), `ids`, `clear`.
- `newVisitId(pageId, generation)`, `thinPath(points, distanceM, spacingM?,
maxPoints?)`, `maxHorizontalExtentM(positions)`.
- `deviceSamples({ gpsPositions, odometryPositions })` - THE device-only
  filter over the store's GPS history: each readable device fix
  (`{ lat, lng, accuracy? }`), its odometry partner (null when the two
  arrays are not paired or the position is not finite) and its own
  `timestampMs` when finite; synthetic code votes left out. The entry
  builder reads through it, and so do the moved-code estimators
  (`code-displacement.ts`, D20/M5a), which count evidence in time.
- Constants: `VISIT_PATH_SPACING_M` (1), `VISIT_PATH_MAX_POINTS` (1,000);
  module-private `VISIT_LOG_VERSION` (1).

## What a visit stores for a code (the M3a record)

The M3a results (`2026-10-01-0354-code-estimate-across-visits-results.md`,
"What the draft must store") ask for, per code and per visit, one key per
visit written at the settle: the level id, a visit id that survives a
reload (`arSessionGeneration` restarts at 0 on every load, so the id is a
random page id plus the generation), the time, the code's geo through THAT
visit's own end-of-visit alignment WITHOUT the code correction, the median
GPS accuracy, and `baselineM`. The entry carries exactly that; the per-code
values that are per-visit (time, accuracy, baseline) are stored once per
entry and joined back in `codeVisitPoses`.

- **Why not code-corrected**: a corrected visit is aligned ONTO the stored
  pose, so its "measurement" of the code would just repeat the stored pose
  and fake agreement. Each visit is one independent GPS estimate only
  through its own alignment.
- **Which pose**: the visit's LAST look at the code (M3a/M3b review #8):
  `creator-setup.ts` hands the measurement first and then the latest
  stable sightings, and a code named twice keeps the last one - the later,
  longer-settled pose, and what the M3a spike measured each visit by.
  Keeping the first logged the tap-time pose instead.
- **Every stored code the visit saw**, not only the one in hand (M3a/M3b
  review #6): `creator-setup.ts` hands each stored code's latest stable
  sighting, so the tour's other codes gather visits too.
- **`savedGeo`** (optional, per code): the pose THIS visit's settle saved
  for the code (`input.saved`), when it saved one. The summary finds the
  visit a stored pose came from by it, to grade what visitors get (M3a/M3b
  review #2). Version 1 files without it read as before; an unreadable one
  costs that field, not the code.
- **`moved`** (optional, per code, only ever `true`; authoring plan §3.6,
  M5b, §7j #12): THIS visit moved the code to a new spot (the author
  answered "Use the new spot"; `input.moved` lists the levels). Earlier
  visits describe the old spot, so `codeVisitPoses` reads only from the
  latest marked visit on, and the summary's estimate never sits between
  two spots. An undo before Finish re-records the visit without it.
  Anything but `true` in a file reads as no mark.

## Parameters and what they rest on

- `VISIT_PATH_SPACING_M = 1`: GPS at about 1 Hz with 3-15 m accuracy says
  nothing below a metre that its noise does not drown; the fused path's
  sub-metre wiggles are under a pixel at the summary's framing (zoom 17-18,
  0.6-1.2 m per pixel at 47°N). A 20-minute walk keeps about 1,200 points per
  path. Standing still thins the fused path to almost nothing but NOT the
  raw track: GPS noise often moves a fix by more than a metre from one
  second to the next, so most standing fixes can be kept, and the cap below
  bounds a long stand. Reverses for a summary that zooms in to inspect
  sub-metre detail (then 0.25 m), which this screen does not offer.
- `VISIT_PATH_MAX_POINTS = 1000`: a cap on the draft file (about 30 kB per
  path), not a look; it bites only past about a kilometre in one visit.
- **The baseline is measured on the thinned odometry**: a subset of the
  walk, so it is at most two spacings (2 m) SHORT of the full extent - the
  conservative side for the heading model `atan(a / L)` - and the O(n²)
  runs over hundreds of points, not thousands, on the session-end path.

## Invariants & assumptions

- The store is external data here: unreadable fixes (non-finite or out of
  range), odometry that is not paired index for index with the fixes, a
  missing or non-finite alignment and codes that cannot be minted are left
  out, never repaired.
- **Synthetic code votes are not the walk**: a fix whose source is not the
  device (`gpsPointSourceOf`) is dropped with its odometry partner (a
  vote's odometry is the code's corner, not where the creator stood).
- `thinPath` returns an ordered subset with the first and last point,
  consecutive points at least `spacingM` apart (but the last), at most
  `maxPoints` (property test).
- Without an alignment a visit keeps its raw walk, but no fused path and no
  code.

## Examples

```ts
const entry = buildVisitLogEntry({
  visitId: newVisitId(pageId, ctx.arSessionGeneration),
  atMs: Date.now(),
  gpsPositions: selectGpsPositions(state),
  odometryPositions: selectOdometryPositions(state),
  alignment: selectAlignmentMatrix(state),
  pathAlignment: settle.alignment,
  zero: selectZeroReference(state),
  codes: [{ levelId, odomPose }],
});
log.record(entry);
await writeDraftVisit(store, entry);
combineCodeVisits(codeVisitPoses(log.entries(), levelId));
```

## Tests

- `visit-log.test.ts`: the median, the extent and the thinned walk; votes
  left out; the code through the PLAIN alignment while the path goes
  through the corrected one; no alignment; a non-finite alignment; the
  accuracy fallback; unreadable fixes and unpaired odometry; one record per
  code from its last look; the saved pose on that code only, round-tripped,
  an unreadable one costing only itself; `thinPath` (cases and a property); the draft file round trip (case
  and property) and its defensive read; the in-memory log; `codeVisitPoses`
  into `combineCodeVisits`; the move boundary (marked on the moved code
  only, round-tripped, and combining only from the latest move on); `deviceSamples` keeps device fixes with their
  odometry and time and drops the votes.
- `code-displacement.test.ts` and the M5a block of
  `viewer-vote-strength.test.ts` read the store's history (votes present)
  through `deviceSamples`.
- `draft-persistence.test.ts`: a visit's file survives a reload, a corrupt
  one costs itself, a rejected one is swept.
- `authoring-settle.test.ts`: the settle writes one entry per visit into the
  log and the draft; another stored code's sighting is logged as its visit.
