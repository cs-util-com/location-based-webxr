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

- `buildEditorModel({ manifest, levels, fileName }): EditorModel`
  - `items`: codes first (in `levels`' order - the zip's, which is the
    phone's numbering - titled by `codeLabel`: "The code" alone, else
    "Code N"; `number` 1-based; `at` null without a stored position), then
    the manifest's pins and photos (title `objectTitle`, meta "Text note" /
    "Photo note" plus `codeDistanceLine`, a photo's `image` path), then the
    walk's recorded photos (`captureSpots.captures`: "Recorded photo",
    `recorded: true`, id `recorded:<entry>`).
  - `counts` per kind, `fitPoints` (every position, for framing), `title`
    (the manifest's, trimmed, else `fileName`).
- Every manifest note is listed; one whose position cannot be drawn keeps
  its row with `at: null` and "· no position" in its meta (E1 review #9).
- The story's stations (`kind: "station"`, id `station:<id>`, title or
  "Station N" by `station-run.ts` `stationTitle`, meta "Station N" or
  "Station N · at <code>"), at their own
  position or their anchoring code's (`anchor.code` is a level id).
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
  without its own position or a code's.
- A station drawn at its code's point (no drawable position of its own)
  carries `onCode: true`: the map draws it beside the code, never under it
  (PR #609 review).
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
recorded photos, the stations, an undrawable note kept off the map, the
title fallback, the filter and `photoSource`.
