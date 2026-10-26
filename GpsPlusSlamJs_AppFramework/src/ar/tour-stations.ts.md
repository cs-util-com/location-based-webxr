# tour-stations.ts

**Purpose:** the game content of `tour.json` (version 2, and version 3's
stations as parents of the tour's items) - media assets with
their own ids, stations, their steps (text, image, cut-out character,
audio, video, 3D model, scene choice, quiz) and how a step advances.
Tour kit plan K1 and §8 D7 ("the full v2
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
- `parseTourStations(value, { assets, fail, lenient?, onDropped? }): TourStation[]` - validates
  every station and resolves every reference. `onDropped` hears each
  station description or card image left out (`TourStationDrop`:
  `{ field: "description" | "image", station, reason, cause? }`; `cause`
  is `"station-image-gone"` for an image whose picture went and absent for
  a malformed value; minor 2, below).
- `parseTourQuiz(value, at, { fail, lenient? }): TourQuiz | null` - a
  quiz's `question`, `points` and `answer`. `null` when a lenient reader meets an answer type it
  does not know; the caller skips the step. Shared with version 4's story
  (`tour-story.ts`), so both versions read a quiz alike.
- `parseTourStepAdvance(value, at, { fail, lenient? }): TourStepAdvance` -
  how a step advances (`tap` when absent; an unknown mode reads as `tap`
  when lenient). Shared with version 4's story the same way.
- Types: `TourAsset`, `TourAssetKind`, `TourStationDrop`, `TourQuiz`, `TourOrder` (`fixed | any`),
  `TourStation`, `TourStep`,
  `TourStepAdvance`, `TourStepAction`, `TourStepRecord`, `TourChoiceOption`, `TourQuizOption`,
  `TourQuizAnswer`.
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
  `hint` (`"arrow"`, the default), `steps` (may be empty), `items` (pins,
  photos and placed models at local poses, ids unique per station;
  `tour-items.ts`; a placed model's `asset` must name a MODEL asset,
  resolved here because only this module sees the assets),
  optional `description` and `image` (minor 2, below). An old
  `anchor` field is ignored as an unknown field, and so is a `next` (a
  default next station of the former `branch` order).
- **A station's description and card image (minor 2;** G2 build plan
  `GpsPlusSlamJs_Docs/docs/2026-10-21-2247-g2-3d-editor-build-plan.md`,
  §4.2.4, Q14**):**
  - `description`: the tour description's rule (`checkTourDescription` of
    `tour-details.ts`): read trimmed, line breaks kept, at most 2000
    characters (code points), so what the editor's field accepts is what a
    reader keeps. A blank one reads as none, as a blank title does. Not
    text, or too long: left out and reported with no `cause` at this
    reader's minor (never failing the tour; a writer refuses it), left out
    unreported from a newer one.
  - `image`: an id naming a PHOTO item of this same station or an IMAGE
    asset of the tour (`tourImageIds` over the station's items; items and
    assets share one id namespace, so an id is never both). A well-formed
    id naming neither - the photo or asset was deleted, or it names
    another station's photo, a pin or an asset of another kind - is LEFT
    OUT and reported through `onDropped` as `station-image-gone`, at every
    minor, never failing the tour; the writer accepts that drop like the
    cover's `image-gone`. A value that is not an id: left out and
    reported with no `cause` at this reader's minor (a writer refuses
    it). From a newer minor any image this reader cannot resolve is left
    out UNREPORTED - malformed, or naming a photo or asset this reader
    skipped as a newer media type, which is not gone.
  - The station's items are parsed before its image, since the image may
    name one of them.
