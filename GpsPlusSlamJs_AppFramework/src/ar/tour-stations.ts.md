# tour-stations.ts

**Purpose:** the game content of `tour.json` (version 2, and version 3's
stations as parents of the tour's items) - media assets with
their own ids, stations, their steps (text, image, cut-out character,
audio, video, 3D model, scene choice, quiz), how a step advances, and the
answer routes of `branch` order. Tour kit plan K1 and §8 D7 ("the full v2
schema in one step"), G5 (media ids per asset), K-D3 (game scope v1),
K-D6 (arrow hints):
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

Version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3, D9, D20): a station carries its own geo pose (no printed-code link, no
code-only station), its pins and photos as `items` at local poses
(`tour-items.ts`), and may have no steps (an automatic station).

## Public API

- `parseTourAssets(value, { fail, lenient? }): TourAsset[]` - each asset
  is `{ id, path: "content/<id>.<ext>", kind, width?, height? }`. The kind
  is DERIVED from the extension through the media allowlist
  (`tour-media.ts`), never stored. Width/height are images only and come
  as a pair of positive integers.
- `parseTourStations(value, { assets, fail }): TourStation[]` - validates
  every station and resolves every reference.
- Types: `TourAsset`, `TourAssetKind`, `TourOrder` (`fixed | any |
branch`), `TourStation`, `TourStep`,
  `TourStepAdvance`, `TourBlock`, `TourChoiceOption`, `TourQuizOption`,
  `TourQuizAnswer`, `TourQuizRoute`.
- `fail` is the caller's: `tour-manifest.ts` passes one that throws
  `TourManifestValidationError`, so both modules raise the same error and
  this one never imports its parent (`check:cycles`).

## The schema

- **Asset**: `id` (`[A-Za-z0-9_-]{1,64}`), `path` exactly
  `content/<id>.<ext>` with an allowlisted extension (no SVG, K0). An
  asset id must not repeat; that it is no ITEM id (both name a content
  file by id) is checked by `tour-manifest.ts`, which sees every station.
- **Station**: `id`, optional `title`, `geo` (a geo pose, required;
  `qr/geo-pose.ts`), `activateRadiusM` and
  `foundRadiusM` (positive, found <= activate; the hysteresis is K4's),
  `hint` (`"arrow"`, the default), `steps` (may be empty), `items` (pins
  and photos at local poses, ids unique per station; `tour-items.ts`),
  optional `next` (the default next station for `branch` order). An old
  `anchor` field is ignored as an unknown field.
- **Step**: `id` (unique per station), `block`, `advance` (`{ mode: "tap" }`
  by default, or `{ mode: "auto", afterS > 0 }`). The default is written
  out on parse, so a renderer never guesses.
- **Blocks**:
  - `text { text }`;
  - `image { asset, caption? }` (an image asset);
  - `character { name, image, caption, voice? }` - a cut-out image, the
    caption REQUIRED (captions always), the voice an audio asset;
  - `audio { asset, transcript }` and `video { asset, transcript }` - the
    transcript REQUIRED (audio needs a text version);
  - `model { asset, caption? }` (a `.glb` asset);
  - `choice { prompt, options: [{ id, label, goto }] }` - a scene choice:
    at least 2 options, each `goto` a step of the SAME station;
  - `quiz { question, points (integer >= 0), answer, route? }`.
- **Quiz answers**: `single { options, correct }`, `multiple { options,
correct[] }` (at least 2 options, unique ids, correct among them),
  `text`/`code { salt, sha256[] }` (salted SHA-256 hex of the accepted
  answers after K5's normalisation - a deterrent only), `number { value,
tolerance >= 0, unit? }`.
- **Routes** (`branch` order): `route { byOption?, correct?, wrong? }`;
  `byOption` only on a choice quiz and only for its own options; every
  target a station id.

## Invariants & assumptions

- Unknown fields are ignored (the version policy lives in
  `tour-manifest.ts`).
- **`lenient` (a file of a newer minor, K1 milestone review R4).** The
  closed lists - block kind, quiz answer type, advance mode, hint, an
  asset's media type - are what a later minor extends. With `lenient` an
  unknown value degrades instead of failing: an asset of an unknown type
  is left out; an item of an unknown kind or image type is left out; a
  step whose block kind or quiz type is unknown, or whose
  asset is missing or of another kind, is SKIPPED; a scene choice keeps
  only options whose target step is still there, and is skipped itself
  below two (repeated until nothing changes); an unknown advance mode is
  `tap`, an unknown hint `arrow`. A station whose every step was skipped
  stays, with no steps (routes may name it; finding it completes it).
  Without `lenient` every one of these fails, as before. Never lenient:
  a malformed value of a KNOWN kind (a quiz without options, a bad id).
- Not checked here, by design: whether every station is reachable under
  `branch` order (K5's reachability check), and whether radii fit the
  measured accuracy (K4, §8 D9).
- No list or length caps: the whole document is read under the text cap of
  `archive-limits.ts` (16 MiB), which already bounds the work; a cap per
  list would be a second, arbitrary limit with nothing measured behind it.
  The castle example needs about 10 stations of about 10 steps.

## Examples

```ts
const assets = parseTourAssets(json.assets, { fail });
const stations = parseTourStations(json.stations, { assets, fail });
// A file of a newer minor: what this reader cannot show is skipped.
parseTourStations(json.stations, { assets, fail, lenient: true });
```

## Tests

- `tour-stations.test.ts` - a castle station (character scene, choice,
  model, quiz), every quiz answer type, routes, the defaults, one
  rejection per rule, and the version 3 station (empty steps, items read,
  an old anchor ignored).
- `tour-stations.property.test.ts` - generated station sets survive a JSON
  round trip unchanged; breaking any one asset reference or a choice
  target is refused; one unknown closed-list value anywhere never fails a
  lenient parse, everything that survives still resolves, and the same
  input fails a strict parse.
