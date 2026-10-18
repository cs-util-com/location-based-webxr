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
- `tourObjectsOf(manifest | null) -> TourObject[]`: the world view, or `[]`
  without a tour.

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
- An object naming a station the tour lacks is treated as new.
- An object missing from `objects` leaves its station. The station stays,
  even when it is empty: removing a station is the editor's decision.
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
  objects join or start stations; chains; removal; an unknown station; the
  capture order and the kept spots; a refused R; and the `asStored`
  property (it is what a written tour holds, by content key).
- Through `finish-rebuild.test.ts` (the Finish's capture assignment, and a
  micrometre stored copy counted as written), `authoring-draft.test.ts`,
  `creator-finish.test.ts` and `capture-bake.test.ts`.
