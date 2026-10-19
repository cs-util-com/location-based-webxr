# tour-content.ts

## Purpose

The Tour Viewer's write path for a version 3 tour (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3, D20, D21). The pages place, move and compare a WORLD view: every pin and
photo with its geo pose, as the framework's `tourObjects` reads it. They
write through `withTourContent`, which puts every object into a station at a
LOCAL pose. A version 3 tour has no loose pins.

## Public API

- `AUTO_STATION_ACTIVATE_M` (= 2 x `STATION_RADIUS_M`, so 50 m): how far out
  an automatic station starts guiding. It is provisional, like R itself:
  chosen, not measured.
- `CaptureSpotsInWorld`: `{ fixes, gpsAccuracyMedianM, captures: { image,
geo }[] }`. These are the walk's recorded photos in the world, before they
  are in stations: what the Finish's bake produces (`capture-bake.ts`) and
  what a viewer places.
- `worldCaptureSpots(manifest) -> CaptureSpotsInWorld | undefined`: the
  tour's own recorded photos in the world (`tourCaptureGeos`).
- `asStored(object, station) -> TourObject`: the object as `station` stores
  it and the world view reads it back, its geo taken through the station's
  frame and back. A saved object differs from the placed one by the
  micrometres of that round trip, so a page comparing a placement with the
  saved file compares this one (the authoring draft's `hostedObjects`).
- `withTourContent(manifest, { objects, captureSpots?, newStationId?,
radiusM? }) -> TourManifest`: the manifest with `objects` as its pins and
  photos, each in a station, plus the recorded photos placed when the tour
  has none yet. It throws what the rule throws: a `RangeError` for a radius
  that is not positive, and an `Error` for a new station id already taken.

## Invariants & assumptions

- **An object nobody moved keeps its local pose VERBATIM.** If its geo pose
  equals the one its stored item reads as, field by field, the item's pose
  is copied, never recomputed. A save therefore never nudges an item, and
  D17's rigid station moves rely on that.
- **A moved object stays in its station, however far it went.** It is
  re-expressed there with `localPoseOf`. Re-assigning an existing item is
  the editor's job (M5b), never a side effect of a save.
- **New elements go through the automatic-station rule**
  (`station-assign.ts`, D20). The walk's recorded photos come first, in
  capture order, because the walk came before the tour was edited. Then
  come the new objects, in the caller's order. An element joins the nearest
  station within R, otherwise a new one.
- **A new station** is anchored where its first element stands, turned like
  north (identity rotation), with activate 50 m, found 25 m, the arrow
  hint, no steps and no title.
- **The tour's own recorded photos are kept.** Baked spots are placed only
  when the manifest has none, so a second Finish never re-assigns them.
- **An object naming a station the tour lacks starts that station** under
  the same id, anchored where the first object naming it stands, as an
  automatic station - never merged into a neighbour, even within R. Two
  cases name one: an undo that brought an object back after a save dropped
  its emptied station (the M5a milestone review M2), and the phone's "New
  station here" (owner decision D8 of
  `GpsPlusSlamJs_Docs/docs/2026-10-18-2210-editor3d-prototypes-round-2-plan.md`),
  whose placement names a fresh id. It goes through the rule
  (`assignToStations`' `ownStationOf`) IN THE OBJECTS' ORDER, like the
  rule's own new stations: after the tour's own, and a new object placed
  before it is never taken into it (r886: recreated up front, as first
  built, a new pin placed 3 m before a "New station here" pin was absorbed
  into the later station, against the note it was given). A later new
  object within R of it joins it as the rule says. A save hands the
  objects "saved, then changed", so an undone M2 station's old position in
  the order is not recovered.
- **The recorded photos can join an own station; the earlier objects
  cannot.** The rule runs twice. The photos go first, in capture order,
  with every own station already seated at its first object's spot; the
  objects follow without those seats, so an own station starts when its
  object comes. Without the seats (as first built) the photos were
  assigned before any own station existed: photos taken at its spot
  joined a neighbour 20 m back (R 20-40 m) or started a duplicate station
  beside it (R 15 m), never the station the creator started there.
  - **Inference: EVERY recorded photo may join an own station, by
    nearness, also one taken before its pin.** The photos reach this
    module without a time (`CaptureSpotsInWorld`), so "only photos after
    the pin" cannot be decided here. Nearness alone is the conservative
    choice: it is what the rule does for every other station, and it never
    leaves a duplicate station at the spot the creator chose. An earlier
    OBJECT is treated differently because it was already told its station
    in a placement note; a photo was told nothing (the HUD hedges a walk
    photo's station until the Finish). Open question: if the photos ever
    carry their capture time, should a photo taken before the pin stay out
    of it? Default: no, nearness only.
- An object missing from `objects` leaves its station. A station this
  write EMPTIED (it held items and holds none now) goes when nothing else
  keeps it: no title, no steps, no recorded photo in it, and no other
  station routing to it (`next`, a quiz route). It existed for its
  elements (D20); left behind, it was an untitled spot the visitor's
  guide still led to, and no editor of M5a can remove a station. A titled
  or storied station stays, and so does an empty station the tour already
  had (a later editor may add a station before filling it).
- The order is the stations' order, then the items' order within each
  station. A world view read back is therefore in station order, which can
  differ from the order the objects were placed in.
- Pure: no I/O. The geodesy it calls (`localPoseOf`, `itemGeoPose`) runs
  under the core's licence, which the app activates at boot.

## Examples

```ts
const written = withTourContent(manifest, {
  objects: applyObjectChanges(tourObjects(manifest), placed, deleted),
  captureSpots: bake.kind === "baked" ? bake.spots : undefined,
});
// Every pin and photo now sits in a station; new ones joined the nearest
// station within 25 m or started one where they stand.
```

## Tests

- `tour-content.test.ts`: unmoved objects bit for bit; an edit keeps its
  pose; a move is re-expressed in its own station, even beyond R; new
  objects join or start stations; chains; removal; an emptied station
  dropped unless titled, storied, photographed or routed to; a station
  an object names but the tour lacks, recreated under its id, and started
  in the objects' order even within R of another (D8); recorded photos at
  an own station's spot joining it while an earlier pin stays out, swept
  over R 15-40 m; the
  capture order and the kept spots; a refused R; and the `asStored`
  property (it is what a written tour holds, by content key).
- Through `finish-rebuild.test.ts` (the Finish's capture assignment, and a
  micrometre stored copy counted as written), `authoring-draft.test.ts`,
  `creator-finish.test.ts` and `capture-bake.test.ts`.
