# City look lab fixtures: provenance

Both files are real OpenStreetMap data, © OpenStreetMap contributors, available
under the Open Database License (ODbL 1.0,
<https://www.openstreetmap.org/copyright>). The lab's pages show that line.

They hold one Overpass response each, in the shape of the Osm library's site
fixtures: the capture's metadata plus the raw answer in `payload`. They are
stored minified (`../../../.prettierignore`), and the lab fetches them at
runtime. Nothing here is used outside this lab.

## `lucerne-meggen.json`

- Place: Meggen, a detached-house suburb on the lake east of Lucerne, Switzerland;
  640 x 640 m around 47.0468 N, 8.3745 E.
- Source: `https://overpass-api.de/api/interpreter`, one POST on 2026-11-07
  (`osm3s.timestamp_osm_base` 2026-11-07T05:36:06Z).
- Query: the library's production form, `buildTileQuery` of
  `GpsPlusSlamJs_Osm/src/source/overpass-query.ts` (the union of exact keys, not
  the regex of the older capture script), stored in the file's `query` field.
- One element removed after the capture, and named in the file's
  `droppedOversizeRelations`: relation 2698607, the 2.1 MB
  `boundary=mountain_range` outline of the Alps. The bbox touches it and this lab
  never reads it. The answer was 2 850 264 bytes and 1 029 elements with it; the
  file is 755 952 bytes and 1 028 elements without it. Everything else is byte for
  byte what the server sent, re-serialised as JSON.
- What it holds: 226 buildings, 214 of them `building=yes`. No building carries
  `height`, `building:levels` or `roof:shape`, and there is no `building:part`.
  That is the case this fixture exists for: a real suburb where every look has to
  work without tags. The tagged case is Heidelberg's.
- The lake (relation 1442399) is in the file, but the lab draws flat ground, so
  it is not drawn.

## `heidelberg-altstadt.json`

- A byte-for-byte copy of the Osm library's
  `GpsPlusSlamJs_Osm/src/testdata/sites/heidelberg-altstadt.json`, whose own fields
  say how it was captured (from `overpass.kumi.systems`, the older `nwr` query form,
  data of 2026-05-31). It is copied because the deploy ships `3d/` and `labs/`
  only.
- What it holds: 315 buildings; 99 of them (31.4 %) carry `height` or
  `building:levels`, 100 carry `roof:shape`.
