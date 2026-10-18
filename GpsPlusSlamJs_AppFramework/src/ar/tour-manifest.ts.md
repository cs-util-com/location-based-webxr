# tour-manifest.ts

**Purpose:** the schema, reader and writer of `tour.json` - what a creator
placed in a tour. Since format version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3) every text pin and captured photo is an ITEM of a STATION: the station
carries the exact geo pose (lat, lon, absolute altitude, rotation against
north) and its items carry LOCAL poses relative to it (`tour-items.ts`,
`tour-station-pose.ts`). Also the tour kit's game content (title, station
order, media assets, station stories; tour kit plan K1 and §8 D7,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`),
baked recorded photos, the needs-no-GPS flag and the tour details.
Guided-setup plan DEC-N7/N8/N9 for the original pins and photos
(`GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`).

## Public API

- `TOUR_MANIFEST_VERSION = 3` (the format's major number) and
  `TOUR_MANIFEST_MINOR = 0` (the newest additive revision of version 3
  this module knows).
- `parseTourManifest(data: unknown, options?: TourManifestReadOptions): TourManifest`
  - validates every field; throws `TourManifestValidationError` naming the
    record (`"stations[1].items[3].pose.position" …`,
    `"stations[0].steps[2].block.asset" …`). Unknown kinds and duplicate
    ids reject - except in a file of a NEWER minor, where an unknown value
    of a closed list degrades (below). `options.onDropped(drop)` hears
    each tour detail left out (below).
- `serializeTourManifest(manifest, options?): string` - re-validates
  through the reader, refuses a manifest of a newer minor, then
  pretty-prints `{ version: 3, minor: 0, ... }`.
- `createEmptyTourManifest(): TourManifest` - `{ version: 3, minor: 0,
order: "fixed", assets: [], stations: [] }`, the starter zip's content.
- `tourItems(tour): TourItem[]` - every station's items, in station order.
- `parseTourObject(value, at?): TourObject` - one WORLD-VIEW pin or photo
  (geo pose, optional `station` id), the record a creator's on-device
  draft keeps (`draft-persistence.ts` in the Tour Viewer); same field
  rules as an item (`tour-items.ts` `parseTourContentFields`).
- Types `TourManifest`; the world view `TourObject = TourPin | TourPhoto`
  (`kind`, the item's fields, `geo`, `station?`), `TourObjectKind`;
  `TourCaptureSpots` and `TourCapture` (`{ image, station, pose }`);
  `TourManifestValidationError`; re-exported from `tour-items.ts`:
  `TourItem`, `TourPinItem`, `TourPhotoItem`, `TourLocalPose`; and from
  `tour-stations.ts`: `TourAsset`, `TourAssetKind`, `TourOrder`,
  `TourStation`, `TourStep`, `TourStepAdvance`, `TourBlock`,
  `TourChoiceOption`, `TourQuizOption`, `TourQuizAnswer`, `TourQuizRoute`.

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
  (`tour-station-pose.ts` `tourObjects`, `tourCaptureGeos`).
- **No migration (D5).** Versions 1 and 2 are refused: "this tour is in
  an older format (version N) that this version of the app no longer
  opens; it has to be made again". A version 2 reader refuses a version 3
  file with its own "made with a newer version of the app (format 3);
  update the app to open it" - which is what the plan asks of old readers.
- **Ids.** Item ids are unique across the whole tour (they are content
  file stems); an asset may not share one (checked here, since only the
  manifest sees every station's items).

## Baked capture spots (scan-pass plan S1)

- `captureSpots?: { fixes, gpsAccuracyMedianM, captures }`: a recorded
  walk's photos, each `{ image, station, pose }` - placed ONCE at the
  creator's Finish through the first settled alignment after the photo
  was taken (S-D11), assigned to stations by the automatic-station rule
  in capture order, and held at a local pose. A visitor neither downloads
  nor replays the walk. Its presence is the "baked" marker: the Tour
  Viewer places these and never runs its live join.
- `image` is the recording's own entry name (`images/frame-000002.jpg`),
  checked by the shared zip path rules and the media allowlist (an image
  type). `station` must name one of the tour's stations; `pose` is a local
  pose (photos face as captured: a local rotation always exists). `fixes`
  is a positive integer; `gpsAccuracyMedianM` a number >= 0 or `null`.
  `captures` is non-empty and names each photo once.
- **A newer minor's spots this reader cannot read are dropped**, not the
  tour (K1 R4, S1 milestone review #8).

## A tour that needs no GPS (Q-QF-1)

- `needsNoGps?: true`: the tour's printed codes place it on their own, so
  a viewer never asks its visitors for their location. Only `true` is
  kept; `false` and absent read as absent. A non-boolean is a broken file
  at this reader's minor and reads as absent from a newer one.

## Tour details (W2, D15)

- `description?`, `cover?`, `contact?` (`TourDetails`, checked by
  `tour-details.ts`): the cover names one of the tour's images - a
  station's photo item or an image asset.
- **Dropped, never failed, by the reader, at every minor**, and reported
  through `onDropped`; the writer leaves out a cover whose image went (a
  deleted photo), and throws on a description or contact its reader would
  drop (a programming error).

## The version policy

- **Minor (`minor`, default 0).** Additive revisions of version 3. A
  reader opens any minor; unknown fields are IGNORED at every level and at
  every minor. The writer refuses a manifest whose minor is newer than
  `TOUR_MANIFEST_MINOR` (it was read with fields dropped). When a minor is
  added, the writer must learn which content needs it (the version 2
  writer's `minorNeeded`), so an older reader at a lower minor is never
  handed a field it parses strictly.
- **Unknown VALUES of a newer minor (K1 milestone review R4):** an
  unknown item kind, or a photo of an unknown image type, leaves the item
  out; an unknown `order` reads `any`; the stations' lists degrade as
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
  `fixed | any | branch`.
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
  minor 0 written always, a full tour, a newer minor's unknown fields
  ignored and its unknown values degraded (and refused at this minor and
  on write), write/read round trip, the writer's refusal, the world-view
  object parser, the baked spots (round trip, null median, each malformed
  capture or spot set, a capture's station that does not exist), the
  needs-no-GPS flag, the tour details (round trip, cover on a station's
  photo or an image asset only, dropped details, the writer's cover drop
  and refusals).
- `tour-manifest.property.test.ts` - over generated stations, items,
  recorded photos and details: serialize->parse is the identity with every
  local pose the same numbers exactly; parse is idempotent; every item
  stays in its station and a kept cover is always one of the tour's
  photos.
