# tour-manifest.ts

**Purpose:** the schema, reader and writer of `tour.json` - what a creator
placed in a tour (text pins, captured photos), each with an exact geo pose
(lat, lon, absolute altitude, rotation against north) minted the way the
printed code's pose is, and from format version 2 the tour kit's game
content (title, station order, media assets, stations). Guided-setup plan
DEC-N7/N8/N9
(`GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`);
tour kit plan K1 and §8 D7
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`).

## Public API

- `TOUR_MANIFEST_VERSION = 2` (the format's major number) and
  `TOUR_MANIFEST_MINOR = 0` (the newest additive revision this module
  knows).
- `parseTourManifest(data: unknown): TourManifest` - validates every field;
  throws `TourManifestValidationError` naming the object
  (`"objects[3].geo.lat" …`, `"stations[0].steps[2].block.asset" …`).
  Unknown kinds and duplicate ids reject - except in a file of a NEWER
  minor, where an unknown value of a closed list degrades (below). A
  version 1 document MIGRATES.
- `serializeTourManifest(manifest): string` - re-validates through the
  reader, refuses a manifest of a newer minor, then pretty-prints - as
  `{ version: 1, objects }` when nothing in it needs version 2 (below).
- `createEmptyTourManifest(): TourManifest` - `{ version: 2, minor: 0,
order: "fixed", objects: [], assets: [], stations: [] }`, the starter
  zip's content.
- Types `TourManifest`, `TourObject = TourPin | TourPhoto` (a
  discriminated union on `kind`, so a renderer never asserts a field the
  parser guaranteed), `TourObjectKind`; `TourManifestValidationError`; and
  re-exported from `tour-stations.ts`: `TourAsset`, `TourAssetKind`,
  `TourOrder`, `TourStation`, `TourStationAnchor`, `TourStep`,
  `TourStepAdvance`, `TourBlock`, `TourChoiceOption`, `TourQuizOption`,
  `TourQuizAnswer`, `TourQuizRoute`.

## The version policy (K1)

- **Major (`version`).** 2 is read as is; 1 MIGRATES: its pins and photos
  stay as free objects, `minor` 0, `order` `"fixed"`, no assets, no
  stations (its own fields beyond `objects` are ignored). A higher
  integer is refused as "made with a newer version of the app (format N)";
  anything else as not a format number.
- **What is written (K1 milestone review R10).** A manifest with no title,
  no assets, no stations, the default order and minor 0 is written as
  `{ version: 1, objects }` - exactly what the pre-K1 reader checks
  (`version === 1`, then `objects`), so a Finish of a pins-and-photos tour
  still opens on the deployed `main` and older previews. Anything that
  uses version 2 is written as version 2. In memory a manifest is always
  version 2; the downgrade is the text alone, and it reads back to the
  same manifest.
- **Minor (`minor`, default 0).** Additive revisions of version 2. A
  reader opens any minor; unknown fields are IGNORED at every level and at
  every minor (so a typo in a hand-edited optional field reads as absent:
  the cost of being forward compatible). The writer refuses a manifest
  whose minor is newer than `TOUR_MANIFEST_MINOR`: it was read with fields
  dropped, and writing it back would lose them silently. A creator's
  Finish on such a tour therefore fails with that message instead of
  destroying content.
- **Unknown VALUES of a newer minor (K1 milestone review R4).** "Additive"
  must hold for the closed lists too, or a later minor that adds a block
  kind breaks every older reader. In a file whose `minor` is newer than
  `TOUR_MANIFEST_MINOR`: an unknown object kind, or a photo of an unknown
  image type, leaves the object out; an unknown `order` reads `any`
  (every station offered: a stricter guess could strand one); the
  stations' lists degrade as `tour-stations.ts` says. At this reader's
  own minor or below the same value fails, as before. Such a tour is
  never written back (the newer-minor refusal above), so nothing is lost.
- **Drafts.** A draft object is validated by wrapping it in a manifest of
  the CURRENT version (`draft-persistence.ts`), and the object shapes did
  not change between 1 and 2, so a draft written by a pre-K1 app reads
  as version 2 (the Tour Viewer's draft test loads one), and its Finish is
  written as version 1 while it uses nothing of version 2 (R10).
- The series id and version number of a tour are NOT here:
  `manifest.json` is their one place (§8 G7, `tour-signed-manifest.ts`).

## Invariants & assumptions

- `objects[].geo` is a `QrGeoPose` validated by `qr/geo-pose.ts` (shared
  with the level file): rotation is a NUE unit quaternion; heading and
  rotation must agree.
- `id` is one path-safe segment (`[A-Za-z0-9_-]{1,64}`), unique in the
  manifest, and the content file's stem (`tour-archive.ts`).
- A `pin` needs a non-empty `label`; a `photo` needs `image` equal to
  `tourContentEntryName(id, ext)` for ITS OWN id (`content/<id>.<ext>`;
  any other string rejects) with an allowlisted IMAGE extension (no SVG,
  no model or media; tour kit plan K0, checked before the name is built so
  the error is the manifest's own) and positive integer `imageWidth`/
  `imageHeight` (the plane's aspect without decoding), and may carry a
  label. `createdAtIso` must parse as a date.
- `title` is optional and non-blank; `order` is `fixed | any | branch`.
- Assets and stations are validated by `tour-stations.ts`, with the
  object ids passed in (an asset id must not be an object id: both name a
  content file by id).
- Defensive at the boundary like `qr-level.ts`: hand-editable data, every
  field checked, the writer re-validates.

## Examples

```ts
const manifest = createEmptyTourManifest();
manifest.objects.push({ id, kind: 'pin', geo, createdAtIso, label: 'Gate' });
const text = serializeTourManifest(manifest); // throws if any object is wrong
parseTourManifest({ version: 1, objects: [] }).version; // 2 (migrated)
```

## Tests

- `tour-manifest.test.ts` - accepts pins/photos, the empty manifest, one
  rejection per rule with the object named, write/read round trip, the
  writer's refusal; the version policy: v1 migration, a tour without
  version 2 content written as exactly `{ version: 1, objects }` and each
  kind of version 2 content (title, order, asset, station) written as 2,
  a full v2 tour, a newer minor read with unknown fields ignored and
  refused on write, a newer minor's unknown values degraded (and the same
  file refused at this minor), a newer major and a malformed version
  refused.
- `tour-manifest.property.test.ts` - serialize→parse is the identity and
  parse is idempotent over generated manifests; a generated v1 manifest
  migrates to the v2 manifest with the same objects, and migrating is
  idempotent.
