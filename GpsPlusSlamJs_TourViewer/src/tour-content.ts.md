# tour-content.ts

## Purpose

The Tour Viewer's write path for a version 3 tour (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3, D20, D21). The pages place, move and compare a WORLD view: every pin and
photo with its geo pose, as the framework's `tourObjects` reads it. They
write through `withTourContent`, which puts every object into the station
it names at a LOCAL pose. A version 3 tour has no loose pins. The walk's
recorded photos are put into stations once, when a recording is opened
(`withWalkPhotos`).

## Public API

- `AUTO_STATION_ACTIVATE_M` (= 2 x `STATION_RADIUS_M`, so 50 m): how far out
  an automatic station starts guiding. It is provisional, like R itself:
  chosen, not measured.
- `CaptureSpotsInWorld`: `{ fixes, gpsAccuracyMedianM, captures: { image,
geo, station? }[] }`; `station` is the station a bake put the photo
  into, passed through by `worldCaptureSpots` so the viewer draws it with
  that station (`station-captures.ts`). These are the walk's recorded
  photos in the world, before they are in stations: what the bake
  produces (`capture-bake.ts`) and what a viewer places.
- `worldCaptureSpots(manifest) -> CaptureSpotsInWorld | undefined`: the
  tour's own recorded photos in the world (`tourCaptureGeos`).
- `asStored(object, station) -> TourObject`: the object as `station` stores
  it and the world view reads it back, its geo taken through the station's
  frame and back. A saved object differs from the placed one by the
  micrometres of that round trip, so a page comparing a placement with the
  saved file compares this one (the authoring draft's `hostedObjects`).
- `automaticStationFrame(id, at)`: a new automatic station's frame
  (below), the one the tour document's station rule and the walk's bake
  start.
- `routedTo(station)`: the stations `station` routes to (its `next` and
  its quizzes' routes): what keeps an emptied station from being dropped.
- `withTourContent(manifest, { objects }) -> TourManifest`: the manifest
  with `objects` as its pins and photos, each in the station it names (or,
  naming none, the one the manifest holds it in), the stations kept as
  they are and in their order. Throws an `Error` naming the object for one
  in no station of the manifest.
- `withWalkPhotos(manifest, spots) -> TourManifest`: the manifest with the
  walk's recorded photos in stations (the bake at open, `walkAtOpen` of
  `finish-rebuild.ts`): in capture order, each joins the station whose own
  found radius holds it, else starts a new automatic one where it was
  taken, after the tour's own, under the id `walk-1`, `walk-2`, ...
  (skipping ids the tour has). The same manifest when it already has its
  photos or the walk has none.
- `referencedAssetIds(manifest) -> Set<string>`: the ids of the assets the
  tour uses - every step block's (an image, a character's image and voice,
  an audio, a video, a model) in any station, every item's (none for a pin
  or a photo today), and the cover.
- `withReferencedAssets(manifest) -> TourManifest`: the manifest without
  the assets `referencedAssetIds` leaves out, in their order; the same
  manifest when every asset is in use. A write applies it after
  `withTourContent`, and the rebuild removes the dropped assets' files
  (`finish-rebuild.ts`).

## Invariants & assumptions

- **The writer assigns nothing.** Every object belongs to a station from
  the moment it is placed (the tour document's station rule,
  `tour-document.ts`), and the page shows that station. A writer that
  assigned again could write an object somewhere other than the station
  the creator was shown, so it writes each object into the one it names,
  however far from it the object stands, and starts no station. An object
  in no station of the manifest is a broken document: the write throws,
  in words naming the object, rather than inventing a station nobody was
  shown.
- **An object nobody moved keeps its local pose VERBATIM.** If its geo pose
  equals the one its stored item reads as, field by field, the item's pose
  is copied, never recomputed. A save therefore never nudges an item, and
  D17's rigid station moves rely on that.
- **A moved object is re-expressed in its station** with `localPoseOf`.
- **The stations' order is the manifest's**: the tour's own first, then
  the ones created after them, in the order they were created (the walk's
  at the open, then the creator's placements).
- **The walk's photos are baked once, at the open** (`withWalkPhotos`), by
  the rule a placement follows (`stationHolding` of `station-assign.ts`:
  a station's OWN found radius, horizontal, inclusive, the nearest; a tie
  to the earlier station). A new station is anchored where its first
  photo was taken, turned like north (identity rotation), with activate
  50 m, found 25 m, the arrow hint, no steps and no title. Its id is
  deterministic (`walk-N`), so a reload's bake of the same recording gives
  the ids the page's records name. A tour that already has its photos is
  left as it is (they are baked once).
- An object missing from `objects` leaves its station. A station this
  write EMPTIED (it held items and holds none now) goes when nothing else
  keeps it: no title, no steps, no recorded photo in it, and no other
  station routing to it (`next`, a quiz route). It existed for its
  elements (D20); left behind, it was an untitled spot the visitor's
  guide still led to. A titled or storied station stays, and so does an
  empty station the tour already had (a later editor may add a station
  before filling it). The tour document drops such a station itself
  (`withoutEmptied`); this covers a written station the document's frames
  no longer name.
- The order of the world view read back is the stations' order, then the
  items' order within each station, which can differ from the order the
  objects were placed in.
- **An asset nothing names is not written.** A visitor downloads every
  asset a tour lists, so one a changed step or cover left behind would
  ride along in every copy. A photo's image is its own content file, not
  an asset. The item kinds are a closed switch (`itemAssetIds`): a new
  kind of item (a model placed in a station) fails to compile there until
  it says which assets it keeps.
- Pure: no I/O. The geodesy it calls (`localPoseOf`, `itemGeoPose`) runs
  under the core's licence, which the app activates at boot.

## Examples

```ts
// At the open: the recording's photos into stations, once.
const opened = withWalkPhotos(manifest, bake.spots);
// At a write: every object in the station the document seated it in.
const written = withTourContent(opened, {
  objects: applyObjectChanges(tourObjects(opened), placed, deleted),
});
```

## Tests

- `tour-content.test.ts`: unmoved objects bit for bit; an edit keeps its
  pose; a move is re-expressed in its own station; each object written
  into the station it names however far from it, and one naming none kept
  in its own; an object in no station of the tour refused in words; the
  stations' order kept; removal; an emptied station dropped unless titled,
  storied, photographed or routed to; the tour's recorded photos kept
  verbatim; `withWalkPhotos` putting photos in capture order into the
  station whose own radius holds them or new `walk-N` ones (both sides of
  a 10 m own radius and of the 25 m automatic one), the same ids on every
  open skipping taken ones, the world view read back, and a tour with
  photos or a walk without them left as they are; and the `asStored`
  property (it is what a written tour holds, by content key);
  `withReferencedAssets` keeping each block kind's assets (an image, a
  character with and without a voice, an audio, a video, a model; a text
  block names none) and dropping the rest, the cover kept though no step
  names it, a block in any station counted, the tour's asset order kept,
  and the same manifest when every asset is used.
- Through `finish-rebuild.test.ts` (a Finish writing the photos baked at
  open, a micrometre stored copy counted as written), `tour-document-bake.test.ts` (`walkAtOpen`),
  `authoring-draft.test.ts`, `creator-finish.test.ts` and
  `capture-bake.test.ts`.
