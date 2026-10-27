# tour-manifest.ts

**Purpose:** the schema, reader and writer of `tour.json` - what a creator
placed in a tour. Since format version 4 (station blocks, design
`GpsPlusSlamJs_Docs/docs/2026-10-25-0845-station-blocks-model-proposal-design.md`,
build plan `GpsPlusSlamJs_Docs/docs/2026-10-25-2052-station-blocks-build-plan.md`)
a tour is media ASSETS (`tour-assets.ts`) and STATIONS
(`tour-stations.ts`). A station carries the exact geo pose (lat, lon,
absolute altitude, rotation against north) and its BLOCKS
(`tour-blocks.ts`) carry LOCAL poses relative to it (`tour-items.ts`,
`tour-station-pose.ts`). A block is one thing a station shows - a short
text, a long text, a picture, a video, a sound, a 3D model, a character -
in a view the creator chose; a station's STORY (`tour-story.ts`) shows
some of its blocks step by step, and the rest are FREE: they stand in the
world (a pin, a picture's plane, a placed model) while the station is
shown. Also the tour's title, station order, the needs-no-GPS flag, the
tour id and the tour details.

## Public API

- `TOUR_MANIFEST_VERSION = 4` (the format's major number) and
  `TOUR_MANIFEST_MINOR = 0` (the newest additive revision of version 4
  this module knows).
- `parseTourManifest(data: unknown, options?: TourManifestReadOptions): TourManifest`
  - validates every field; throws `TourManifestValidationError` naming the
    record (`"stations[1].blocks[3].pose.position" …`,
    `"stations[0].steps[2].action.block" …`), or its subclass
    `TourManifestOlderFormatError` for versions 1 to 3. Unknown kinds and
    duplicate ids reject - except in a file of a NEWER minor, where an
    unknown value of a closed list degrades (below).
    `options.onDropped(drop)` hears each tour detail, each station
    description or card image and each block or block field left out, as a
    `TourManifestDrop` (`TourDetailsDrop | TourStationDrop | TourBlockDrop`;
    a station's carries `station`, a block's `block`). A drop with no
    `cause` is a malformed value.
- `serializeTourManifest(manifest, options?): string` - re-validates
  through the reader, refuses a manifest of a newer minor, then
  pretty-prints `{ version: 4, minor: 0, ... }`. The in-memory shape is
  the file's shape (a step's content is `action` in both), so nothing is
  mapped on the way.
- `createEmptyTourManifest(): TourManifest` - `{ version: 4, minor: 0,
order: "fixed", assets: [], stations: [] }`, the starter zip's content.
- The WORLD VIEW a creator's pages hold: `TourObject = TourPin |
TourPicture | TourModel` - a free block without its local pose, plus
  `geo` (its geo pose) and `station?` (absent on a draft object no station
  holds yet). A `TourPicture` carries its image asset inline
  (`imageAsset`, with `imageAsset.id === image`), because the page that
  captured a photo holds its asset before any tour lists it. `TourModel`
  carries its `sizeM` (required to place it). `TourObjectKind`.
- `TOUR_OBJECT_RECORD_FORMAT = 4` and `TourObjectRecord` - a world-view
  object as a creator's on-device draft stores it:
  `{ format: 4, block, asset?, geo, station? }` (`block` without a pose;
  `asset` a picture's image asset entry `{ id, path, width?, height? }`).
- `tourObjectRecord(object): TourObjectRecord` and
  `parseTourObject(value, at?): TourObject` - write and read that record.
  The reader checks the block by the block rules, strictly (a record whose
  optional text a reader would leave out fails too, so a draft never holds
  what a save would refuse), requires a world view, requires a picture's
  asset entry to be the image asset its picture names (and refuses one on
  any other kind), and checks a model's asset for its shape only (the
  manifest's write re-validates the reference).
- `TourManifestValidationError`, `TourManifestOlderFormatError` (with the
  file's `version`).
- Re-exported types: `TourAsset`, `TourAssetKind` (`tour-assets.ts`);
  `TourBlock` and each block kind's type, `TourBlockKind`, `TourBlockView`,
  `TourBlockDrop` (`tour-blocks.ts`); `TourLocalPose` (`tour-items.ts`);
  `TourOrder`, `TourStation`, `TourStationDrop` (`tour-stations.ts`);
  `TourStep`, `TourStepAction`, `TourStepAdvance`, `TourChoiceOption`,
  `TourQuiz`, `TourQuizAnswer`, `TourQuizOption` (`tour-story.ts`).

## Version 4 (a major)

- **Blocks and story.** `stations[]` each carry `geo` (required; no code
  link, no code-only station), `blocks[]` and `steps[]`. A step `show`s a
  block of its own station, asks a `choice` (an option's `goto` names a
  step of the station, or is absent: the next step), or asks a `quiz`. A
  block no step shows must stand in the world (`pin`, `plane`, `placed`).
  A station may have no steps (an automatic station: finding it
  completes it).
- **Every media file is an asset**, a captured photo's too: its bytes stay
  at `content/<id>.<ext>`, and the asset carries the picture's own id.
- **Separate namespaces.** Block ids are unique across the tour, asset ids
  across the assets, and a block may share an id with an asset: every
  reference says which kind it names.
- **Local poses are the truth.** The manifest holds the local poses as
  written, and the writer writes them as held: nothing on the way
  recomputes one, so a station's move or a save never nudges a block
  (property-tested bit for bit). The world view is computed
  (`tour-station-pose.ts` `tourObjects`).
- **No migration.** Versions 1, 2 and 3 are refused with
  `TourManifestOlderFormatError`: "this tour is in an older format
  (version N) that this version of the app no longer opens; it has to be
  made again". A page that kept something for that tour (a creator's
  unsaved draft) removes it by that type. A version 5 file is refused
  with "made with a newer version of the app (format 5); update the app to
  open it".
- **The walk is never branched by answers.** A `branch` order is refused
  in a sentence a creator can act on ("this tour lets answers choose the
  next station, which this version of the app no longer does; change its
  order to fixed or any"), and read as `any` from a newer minor; a
  station's `next` and a quiz's `route` are unknown fields.

## A station's description and card image

- Optional `description` and `image` (rules in `tour-stations.ts.md`):
  the description by the tour description's rule (trimmed, at most 2000
  characters), the image an id naming an image asset of the tour.
- **A card image whose picture went is dropped, never failed**: a
  well-formed id naming no image asset (a deleted photo or asset) is left
  out and reported with `cause: "station-image-gone"`. The writer accepts
  that drop quietly, beside the cover's `image-gone`, so deleting the
  photo a card shows never fails a save.
- **A malformed description or image is dropped too, never failed**, and
  reported with no `cause`; the writer refuses such a drop (a programming
  error fails loud). From a newer minor both read as none, unreported.

## An earlier file's `captureSpots` (removed)

- Earlier apps baked the walk's camera captures into the tour as
  `captureSpots`. They are debug data, never tour content, and the field
  is not part of the format: a file that still carries it opens as if it
  were any unknown field (ignored whatever its shape, every station kept
  as written), and no write carries it.

## A tour that needs no GPS

- `needsNoGps?: true`: the tour's printed codes place it on their own, so
  a viewer never asks its visitors for their location. Only `true` is
  kept; `false` and absent read as absent. A non-boolean is a broken file
  at this reader's minor and reads as absent from a newer one.

## A stable tour id

- `tourId?: string`: the tour's own id, minted once by the app that first
  saves the tour and kept by every save after, so a tour opened from a
  FILE keeps one key across saves (the Tour Viewer keys a creator's draft
  by it). Not a series id: unsigned, no version.
- The one id rule (`TOUR_ID_PATTERN`). **A bad id is dropped by the
  reader, never failed, at every minor** (it keys a draft only); the
  writer refuses one.

## Tour details

- `description?`, `cover?`, `contact?` (`TourDetails`, checked by
  `tour-details.ts`): the cover names an image asset of the tour.
- **Dropped, never failed, by the reader, at every minor**, and reported
  through `onDropped`; the writer leaves out only a cover whose image went
  (`cause` `image-gone`), and throws on any other drop.

## The version policy

- **Minor (`minor`, default 0).** Additive revisions of version 4. A
  reader opens any minor; unknown fields are IGNORED at every level and at
  every minor. The writer refuses a manifest whose minor is newer than
  `TOUR_MANIFEST_MINOR` (it was read with fields dropped). 4.0 has no
  later minor yet, so the writer writes 0; the minor that adds a field or
  a value brings back a "lowest minor the tour needs" rule, so an older
  reader is never handed something it would drop on its own write.
- **Unknown VALUES of a newer minor:** an unknown block kind or view, step
  kind, quiz answer type, advance mode or asset media type degrades as
  `tour-blocks.ts`, `tour-story.ts` and `tour-assets.ts` say (a story
  block in an unknown view shows as a card; a free block falls back to
  its kind's world view or is left out; a step or asset this reader
  cannot show is left out with what names it); an unknown `order` reads
  `any`; an unknown hint is the arrow. At this reader's own minor the same
  value fails. Such a tour is never written back.
- The series id and version number of a tour are NOT here:
  `manifest.json` is their one place (`tour-signed-manifest.ts`).

## Invariants & assumptions

- A station's `geo` is a `QrGeoPose` validated by `qr/geo-pose.ts`
  (shared with the level file).
- A block's `pose` is three finite offsets within 10 km and a unit
  quaternion (`tour-items.ts`).
- `id`s are path-safe segments (`[A-Za-z0-9_-]{1,64}`); an asset's `path`
  is `content/<its id>.<allowlisted ext>`.
- `title` is optional and non-blank, read trimmed.
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
  blocks: [
    {
      id,
      kind: 'shortText',
      view: 'pin',
      caption: 'Gate',
      createdAtIso,
      pose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
    },
  ],
  steps: [],
});
const text = serializeTourManifest(manifest); // throws if any record is wrong
parseTourManifest({ version: 3, stations: [] }); // throws TourManifestOlderFormatError
```

## Tests

- `tour-manifest.test.ts` - a station with a pin and a picture at local
  poses, the empty manifest, block and asset ids as separate namespaces,
  one rejection per rule with the record named, versions 1, 2 and 3
  refused as older formats (by type, with their version) and 5 as newer,
  version 4 minor 0 written, a full tour, the branch refusal, a newer
  minor's unknown fields ignored and its unknown values degraded (refused
  at this minor and on write), the placed model (read back exactly, a
  newer minor's oversized one left out, an asset's id allowed), a
  station's description and card image (round trip, the writer dropping
  an image whose asset went, the reader dropping malformed values, the
  writer refusing them), write/read round trip and the writer's refusals,
  the draft record (`tourObjectRecord` and `parseTourObject`: its shape, a
  pin, a picture with its asset entry and a model read back exactly, each
  refusal), an earlier file's `captureSpots`, the needs-no-GPS flag, the
  tour details and the tour id.
- `tour-manifest.property.test.ts` - over the shared generators
  (`test-utils/tour-arbitraries.ts`: blocks of every kind, free and shown,
  shows, choices and quizzes) with generated details, tour ids, station
  descriptions and card images: serialize->parse is the identity with
  every local pose the same numbers exactly, written at 4.0; parse is
  idempotent; the writer refuses every tour of a newer minor; every block
  stays in its station, and a kept cover or card image always names an
  image asset, every dropped card image reported.
- `tour-manifest.bytes.test.ts` - the writer's bytes pinned by recorded
  cases (`fixtures/tour-v4-writer-golden.json`) and a written file a
  fixed point.