- **Step**: `id` (unique per station), `block`, `advance` (`{ mode: "tap" }`
  by default, or `{ mode: "auto", afterS > 0 }`). The default is written
  out on parse, so a renderer never guesses. The reader holds the file's
  `block` as the step's `action` (`TourStep`: `{ id, action, advance }`);
  `tourStationRecord(station)` maps back to the file's shape (`TourStepRecord`: `{ id, block, advance }`, in that
  key order; every other station field and its position kept), which
  every writer applies before writing. A file step carrying `action`
  and no `block` is refused: the file format is unchanged.
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
  - `quiz { question, points (integer >= 0), answer }`; a former
    `route` (answer routes of `branch` order) is ignored as an unknown
    field, whatever it names.
- **Quiz answers**: `single { options, correct }`, `multiple { options,
correct[] }` (at least 2 options, unique ids, correct among them),
  `text`/`code { salt, sha256[] }` (salted SHA-256 hex of the accepted
  answers after K5's normalisation - a deterrent only), `number { value,
tolerance >= 0, unit? }`.

## Invariants & assumptions

- Unknown fields are ignored (the version policy lives in
  `tour-manifest.ts`).
- **`lenient` (a file of a newer minor, K1 milestone review R4).** The
  closed lists - block kind, quiz answer type, advance mode, hint, an
  asset's media type - are what a later minor extends. With `lenient` an
  unknown value degrades instead of failing: an asset of an unknown type
  is left out; an item of an unknown kind or image type is left out, and
  so is a placed model whose asset was left out or is not a model; a
  step whose block kind or quiz type is unknown, or whose
  asset is missing or of another kind, is SKIPPED; a scene choice keeps
  only options whose target step is still there, and is skipped itself
  below two (repeated until nothing changes); an unknown advance mode is
  `tap`, an unknown hint `arrow`. A station whose every step was skipped
  stays, with no steps (finding it completes it).
  Without `lenient` every one of these fails, as before. Never lenient:
  a malformed value of a KNOWN kind (a quiz without options, a bad id).
- Not checked here, by design: whether radii fit the measured accuracy
  (K4, §8 D9).
- No list or length caps: the whole document is read under the text cap of
  `archive-limits.ts` (16 MiB), which already bounds the work; a cap per
  list would be a second, arbitrary limit with nothing measured behind it.
  The castle example needs about 10 stations of about 10 steps. The one
  length cap is a station description's, and it is not new: it is the
  tour description's own (`TOUR_DESCRIPTION_MAX_CHARS`), shared so the
  editor's fields count alike.

## Examples

```ts
const assets = parseTourAssets(json.assets, { fail });
const stations = parseTourStations(json.stations, { assets, fail });
// A file of a newer minor: what this reader cannot show is skipped.
parseTourStations(json.stations, { assets, fail, lenient: true });
// A card image whose photo was deleted, or a malformed description or
// image, is left out, and said.
parseTourStations(json.stations, {
  assets,
  fail,
  onDropped: (drop) => console.warn(drop.station, drop.reason),
});
```

## Tests

- `tour-stations.test.ts` - a castle station (character scene, choice,
  model, quiz), every quiz answer type, a station `next` and a quiz
  `route` ignored even naming no station, the defaults, one
  rejection per rule, and the version 3 station (empty steps, items read,
  a placed model naming a model asset, refused for a missing, image or
  audio asset, left out by a lenient read whose asset it lacks, an old
  anchor ignored), and the minor 2 station fields (a description read
  trimmed and a blank one as none, dropped with no cause when not text or
  over 2000 characters, counted in code points; an image naming the
  station's own photo or an image asset kept; one naming another
  station's photo, a pin, an audio or model asset or nothing dropped with
  `station-image-gone`; an image that is not an id dropped with no cause;
  from a newer minor, malformed values of both fields read as none,
  unreported, and so does an image naming a photo this reader skipped).
- `tour-stations.property.test.ts` - generated station sets survive a JSON
  round trip unchanged; breaking any one asset reference or a choice
  target is refused; one unknown closed-list value anywhere never fails a
  lenient parse, everything that survives still resolves, and the same
  input fails a strict parse.
