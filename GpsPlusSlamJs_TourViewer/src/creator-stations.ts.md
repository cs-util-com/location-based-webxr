# creator-stations.ts

## Purpose

The creator's stations in AR (tour editor plan 2026-10-17-1816, W3 "AR
authoring", owner decisions D20 and D21): which station the creator
stands in, the ground ring of its radius (`station-ring.ts`), the line
above the action strip that says so in plain words, and where a
placement went ("it starts Station 3" / "in Station 2") for its note.

## Public API

- `stationsAsFinished({ manifest, placed, deleted, radiusM? }) -> ArStation[]`
  - the tour's stations as the next Finish would write them: the page's
    working copy (the hosted objects with this page's changes,
    `applyObjectChanges` of `authoring-draft.ts`) through the Finish's
    own writer (`withTourContent` of `tour-content.ts`). Each station:
    `id`, `anchor` (`{ lat, lon, alt }`), `name` (its title, else
    "Station N" by its place, `stationTitle`), `started` (not in the
    tour file yet: this page's placements start it) and `itemIds`. None
    without a tour.
- `openStationAt(stations, at, radiusM?) -> ArStation | null` - the
  nearest station whose anchor is within R of `at` (`nearestStationWithin`
  of `station-assign.ts`, R itself inside), else null.
- `stationChipText(open, left) -> string` - "In Station 2 - what you place
  here joins it." / "You left Station 2 - what you place next starts a new
  station." / "No station here - what you place next starts a new one."
- `placedInText(stations, objectId) -> string | null` - "it starts
  Station 3" for the first element of a station the next Finish starts,
  else "in Station 2"; null when the object is in none.
- `wireCreatorStations({ ctx, dom: { chip }, creatorNue, zero, scene,
radiusM? }) -> { tick, placedIn, endVisit }` - `tick()` every camera
  frame of a creator's session: the line and the ring; `placedIn(id)` for
  a placement's note; `endVisit()` hides both.

## Invariants & assumptions

- **No document state.** Nothing here is stored: the stations are
  derived from the working copy (`ctx.tourManifest`, `ctx.placedObjects`,
  `ctx.deletedObjectIds`) each time it changes, through the Finish's own
  writer, so the HUD and the written tour cannot disagree. A station the
  creator's placements start exists only in that derivation until a
  Finish writes it (with an id the Finish mints; the HUD's `unwritten-N`
  ids never leave this module). The tour-document Redux slice (owner
  round 5) decides where AR-made stations live; this module then reads
  them from the store instead.
- **The open station is the rule's:** the nearest anchor within R of
  where the creator stands. Leaving R closes it ("You left ..." until the
  creator enters a station again); the next element placed outside every
  station's R starts a new one there, inside joins the nearest - which is
  what the Finish's assignment does, so "Place a pin" with no station
  open creates a station holding it (D21). Note the HUD judges the
  creator's position and the rule the element's: a pin placed a few
  metres ahead of a creator near the edge can land on the other side,
  and its note says where it went.
- **R** is `STATION_RADIUS_M` (25 m, provisional until the sweep over
  recorded walks).
- **Not covered:** a tour's FIRST Finish without photo spots places the
  walk's recorded photos before the objects (`withTourContent`); they
  are baked at the Finish, so the HUD cannot see them, and on that one
  Finish a pin may join a photo's station instead of the one named.
- **Cost:** the stations are recomputed only when the manifest, any
  placed object or the deletions change. Placed objects are compared entry
  by entry, because the settle re-poses them by replacing entries IN the
  array (`creator-settle.ts`); a frame costs that comparison and one
  horizontal search over the anchors.
- Defensive: no position, no zero, no scene or no tour - the line hides
  and the ring goes.

## Examples

```ts
const stations = wireCreatorStations({
  ctx,
  dom: { chip: element("creator-station") },
  creatorNue: () =>
    visitorPosition({ alignment, arPose, gpsPositions: [] }).nue,
  zero: () => selectZeroReference(store.getState()),
  scene: () => seams.getScene(),
});
onFrame(() => stations.tick());
note(`Pin placed - ${stations.placedIn(pin.id) ?? ""}`);
```

## Tests

- `creator-stations.test.ts` - the Finish's assignment (join within R,
  start beyond, anchor at the first element, names), deletions, no tour,
  no id clash with a hosted station; the open station at R and beyond;
  the property that a pin placed where the creator stands lands in the
  station the HUD called open, or starts one when it called none (R swept
  15-40 m); the words; the wiring: the line, the ring at the anchor on
  the ground, leaving and re-entering, a placement's note, and nothing
  without a position, a scene, a tour or after the visit.
- `playwright-tests/creator-stations.spec.js` - the composed page: the
  line and the ring, a pin inside joining, leaving closing, a pin with
  none open starting a station, and the Finish writing it.
