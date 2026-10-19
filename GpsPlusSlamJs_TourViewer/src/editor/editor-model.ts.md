# editor/editor-model.ts

## Purpose

What the desktop editor (`/tour/edit.html`, M6 E1) shows of a tour, as
data: the rail's rows (codes, pins, photos) and the map's marks. Built on
the summary's model (`summary-model.ts` `buildSummaryModel`) and the one
naming rule (`object-describe.ts`), so a code and a note carry the same
name on the phone and on the desktop (M6 E1 plan review #1, #3). Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
§9. Pure.

## Public API

- `buildEditorModel({ manifest, objects, levels, fileName }): EditorModel`
  - `objects`: the pins and photos as they stand, in the world (the
    session's edits applied to `tourObjects(manifest)`; version 3 keeps
    them in stations, tour editor plan W3).
  - `items`: codes first (in `levels`' order - the zip's, which is the
    phone's numbering - titled by `codeLabel`: "The code" alone, else
    "Code N"; `number` 1-based; `at` null without a stored position), then
    the pins and photos of `objects` (title `objectTitle`, meta "Text note" /
    "Photo note" plus `codeDistanceLine`, a photo's `image` path), then the
    walk's recorded photos in the world (`tourCaptureGeos`: "Recorded
    photo", `recorded: true`, id `recorded:<entry>`).
  - `counts` per kind, `fitPoints` (every position, for framing), `title`
    (the manifest's, trimmed, else `fileName`).
- Every manifest note is listed; one whose position cannot be drawn keeps
  its row with `at: null` and "· no position" in its meta (E1 review #9).
- A placed 3D model (format minor 1) is listed nowhere and counted as no
  kind: this 2D editor knows pins and photos only, and a model shown as a
  note would be mislabelled. The tour keeps it untouched (the document
  slice carries it); the 3D editor is where it shows.
- The story's stations (`kind: "station"`, id `station:<id>`, title or
  "Station N" by `station-run.ts` `stationTitle`, meta "Station N"), at
  their own geo pose (version 3: every station has one, D9). Every
  station is listed, the automatic ones that hold the pins and photos
  included. A station standing within `ON_CODE_M` (1 m) of a code's
  measured point carries `onCode: true`: version 3 has no code link,
  but a creator still puts stations at codes, and the map draws such a
  station beside the code, never under it (PR #609 review). Its `at`
  stays its own point.
- `photoSource(item)` - where a photo item's bytes are: `{ kind:
"content", path }` for a placed photo (`loadContentEntry`), `{ kind:
"entry", path }` for a recorded one (its image is the archive's entry
  name, `loadEntry`); null without a photo (E1 review #1).
- `filterItems(items, query)` - the rows whose title or meta contains the
  trimmed query, case-insensitive; all for an empty query.
- `EditorItem`, `EditorItemKind`, `EditorModel` (the id prefixes `recorded:` and
  `station:` are internal).

## Invariants & assumptions

- Titles and metas are text for `textContent`, never markup (a zip anyone
  can write).
- A position nobody can draw (non-finite, outside the globe) is not
  drawn: the summary's `readablePoint` decides. The item keeps its row with
  `at: null` so it can still be found (E1 review #9) - a note ("· no
  position"), a recorded photo (the same, PR #609 review) and a station
  whose position cannot be drawn.
- The distance lines use the licensed library's geo maths, so a store must
  exist (any test builds one first).

## Examples

```ts
const model = buildEditorModel({
  manifest: (await session.loadTourManifest())!,
  levels: await session.loadQrLevels(),
  fileName: file.name,
});
const rows = filterItems(model.items, searchBox.value);
```

## Tests

`editor-model.test.ts`: the phone's numbering and a code without a
position, "The code" alone, the notes' titles and distance lines, the
recorded photos, the stations, a station at a code's point (`onCode`,
just inside and just outside `ON_CODE_M`), an undrawable note kept off the
map, a placed 3D model listed nowhere, the
title fallback, the filter and `photoSource`.
