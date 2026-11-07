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

## `nyc-midtown.json`

- Place: Midtown Manhattan, New York, between Times Square and Ninth Avenue;
  640 x 640 m around 40.7590 N, 73.9880 W.
- Why this area: it holds both kinds of building the city look must not get
  wrong. The avenues and Times Square carry towers up to 325 m, most of them
  height-tagged and many split into `building:part`s; the side streets west of
  Eighth Avenue carry four- to six-storey walk-ups and theatres with flat roofs,
  and a few outlines have no height at all. 47 outlines are tagged
  `roof:shape=flat`, none with another shape.
- Source: `https://overpass-api.de/api/interpreter`, one POST on 2026-11-07
  (`osm3s.timestamp_osm_base` 2026-11-07T14:09:51Z), with the Meggen
  fixture's query form (`buildTileQuery`), only the bbox changed. The answer was
  1 650 063 bytes and 2 143 elements; the file is that answer re-serialised as
  minified JSON, nothing removed.
- What it holds: 488 building outlines and 341 `building:part`s; 437 outlines
  (89.5 %) carry `height`, 65 (13.3 %) `building:levels`, 47 (9.6 %)
  `roof:shape`. Tagged heights: median 17.4 m, 90th percentile 33.2 m.

## `nyc-park-slope.json`

- Place: Park Slope, Brooklyn, New York, the brownstone blocks between Seventh
  Avenue and Prospect Park West; 640 x 640 m around 40.6725 N, 73.9790 W.
- Why this area: closed rows of three- and four-storey houses with flat roofs,
  the case a pitched-roof default gets wrong, plus a commercial avenue, schools,
  churches and a supermarket. Its heights come from a city building import, so
  nearly every outline is height-tagged and none carries a roof shape: a roof
  rule there cannot lean on `roof:shape`.
- Source: as Midtown's (`osm3s.timestamp_osm_base` 2026-11-07T14:10:51Z). The
  answer was 1 729 361 bytes and 2 313 elements, nothing removed.
- What it holds: 1 419 building outlines and 101 `building:part`s; 1 416
  outlines (99.8 %) carry `height`, 3 `building:levels`, 0 `roof:shape`. Tagged
  heights: median 12.9 m, 10th percentile 9.8 m, 90th percentile 15.4 m.

## `lucerne-reuss.json`

- Place: Lucerne's old town on the Reuss, the Kapellbruecke and the lake's end,
  Switzerland; 640 x 640 m around 47.0517 N, 8.3077 E.
- Why this area: the only lab scene with real water (the lake is about 15 % of
  the box, plus a river relation), 16 highway bridges at `layer=1`, 351 mapped
  trees and 147 benches, which the other fixtures lack.
- Source: `https://overpass-api.de/api/interpreter`, one POST on 2026-11-07
  (`osm3s.timestamp_osm_base` 2026-11-07T14:28:06Z), with the Meggen fixture's
  query form (`buildTileQuery`), only the bbox changed. Captured by the city
  objects research session.
- Two elements removed after the capture, and named in the file's
  `droppedOversizeRelations`, as Meggen dropped its own: relation 20172352, the
  1.5 MB `boundary=place` outline of the Swiss Alps, and relation 11342350, the
  124 kB `boundary=natural` outline of the Emmental Alps. The answer was
  4 426 428 bytes and 3 084 elements; the file is 1 496 678 bytes and 3 082
  elements, minified, everything else as the server sent it.
- What it holds: 478 buildings and 15 `building:part`s; 249 carry `height` or
  `building:levels`, 115 `roof:shape`. Land use: 4 parks, 9 car parks, 4 pitches,
  2 tracks, 2 playgrounds, 4 water areas, residential, retail, railway and
  construction land.

## `woodland-hinterzarten.json`

- Place: Hinterzarten, a village in the Black Forest, Germany, where its houses
  meet the mapped woods; 640 x 640 m around 47.9030 N, 8.1070 E.
- Why this area: the only lab scene with real woods (25 wood or forest ways and 2
  relations, 1 orchard, 9 scrub areas, 2 tree rows), most of them with a
  `leaf_type`: 9 `mixed`, 9 `broadleaved`, 3 `needleleaved`, 6 untyped. It also
  holds 126 mapped trees (125 with `leaf_type`, 21 with `leaf_cycle`), 191
  buildings and a few hedges, walls and fences. Chosen for the city objects
  round's O1 (cosmetic trees inside mapped woods).
- Source: `https://overpass-api.de/api/interpreter`, one POST on 2026-11-07
  (`osm3s.timestamp_osm_base` 2026-11-07T16:23:05Z), with the query built by
  `buildTileQuery` itself (checked identical to Meggen's stored form, only the
  bbox changed). The answer was 750 155 bytes and 762 elements; the file is
  554 484 bytes, minified, nothing removed. Large forest relations (112835, 67504) reach outside the box, so a page that scatters trees clips to the bbox.
