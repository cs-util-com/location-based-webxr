# creator-stations.ts

## Purpose

The creator's stations in AR (tour editor plan 2026-10-17-1816, W3 "AR
authoring", owner decisions D20 and D21): which station the creator
stands in, the ground ring of its radius (`station-ring.ts`), the line
above the action strip that says so in plain words, and where a
placement went ("it starts Station 3" / "in Station 2") for its note.

## Public API

- `stationsAsFinished({ state }) -> ArStation[]`
  - the tour's stations as the next write carries them
    (`manifestToWrite` of `tour-document.ts`): every object is in a
    station of the document from its placement on, under the id the file
    will carry. Each station: `id`, `anchor` (`{ lat, lon, alt }`),
    `foundRadiusM` (its own), `name` (its title, else "Station N" by its
    place, `stationTitle`), `started` (the tour file does not carry it
    yet: this page's placements started it) and `itemIds`. None without a
    tour (`state` null).
- `openStationAt(stations, at) -> ArStation | null` - the nearest station
  whose OWN found radius holds `at` (`stationHolding` of
  `station-assign.ts`, the radius itself inside), else null: the rule the
  document seats a placement by.
- `stationChipText(open, left, newStationArmed?) -> string` - "In Station 2 - what you place
  here joins it." / "You left Station 2 - what you place next starts a new
  station." / "No station here - what you place next starts a new one." /
  while "New station here" is armed (owner decision D8): "What you place
  next starts a new station here."
- `placedInText(stations, objectId) -> string | null` - "it starts
  Station 3" for the first element of a station the tour file does not
  carry yet, else "in Station 2"; null when the object is in none.
- `reticleNueOf(reticle) -> [n, u, e] | null` - a visible reticle's hit
  point in GPS-world NUE; null when hidden, absent or not finite.
- `wireCreatorStations({ ctx, dom: { chip }, creatorNue, reticleNue?, zero, scene
}) -> { tick, placedIn, nameOf, endVisit }` - `tick()` every camera
  frame of a creator's session: the line and the ring; `placedIn(id)` for
  a placement's note; `nameOf(id)` the name of the station object `id`
  is in, for a "New station here" placement's
  note; `endVisit()` hides both. The line reads the document's
  `newStationArmed` each frame.

## Invariants & assumptions

- **No document state.** Nothing here is stored: the stations are
  derived from the tour document (`deps.tour`: its `state()`, and
  `manifest()` null for no tour) each time the parts they are made of
  change (the written file, the frames, the placed objects, the
  deletions - by identity, the slice replaces them), as the next write
  carries them, so the HUD and the written tour cannot disagree. A
  station the creator's placements start is a station of the document
  from that placement on, under the id the write keeps.
- **The open station is the rule's:** the nearest station whose own found
  radius holds where the next pin would land - the reticle's hit point
  while it is visible, else where the creator stands (M5c review #3).
  Leaving the radius closes it ("You left ..." until the creator enters a
  station again); the next element placed outside every station's radius
  starts a new one there, inside joins the nearest - which is what the
  document's station rule does with the placement, so "Place a pin" with
  no station open creates a station holding it (D21). The ring is drawn
  at that station's own radius. A photo lands about where
  the creator stands, so with the reticle hidden the creator's spot is
  the right one to judge; with it visible a photo is judged at the
  reticle, a few metres off, and its note says where it went.
- **The ring is the station the creator STANDS in**, not the one at the
  reticle (PR #642 review): the line follows where the next pin lands,
  but the ring is the boundary the creator walks along, and judged at the
  reticle it vanished exactly when they aimed past the edge to probe it.
  Standing 22 m from a 25 m station's anchor and aiming 5 m further out,
  the line says the next pin starts a new station and the ring stays.
  Standing outside every radius with the reticle inside one, the line
  names it and no ring is drawn.
- **The station left** is remembered by its id: the document keeps it
  from the first placement on, and the write carries it under that id
  (M5c review #4 found the HUD forgetting it when it read stations under
  ids that shifted). Gone (its last object deleted): "No station here".
- **The radius** is each station's own `foundRadiusM`; the stations the
  rule starts take `STATION_RADIUS_M` (25 m, provisional until the sweep
  over recorded walks).
- **The walk's photos are in their stations from the open on**: the
  recording is baked when the creator opens it (`walkAtOpen` of
  `tour-document-bake.ts`), its photos joining the tour's stations or
  starting `walk-N` ones by the same rule, and a Finish assigns nothing.
  So the names the HUD shows are the ones written, with no hedge. (Until
  the bake moved to the open, the HUD could not see the photos and
  hedged every name "may change at Finish".)
- **Cost:** the stations are recomputed only when the manifest, any
  placed object or the deletions change. Placed objects are compared entry
  by entry, because the settle re-poses them by replacing entries IN the
  array (`creator-settle.ts`); a frame costs that comparison and two
  horizontal searches over the anchors (at the reticle and at the
  creator).
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

- `creator-stations.test.ts` - the document's assignment (join within
  the radius, start beyond, anchor at the first element, names),
  deletions, no tour, "started" by whether the file carries the station
  whatever its id; the open station at the radius and beyond, and a
  station's own radius (35 m holding 30 m, 5 m not holding 6 m); the
  property that a pin placed where the creator stands lands in the
  station the HUD called open, or starts one when it called none (the
  hosted station's radius swept 15-40 m); the same promise through the
  composed HUD with the reticle up to 10 m ahead or hidden (property,
  radius swept); a settle's re-pose beyond the radius followed; `reticleNueOf`; the
  words (the armed line too); "New station here" through the wiring
  (the line while armed, the ring kept, the new station named); the
  station the walk's photos started named from the open on, with no
  hedge; the station left, remembered across a
  deletion that renumbers it and across the Finish that writes it (a real
  tour document, changed as the creator changes it); the
  wiring: the line, the ring at the anchor on
  the ground, leaving and re-entering, the ring kept at the creator's
  station while the reticle aims past its edge, a placement's note, and
  nothing
  without a position, a scene, a tour or after the visit.
- `playwright-tests/creator-stations.spec.js` - the composed page: the
  line and the ring, a pin inside joining, leaving closing, a pin with
  none open starting a station, and the Finish writing it.
