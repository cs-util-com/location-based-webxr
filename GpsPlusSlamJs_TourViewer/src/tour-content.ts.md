# tour-content.ts

## Purpose

The Tour Viewer's write path for a version 4 tour (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3, D20, D21). The pages place, move and compare a WORLD view: every pin
(a short text in its `pin` view), photo (a picture in its `plane` view)
and placed model with its geo pose, as the framework's `tourObjects`
reads a station's free blocks. They write through `withTourContent`,
which puts every object into the station it names as a free block at a
LOCAL pose, beside the station's story blocks, and lists a captured
photo's image asset. A tour has no loose pins. The walk's
camera captures are debug data, never in a station (an earlier file's
`captureSpots` is an unknown field to the framework's reader).

## Public API

- `AUTO_STATION_ACTIVATE_M` (module-internal since nothing outside starts an
  automatic station; = 2 x `STATION_RADIUS_M`, so 50 m): how far out
  an automatic station starts guiding. It is provisional, like R itself:
  chosen, not measured.
- `asStored(object, station) -> TourObject`: the object as `station` stores
  it and the world view reads it back, its geo taken through the station's
  frame and back. A saved object differs from the placed one by the
  micrometres of that round trip, so a page comparing a placement with the
  saved file compares this one (the authoring draft's `hostedObjects`).
- `automaticStationFrame(id, at)`: a new automatic station's frame
  (below), the one the tour document's station rule starts.
- `storyBlocksOf(station)`: a station's story blocks, the ones a step
  shows (what a frame of the tour document holds inline).
- `WorldBlock`, `worldBlocks(station)`: a station's free blocks
  (`tourFreeBlocks`, the ones no step shows) as the short texts, pictures
  and models standing in the world they are.
- `isCapturedPhoto(object)`: a picture whose image asset carries its own
  id (`content/<id>.jpg`, minted with it) - what a creator page takes with
  the camera; a picture naming another of the tour's images is not one.
- `ownedAssetIds(manifest)`: the image assets that are a captured photo's
  own. Such an asset is part of its picture: written while the picture
  is, gone with it; a cover or card image naming it names the photo.
- `withTourContent(manifest, { objects }) -> TourManifest`: the manifest
  with `objects` as its free blocks, each in the station it names (or,
  naming none, the one the manifest holds it in) beside the station's
  story blocks, the stations kept as they are and in their order, and the
  captured photos' assets those of `objects` (a deleted photo's asset
  goes unless another object or a story block still names its image,
  B2a review 2; a kept one stays in its place; a new one's is listed). Throws an `Error` naming the object for
  one in no station of the manifest.
- `withReferencedAssets(manifest, alsoKeep?) -> TourManifest`: the
  manifest without the assets it does not use, in their order; the same
  manifest when every asset is in use. `alsoKeep` (the document's
  `historyAssetIds`): ids an undo or redo step still names, kept though
  the manifest does not, so that step finds them after the write. A write applies it after
  `withTourContent`, and the rebuild removes the dropped assets' files
  (`finish-rebuild.ts`). Used means (module-private
  `referencedAssetIds`): every block's of every station, story or free
  (`blockAssetIds`: a picture's image, a video and its poster, an audio,
  a model's file, a character's image and voice; none for a text), every
  station's card image and the cover.
- `keepsItself(station, imageAssets) -> boolean`: whether an EMPTY
  station carries the creator's own work, which keeps it when its last
  item leaves: a title, story steps, a non-blank description (a blank one
  is none, as the reader reads it, and as a blank title), or a card image naming
  one of `imageAssets`. The one rule both this write (`withTourContent`) and the tour
  document (`withoutEmptied`) ask.
- `imageAssetIds(assets) -> ReadonlySet<string>`: the image assets' ids,
  through the framework's `tourImageIds` (what `keepsItself` takes).
- `blockAssetIds(block)` (module-internal): the assets one block names (a closed switch: a
  new kind fails to compile until it says which it keeps).
  `stepAssetIds(station)`: the assets a station's (or a frame's) story
  blocks name. `objectAssetIds(object)`: the assets an object in the
  world keeps (a model its file, a picture the tour's image it names, a
  pin none; a captured photo's own asset none, as it is part of its
  picture) - what the write and the document's history read.

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
  the ones created after them, in the order the creator's placements
  created them.
- **The walk's debug camera captures keep no station.** Until M1 of the
  debug-captures plan the open seated them (`withWalkPhotos`), starting an
  automatic `walk-N` station for every frame no station held, and named
  them in `captureSpots`. That field is gone from the format: the reader
  ignores it, so a file written then opens with its empty `walk-N`
  stations as stations like any other (no tour was published with it,
  D5/D43; `withoutDebugCaptures`, which dropped them, went with the
  field).
- An object missing from `objects` leaves its station. A station this
  write EMPTIED (it held free blocks and holds none now) goes when nothing else
  keeps it: nothing of its own (`keepsItself`: no title, no steps, no non-blank
  description, no card image naming an image asset). A station names no
  other (a station's `next` and a quiz's routes left the format), so no
  other station keeps it either. It existed for its
  elements (D20); left behind, it was an untitled spot the visitor's
  guide still led to. A titled, storied, described or pictured station
  stays, and so does an
  empty station the tour already had (a later editor may add a station
  before filling it). The tour document drops such a station itself
  (`withoutEmptied`); this covers a written station the document's frames
  no longer name.
- **A card image keeps a station only while it still names a picture.**
  "A description or an image keeps a station" is read here as an image
  that still resolves. An emptied
  station holds no photo, so a card image of its own (now moved or
  deleted) photo names nothing: the framework's writer drops it
  (`station-image-gone`), and keeping the station for it would leave the
  bare spot the station rule removes. An image asset still resolves, so it keeps the
  station.
- The order of the world view read back is the stations' order, then the
  free blocks' order within each station, which can differ from the order
  the objects were placed in.
- **An asset nothing names is not written.** A visitor downloads every
  asset a tour lists, so one a changed step or cover left behind would
  ride along in every copy. A photo's image is its own content file, not
  an asset; a placed model names its model file (a `.glb` is
  self-contained, so that one asset is all it needs). The item kinds are a
  closed switch (`objectAssetIds`): a new kind of item fails to compile
  there until it says which assets it keeps.
- **Unless the undo history still names it.** A cover image no step uses
  is named by the cover alone: a cover change saved would drop it with
  its file, and the undo of that change would find no image. The writes
  pass the history's ids (`alsoKeep`), so such an asset stays until no
  undo or redo step names it.
- Pure: no I/O. The geodesy it calls (`localPoseOf`, `itemGeoPose`) runs
  under the core's licence, which the app activates at boot.

## Examples

```ts
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
  stations' order kept; removal; an emptied station dropped unless titled
  or storied; kept by a description or an image asset, not by a
  blank description (`keepsItself` asked directly) nor by an
  image of its own deleted photo; and the `asStored`
  property (it is what a written tour holds, by content key);
  `withReferencedAssets` keeping each block kind's assets (an image, a
  character with and without a voice, an audio, a video, a model; a text
  block names none) and dropping the rest, the cover and a station's card
  image kept though no step names them, a block in any station counted, the tour's asset order kept,
  and the same manifest when every asset is used.
- Through `finish-rebuild.test.ts` (a micrometre stored copy counted as
  written, a placed model's file
  kept and a model asset nothing names dropped, read from the zip's
  bytes), `editor/editor-session.test.ts` (an undo across a save brings a
  deleted model back with its file: the history's keep set),
  `tour-document.test.ts` and `tour-document.property.test.ts` (the open
  dropping a file's captures, and no write carrying them),
  `authoring-draft.test.ts` and `creator-finish.test.ts`.
- A station's delete through `tour-document-stations.test.ts` (the
  property that any order of station deletes leaves a tour the format
  reads).
