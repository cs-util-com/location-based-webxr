# tour-manifest.ts

**Purpose:** the schema, reader and writer of `tour.json` - what a creator
placed in a tour. Since format version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3) every text pin, captured photo and (minor 1) placed 3D model is an
ITEM of a STATION: the station
carries the exact geo pose (lat, lon, absolute altitude, rotation against
north) and its items carry LOCAL poses relative to it (`tour-items.ts`,
`tour-station-pose.ts`). Also the tour kit's game content (title, station
order, media assets, station stories; tour kit plan K1 and §8 D7,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`),
the needs-no-GPS flag and the tour details. The walk's camera captures,
which earlier apps baked into the tour as `captureSpots`, are no longer
part of the format (see below).
Guided-setup plan DEC-N7/N8/N9 for the original pins and photos
(`GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`).

## Public API

- `TOUR_MANIFEST_VERSION = 3` (the format's major number) and
  `TOUR_MANIFEST_MINOR = 2` (the newest additive revision of version 3
  this module knows; minor 1 adds the placed 3D model, minor 2 a
  station's description and card image).
- `parseTourManifest(data: unknown, options?: TourManifestReadOptions): TourManifest`
  - validates every field; throws `TourManifestValidationError` naming the
    record (`"stations[1].items[3].pose.position" …`,
    `"stations[0].steps[2].block.asset" …`). Unknown kinds and duplicate
    ids reject - except in a file of a NEWER minor, where an unknown value
    of a closed list degrades (below). `options.onDropped(drop)` hears
    each tour detail and each station description or card image left out
    (below), as a `TourManifestDrop` (`TourDetailsDrop | TourStationDrop`;
    only a station's carries `station`, the station's id, so
    `'station' in drop` tells them apart). A drop with no `cause` is a
    malformed value.
- `serializeTourManifest(manifest, options?): string` - re-validates
  through the reader, refuses a manifest of a newer minor, then
  pretty-prints `{ version: 3, minor, ... }` at the lowest minor the tour
  needs (`minorNeeded`: 2 while a station carries a description or a card
  image, else 1 while it carries a model, else 0). The reader holds a
  step's action as `action` and the file stores it under `block`, so the
  writer maps to the file's shape (`tourManifestRecord`) both before the
  re-validation and before printing: the written bytes are those of the
  file format, unchanged by the in-memory name.
- `tourManifestRecord(manifest)` - the manifest in the file's shape:
  every station through `tourStationRecord` (`tour-stations.ts`), every
  other field and the key order as they are; no `stations` (an untyped
  caller's) maps as none, as the reader reads a file without them.
  `tourStationRecord` is re-exported from here.
- `createEmptyTourManifest(): TourManifest` - `{ version: 3, minor: 0,
order: "fixed", assets: [], stations: [] }`, the starter zip's content.
- `tourItems(tour): TourItem[]` - every station's items, in station order.
- `parseTourObject(value, at?): TourObject` - one WORLD-VIEW pin, photo or
  model
  (geo pose, optional `station` id), the record a creator's on-device
  draft keeps (`draft-persistence.ts` in the Tour Viewer); same field
  rules as an item (`tour-items.ts` `parseTourContentFields`). A model's
  `asset` is checked for its shape only there (a draft record has no
  assets beside it); the manifest's write re-validates the reference.
- Types `TourManifest`; the world view
  `TourObject = TourPin | TourPhoto | TourModel`
  (`kind`, the item's fields, `geo`, `station?`), `TourObjectKind`;
  `TourManifestValidationError`; re-exported from `tour-items.ts`:
  `TourItem`, `TourPinItem`, `TourPhotoItem`, `TourModelItem`,
  `TourLocalPose`; and from
  `tour-stations.ts`: `TourAsset`, `TourAssetKind`, `TourOrder`,
  `TourStation`, `TourStep`, `TourStepAction`, `TourStepRecord`,
  `TourStepAdvance`,
  `TourChoiceOption`, `TourQuizOption`, `TourQuizAnswer`.

## Version 3 (W3; a major)

- **Stations as parents.** `stations[]` each carry `geo` (required; no
  code link, no code-only station, D9) and `items[]` (pins and photos at
  local poses). There are no loose objects: `objects` is gone from the
  file and from memory. A station may have no `steps` (an automatic
  station, D20: finding it completes it).
- **Local poses are the truth.** The manifest holds the local poses as
  written, and the writer writes them as held: nothing on the way
  recomputes one, so a station's move (D17) or a save never nudges an
  item (property-tested bit for bit). The world view is computed
  (`tour-station-pose.ts` `tourObjects`).
- **No migration (D5).** Versions 1 and 2 are refused: "this tour is in
  an older format (version N) that this version of the app no longer
  opens; it has to be made again". A version 2 reader refuses a version 3
  file with its own "made with a newer version of the app (format 3);
  update the app to open it" - which is what the plan asks of old readers.
- **Ids.** Item ids are unique across the whole tour (they are content
  file stems); an asset may not share one (checked here, since only the
  manifest sees every station's items).

## Minor 1: the placed 3D model (editor round 3, the size bound)

- An item of kind `model` (`tour-items.ts`): `asset` names a MODEL asset
  of `assets` (resolved by `tour-stations.ts`), `sizeM` is the scaled
  model's largest side in metres within 0.05-500 m inclusive, `label`
  optional. "Largest side" is defined once, in `tour-items.ts.md`: the
  axis-aligned box of the glTF default scene at rest pose, node transforms
  included, in the glb's own units (glTF metres), before the item's own
  rotation, the largest of its three extents; every renderer and the
  editor measure it that way. Decision record:
  `GpsPlusSlamJs_Docs/docs/2026-10-19-0905-editor3d-prototypes-round-3-plan.md`
  §9 (the bound in metres, pins and photos without a size).
- **The writer writes the lowest minor the tour needs**: 1 while any
  station carries a model, else 0, so every tour without one is written
  byte for byte as before and stays editable by a 3.0 reader. A 3.0
  reader of a minor-1 tour reads it leniently and
  leaves the models out (its unknown kind); it refuses to write it back.
- **Refused, not clamped.** A size outside the bound in a file of this
  reader's minor is a broken file; a lenient read (a newer minor, which may
  widen the bound) leaves such a model out; a size that is not a positive
  finite number fails at any minor. A clamp would make the next save
  rewrite the creator's number silently. An editor clamps its drag to the
  bound BEFORE it dispatches, so arithmetic at the edge (a factor times a
  native size landing one ulp past 500) never reaches the writer as a
  refusal.
- **Nothing renders a placed model yet**: the Tour Viewer's renderer leaves
  it out until the 3D editor's work draws it.

## Minor 2: a station's description and card image (G2, the 3D editor)

- A station's optional `description` and `image` (rules in
  `tour-stations.ts.md`): the description by the tour description's rule
  (trimmed, at most 2000 characters), the image an id naming a photo item
  of THAT station or an image asset of the tour. Decision record:
  `GpsPlusSlamJs_Docs/docs/2026-10-21-2247-g2-3d-editor-build-plan.md`
  §4.2.4 and Q14 (the image referent).
- **The writer writes minor 2 while any station carries either**, else
  the minor it needed before (1 with a model, else 0), so a tour without
  them is written exactly as before. A 3.1 reader ignores both fields as
  unknown ones; were the tour written at 3.1, that reader would open it
  strictly and write it back WITHOUT them. At 3.2 it reads it leniently and
  refuses to save it - which is what npm 1.30.0 (minor 0) and viewers
  built since 3.1 (minor 1) do, by the version policy below.
- **A card image whose picture went is dropped, never failed**, at every
  minor: a well-formed id naming no photo of the station and no image
  asset (a deleted photo or asset, a photo moved to another station) is
  left out and reported through `onDropped` with `field: "image"`, the
  station's id and `cause: "station-image-gone"`. The writer accepts that
  drop quietly, beside the cover's `image-gone` - so deleting the photo a
  card shows never fails a save - and writes the lowest minor the tour
  still needs (a tour whose only minor 2 content was that image falls back).
- **A malformed description or image is dropped too, never failed** (the
  tour details' model): an image that is not an id, or a description that
  is not text or too long, is left out and reported through `onDropped`
  with no `cause`, so a hand-edited value costs the value and the tour
  still opens in the editor to fix it. The writer refuses such a drop (a
  programming error fails loud). From a newer minor both read as none,
  unreported.

## An earlier file's `captureSpots` (removed)

- Earlier apps baked the walk's camera captures into the tour as
  `captureSpots: { fixes, gpsAccuracyMedianM, captures }`, each capture
  in a station (an automatic `walk-N` one where no station held it). They
  are debug data, never tour content, and the field is no longer part of
  the format (with `TourCaptureSpots`, `TourCapture`, `TourCaptureGeo` and
  `tourCaptureGeos`; see the CHANGELOG).
- **A file that still carries it** opens as if it were any unknown field:
  the field is ignored, whatever its shape, and every station stays as
  written - an empty `walk-N` station too, which is then a station like
  any other. No tour was published with the field (D5, D43), so nothing
  drops those stations. No write carries the field.

## A tour that needs no GPS (Q-QF-1)

- `needsNoGps?: true`: the tour's printed codes place it on their own, so
  a viewer never asks its visitors for their location. Only `true` is
  kept; `false` and absent read as absent. A non-boolean is a broken file
  at this reader's minor and reads as absent from a newer one.

## A stable tour id (debug-captures plan, Q-I)

- `tourId?: string`: the tour's own id, minted once by the app that
  first saves the tour and kept by every save after, so a tour opened from
  a FILE (no link to be known by) keeps one key across saves - the Tour
  Viewer keys a creator's on-device draft by it (`tour-file-key.ts` there).
  Not a series id: unsigned, no version, no meaning for a visitor.
- The one id rule (`TOUR_ID_PATTERN`: 1-64 letters, digits, `_`, `-`).
  **A bad id is dropped by the reader, never failed, at every minor** - it
  keys a draft only, so it costs the id, never the tour. The writer
  refuses one (a programming error fails loud).
- **No minor of its own.** An older reader ignores the field; an older
  writer drops it, which costs only the draft its key on that tour's next
  open. A minor for it would make every 3.0/3.1 writer refuse every tour
  that carries one.

## Tour details (W2, D15)

- `description?`, `cover?`, `contact?` (`TourDetails`, checked by
  `tour-details.ts`): the cover names one of the tour's images - a
  station's photo item or an image asset.
- **Dropped, never failed, by the reader, at every minor**, and reported
  through `onDropped`; the writer leaves out only a cover whose image went
  (a deleted photo, the drop's `cause` `image-gone`), and throws on any
  other drop - a cover that is not an image id, or a description or contact
  its reader would drop (a programming error, PR #638 review).

## The version policy

- **Minor (`minor`, default 0).** Additive revisions of version 3. A
  reader opens any minor; unknown fields are IGNORED at every level and at
  every minor. The writer refuses a manifest whose minor is newer than
  `TOUR_MANIFEST_MINOR` (it was read with fields dropped). When a minor is
  added, the writer must learn which content needs it (`minorNeeded`; it
  did for minors 1 and 2), so an older reader at a lower minor is never
  handed a field it parses strictly - or one it would drop on its own
  write.
- **Unknown VALUES of a newer minor (K1 milestone review R4):** an
  unknown item kind, a photo of an unknown image type, or a model whose
  asset the reader lacks or whose positive size lies beyond its bound,
  leaves the item out; an unknown `order` reads `any`; the stations' lists degrade as
  `tour-stations.ts` says. At this reader's own minor the same value
  fails. Such a tour is never written back.
- The series id and version number of a tour are NOT here:
  `manifest.json` is their one place (§8 G7, `tour-signed-manifest.ts`).

## Invariants & assumptions

- A station's `geo` is a `QrGeoPose` validated by `qr/geo-pose.ts`
  (shared with the level file).
- An item's `pose` is three finite offsets within 10 km and a unit
  quaternion (`tour-items.ts`).
- `id`s are path-safe segments (`[A-Za-z0-9_-]{1,64}`); a photo's `image`
  is `content/<its id>.<image ext>`.
- `title` is optional and non-blank, read trimmed; `order` is
  `fixed | any`; a `branch` order is refused at minors this reader knows,
  in a sentence a creator can act on ("this tour lets answers choose the
  next station, which this version of the app no longer does; change its
  order to fixed or any"), and read as `any` from a newer minor (an
  unknown order degrades).
- Defensive at the boundary like `qr-level.ts`: hand-editable data, every
  field checked, the writer re-validates.

## Examples

```ts
const manifest = createEmptyTourManifest();
manifest.stations.push({
  id: 'gate',
  geo,
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: 'arrow',
  steps: [],
  items: [
    {
      id,
      kind: 'pin',
      label: 'Gate',
      createdAtIso,
      pose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
    },
  ],
});
const text = serializeTourManifest(manifest); // throws if any record is wrong
parseTourManifest({ version: 2, objects: [] }); // throws: an older format
```

## Tests

- `tour-manifest.test.ts` - a station with a pin and a photo, the empty
  manifest, one rejection per rule with the record named (ids across
  stations, an asset on an item id, item fields, poses, the station geo),
  versions 1 and 2 refused as older formats and 4 as newer, version 3
  minor 0 written while the tour has no model, a full tour, the placed
  model (minor 1 written and read back exactly, minor 0 again once the last
  model is gone, a newer minor's oversized model left out, a model id that
  is an asset id refused, the world-view model), a newer minor's unknown fields
  ignored and its unknown values degraded (and refused at this minor and
  on write), write/read round trip, the writer's refusal, the world-view
  object parser, an earlier file's `captureSpots` (read without it, every
  station kept, a malformed one ignored, never written), the
  needs-no-GPS flag, the tour id (round trip at minor 0, absent, a bad
  one dropped at every minor, the writer's refusal), the tour details (round trip, cover on a station's
  photo or an image asset only, dropped details, the writer's cover drop
  and refusals), and minor 2 (a station's description and image read and
  written back exactly at minor 2; the minor per field - 2 for either, 1
  for a model alone, else 0; a minor 1 file opening and saving as 1; the
  writer dropping an image whose photo went with `station-image-gone`
  and falling back a minor; the reader dropping a malformed image and
  description with no cause and opening the tour; the writer refusing
  them).
- `tour-manifest.property.test.ts` - over generated stations, items
  (placed models among them), station descriptions (blank and padded
  among them) and card images (the station's own photo, the image asset,
  another station's item, a missing id), tour ids and details, and an
  earlier file's `captureSpots` (ignored, every station kept):
  serialize->parse is the identity (but for the minor, the writer's
  choice) with every local pose the same numbers exactly; the minor
  written is the SMALLEST whose reader keeps the whole tour (a minor 0
  reader drops the models, a minor 1 reader the descriptions and images)
  - 2 with a description or image, else 1 with a model, else 0 - and every
    model's size reads back unchanged; parse is idempotent; every item
    stays in its station, a kept cover is always one of the tour's photos,
    and a kept card image is always a photo of its station or an image
    asset, every other one reported as dropped.
