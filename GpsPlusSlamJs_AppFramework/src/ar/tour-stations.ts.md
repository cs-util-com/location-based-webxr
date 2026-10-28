# tour-stations.ts

**Purpose:** the STATIONS of `tour.json` version 4: each station a geo
pose (position and a rotation against north) with two radii, its BLOCKS -
what it shows, each at a local pose in the station's frame
(`tour-blocks.ts`) - and its STORY, the steps that show some of those
blocks, ask choices and quizzes (`tour-story.ts`). A block no step shows
is free: it stands in the world while its station is shown. A station may
have no steps: an automatic station only groups what was placed there,
and finding it completes it. Design:
`GpsPlusSlamJs_Docs/docs/2026-10-25-0845-station-blocks-model-proposal-design.md`.

## Public API

- `parseTourStations(value, { assets, fail, lenient?, onDropped? }): TourStation[]`
  - validates every station against the tour's (already validated)
    assets and resolves every reference. `onDropped` hears each station
    description or card image left out (`TourStationDrop`:
    `{ field: "description" | "image", station, reason, cause? }`; `cause`
    is `"station-image-gone"` for an image whose asset went, absent for a
    malformed value) and each block or block field a reader left out
    (`TourBlockDrop`, `tour-blocks.ts`).
- Types: `TourStation` (`{ id, title?, description?, image?, geo,
activateRadiusM, foundRadiusM, hint: "arrow", blocks, steps }`),
  `TourStationDrop`, `TourStationsReadOptions`, `TourOrder`
  (`fixed | any`).
- `fail` is the caller's: `tour-manifest.ts` passes one that throws
  `TourManifestValidationError`, so every module raises the same error and
  none imports its parent (`check:cycles`).

## The schema

- **Station**: `id`, optional `title`, `geo` (a geo pose, required;
  `qr/geo-pose.ts`), `activateRadiusM` and `foundRadiusM` (positive,
  found <= activate), `hint` (`"arrow"`, the default), `blocks` and
  `steps` (both lists, may be empty), optional `description` and `image`
  (below). An old `anchor`, a `next` (a default next station of the
  former `branch` order) and an `items` list (version 3's) are unknown
  fields, ignored.
- **Blocks and story** are read together by `tour-story.ts`
  (`parseTourStationContent`): every block checked and every media
  reference resolved, every `show` naming a block of THIS station, every
  `goto` a step of this station, and every block no step shows standing
  in the world. Block ids are unique across the WHOLE tour
  (`checkTourBlockIdsUnique`), step ids per station.
- **Description**: the tour description's rule (`checkTourDescription`
  of `tour-details.ts`): read trimmed, line breaks kept, at most 2000
  characters (code points). A blank one reads as none. Not text, or too
  long: left out and reported with no `cause` at this reader's minor
  (never failing the tour; a writer refuses it), left out unreported from
  a newer one.
- **Card image**: an id naming an IMAGE asset of the tour (a captured
  photo's asset among them; `tourImageIds`). A well-formed id naming none
  (a deleted photo or asset, a block id, an asset of another kind) is
  LEFT OUT and reported as `station-image-gone`, never failing the tour;
  the writer accepts that drop like the cover's `image-gone`. A value
  that is not an id: left out and reported with no `cause` (a writer
  refuses it). From a newer minor any image this reader cannot resolve is
  left out UNREPORTED - malformed, or naming an asset this reader skipped
  as a newer media type, which is not gone.

## Invariants & assumptions

- Unknown fields are ignored (the version policy lives in
  `tour-manifest.ts`).
- **`lenient` (a file of a newer minor).** What this reader cannot show is
  skipped by the block and story readers (see theirs); an unknown hint is
  the arrow. Without `lenient` every one of these fails. Never lenient: a
  malformed value of a KNOWN kind (a bad id, a bad geo pose, a bad
  radius).
- Not checked here, by design: whether radii fit the measured accuracy.
- No list or length caps beyond the texts' own: the whole document is read
  under the text cap of `archive-limits.ts` (16 MiB), which already bounds
  the work.

## Examples

```ts
const assets = parseTourAssets(json.assets, { fail });
const stations = parseTourStations(json.stations, { assets, fail });
// A file of a newer minor: what this reader cannot show is skipped.
parseTourStations(json.stations, { assets, fail, lenient: true });
// A card image whose photo was deleted, or a malformed description, is
// left out, and said.
parseTourStations(json.stations, {
  assets,
  fail,
  onDropped: (drop) => console.warn(drop.reason),
});
```

## Tests

- `tour-stations.test.ts` - a castle station (a character and a model on
  the stage, a choice, a quiz), every quiz answer type, a station `next`
  and a quiz `route` ignored, the defaults, one rejection per rule (the
  station's own fields, block poses, block ids twice in a station and
  across stations, a show naming another station's block, each block
  kind's required fields and asset references, advances, choices,
  quizzes), a station with no steps and its free blocks read kind by
  kind, a lenient read leaving out a model whose asset it lacks, an old
  anchor and items list ignored, and the description and card image
  rules.
- `tour-stations.property.test.ts` - over the shared generators: station
  sets survive a JSON round trip unchanged; breaking any one asset
  reference or a choice target is refused; one unknown closed-list value
  anywhere never fails a lenient parse, everything that survives still
  resolves (shows, gotos, media, free blocks in a world view), and the
  same input fails a strict parse.
