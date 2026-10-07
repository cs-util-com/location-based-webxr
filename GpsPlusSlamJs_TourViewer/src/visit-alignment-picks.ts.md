# visit-alignment-picks.ts

## Purpose

One-line: for the running authoring visit, the alignment each object, the
measured code and each sighting of the code in hand is settled through - the
FIRST MATURE alignment at or after its own moment (40 m of session GPS
extent), else the latest usable one (owner decision D33, authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§6).

Why: the settle used to compose every object through the visit's alignment
at its END, so a note placed early and walked away from inherited all the
SLAM drift after it: 8.4 m p50 at 500 m with 1 % and 1 degree per 100 m, 18 m
at 2 %; a stored code seen again at the end of an out-and-back put start
notes 11 m off; and the correction's bound, judged through the drifted end
alignment, refused correct codes on long meanders
(`visit-settle.left-behind.test.ts`). The store keeps only the current
alignment, so the picks are folded here while it evolves.

The rule is the framework's (`gps-plus-slam-app-framework/state/alignment-maturity`,
DEC-H3: the Recorder's QR mint and the GPS anchor's `'mature-alignment'`
start-up fold the same pick). This module keys it by object, measurement and
sighting and keeps each event's time and walked distance; `visit-settle.ts` decides what to do
with them.

**Why a tracker and not the GPS anchor object** (D33 asked for "a new
start-up mode of the framework's GPS anchor so every entity uses one
mechanism"): the rule IS the anchor's - the same `MATURE_GPS_EXTENT_M` and
the same `openMatureAlignmentPick` / `advanceMatureAlignmentPick` that
`createGpsAnchor`'s `startup: 'mature-alignment'` folds - but an anchor is
one live object that moves a scene node from its own placement on, while
the settle needs, per visit, one pick per object, per measurement and per
sighting, read together at the visit's end and then thrown away, with the
sightings' times for "the sighting nearest each note". So the rule is
shared (DEC-H3) and applied through this per-visit tracker; no copy of it
lives here.

## Public API

- `SIGHTING_SPACING_MS = 1000` - sightings of one code within a second of the
  first of a run are one entry (the newest). Rests on: walking pace and 1 %
  drift, about 1 cm per second; it would matter only above tens of seconds.
  A run also ends when the walked distance changed since it began (a GPS
  fix moved it): an entry never claims a walked distance its merged
  sightings did not have (R3 of D33 picks by walked distance). The run is
  per code (M4 milestone review #6): a sighting merges with ITS code's
  latest entry, not only the very last one, so two codes seen in turn keep
  one entry per second each instead of one per detection.
- `createVisitAlignmentTracker(): VisitAlignmentTracker`
  - `noteAlignment(now)` - the alignment as it stands now
    (`{ alignmentMatrix, zero, gpsExtentM, alignmentInfo?, walkedM? }`,
    `PickedAlignmentMoment`, module-internal); every open pick follows it, a mature one
    stays. `alignmentInfo` (the mint gate's fix count and accuracy) travels
    with the pick, so a code re-minted through it records that alignment's
    quality block. `walkedM` is how far the author has walked in the visit
    (`walked-distance-tracker.ts`); each event noted after it is stamped
    with it.
  - `notePlacement(id, atMs)` - an object placed or MOVED (re-opens it at the
    alignment last noted).
  - `noteMeasurement(atMs, levelId?)` - a code measured in this visit;
    with `levelId` it is also kept per code (`picks().measurements`, code
    book plan M4c-2), and `measurement` stays the latest one.
  - `noteSighting(sighting, atMs)` - a stable sighting of the code in hand.
  - `picks(): VisitAlignmentPicks` - copies: `objects` (by id),
    `measurement`, `sightings` (oldest first), each
    `{ atMs, walkedM?, alignment, alignmentInfo?, gpsExtentM? }` with
    `gpsExtentM` the session GPS extent of the alignment the pick froze at
    (the D31 marker of a code re-minted through it, R7), `alignment` null
    when no usable alignment was noted since, and `walkedM` the walked
    distance at the event's OWN moment (not at the alignment its pick froze
    at), absent when the caller never passed one. The settle reads it for
    "near a code event" (reviews R1 and R3 of D33).
  - `reset()` - a new visit.
  - `forgetCode(levelId)` - that code's sightings and measurement pick go
    (its printed size was adopted: they were solved at the old size; M5a
    milestone review #1).

## Invariants & assumptions

- **Caller order.** Each `note*` opens at the alignment last passed to
  `noteAlignment`, so the caller syncs first (`creator-setup.ts`'s
  `syncAlignmentPicks`, also run on every store change).
- **The measurement opens when the measure resolves, not at the tap.**
  `creator-setup.ts` notes it after the level's id is derived and the hosted
  zip is checked (milliseconds, at most seconds); `atMs` is the tap's, the
  opening alignment the one current then (accepted 2026-10-04: the pick is
  the first mature alignment at or after a moment a few seconds late).
- **Fallback.** A pick that never matures follows the alignment to the
  last usable one, which at the settle IS the end-of-visit alignment (the
  caller syncs once more before reading).
- **No persistence, no dispatch.** A replay re-solves the same alignments; a
  killed tab keeps the tap-time geo as before.
- **Nothing visible.** Only the settle reads the picks; previews stay rigid
  under the world group as placed.
- **Bounded enough.** One sighting entry per second of looking; an hour of
  looking is 3,600 small entries.
- **One odometry frame per visit, by the caller's guarantee (review R8 of
  D33).** The tracker has no odometry-segment notion: every pick maps the
  visit's odometry, and the walked distances it stamps are one path. A
  tracking restart or a loop closure would start a new segment, after which
  older picks map the new odometry wrongly and the walked distance gains a
  jump. It is safe only because the Tour Viewer never puts either into its
  store: it neither dispatches `odometryTrackingRestarted` /
  `arLoopClosureDetected` nor wires the hooks that would (`onRestarted`,
  the framework's live loop-closure handler). Guarded by
  `visit-alignment-picks.no-segments.test.ts` (a source scan); the day the
  Tour Viewer handles either, the picks need segments first.

## Examples

```ts
const picks = createVisitAlignmentTracker();
picks.noteAlignment({ alignmentMatrix, zero, gpsExtentM });
picks.notePlacement(pin.id, Date.now());
// ... at the visit's end:
planVisitSettle({ ...input, picks: picks.picks() });
picks.reset();
```

## Tests

- `visit-alignment-picks.test.ts` - frozen at the first mature alignment
  after the placement, or its own when already mature; follows to the latest
  usable alignment otherwise; a move re-opens; a placement before any
  alignment; one sighting per second of looking with its own time and pick;
  a run split where the walked distance changed;
  two codes never merged, and two codes seen in turn merged per code; the mint info and the GPS extent travel with
  their pick; each event
  stamped with the walked distance of its own moment; reset; copies; a property test against the search
  over the alignment history.
- `visit-settle.test.ts` ("each object at its own moment") and
  `visit-settle.left-behind.test.ts` (the shipped path at three sweep
  cells, and the `SHIPPED` sweep columns).
- `authoring-settle.test.ts` - the wiring through the real creator setup.
- `visit-alignment-picks.no-segments.test.ts` - no Tour Viewer source
  dispatches a tracking restart or loop closure or wires their hooks (R8).
