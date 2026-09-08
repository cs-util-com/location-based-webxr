# tour-manifest.ts

**Purpose:** the schema, reader and writer of `tour.json` - what a creator
placed in a tour (text pins, captured photos), each with an exact geo pose
(lat, lon, absolute altitude, rotation against north) minted the way the
printed code's pose is. Guided-setup plan DEC-N7/N8/N9
(`GpsPlusSlamJs_Docs/docs/2026-09-08-tour-viewer-improvements/2026-09-08-1459-tour-viewer-guided-setup-and-mandatory-code-plan.md`).

## Public API

- `TOUR_MANIFEST_VERSION = 1`.
- `parseTourManifest(data: unknown): TourManifest` - validates every field;
  throws `TourManifestValidationError` naming the object
  (`"objects[3].geo.lat" …`). Unknown kinds and duplicate ids reject.
- `serializeTourManifest(manifest): string` - re-validates through the
  reader, then pretty-prints.
- `createEmptyTourManifest(): TourManifest` - `{ version: 1, objects: [] }`,
  the starter zip's content.
- Types `TourManifest` (`version: 1` as a literal), `TourObject =
TourPin | TourPhoto` (a discriminated union on `kind`, so a renderer
  never asserts a field the parser guaranteed), `TourObjectKind`;
  `TourManifestValidationError`.

## Invariants & assumptions

- `objects[].geo` is a `QrGeoPose` validated by `qr/geo-pose.ts` (shared
  with the level file): rotation is a NUE unit quaternion; heading and
  rotation must agree.
- `id` is one path-safe segment (`[A-Za-z0-9_-]{1,64}`), unique in the
  manifest, and the content file's stem (`tour-archive.ts`).
- A `pin` needs a non-empty `label`; a `photo` needs `image` equal to
  `tourContentEntryName(id, ext)` for ITS OWN id (`content/<id>.<ext>`;
  any other string rejects) and positive integer `imageWidth`/
  `imageHeight` (the plane's aspect without decoding), and may carry a
  label. `createdAtIso` must parse as a date.
- `version` must equal `TOUR_MANIFEST_VERSION`: a later reader keys a
  migration on it; this one rejects anything else.
- Defensive at the boundary like `qr-level.ts`: hand-editable data, every
  field checked, the writer re-validates.

## Examples

```ts
const manifest = createEmptyTourManifest();
manifest.objects.push({ id, kind: 'pin', geo, createdAtIso, label: 'Gate' });
const text = serializeTourManifest(manifest); // throws if any object is wrong
```

## Tests

- `tour-manifest.test.ts` - accepts pins/photos, the empty manifest, one
  rejection per rule with the object named, write/read round trip, the
  writer's refusal.
- `tour-manifest.property.test.ts` - serialize→parse is the identity and
  parse is idempotent over generated manifests.
