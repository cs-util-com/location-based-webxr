# `source/overpass-query.ts`

## Purpose

Builds the Overpass QL query for one fetch tile, and converts an H3 cell into
the bounding box it needs.

## Public API

- `OVERPASS_SCHEMA_VERSION` — part of every cache key.
- `BoundingBox` — `{ south, west, north, east }`.
- `cellToBoundingBox(cell)` → `BoundingBox`. **Throws `AntimeridianCellError`**
  for a cell spanning ±180°.
- `buildTileQuery(bbox, timeoutSeconds?)` → Overpass QL string.
- `AntimeridianCellError`.

## Invariants & assumptions

- **The bbox is LARGER than the hexagon**, so adjacent fetch tiles overlap and
  some features come back more than once. Accepted — dedup happens by OSM
  element id at index time — but it makes "features in a tile" and "features
  returned for a tile" different sets, which is why a fixture's element count
  must not be read as a coverage measure. Pinned by an overlap test.
- **A cell straddling the antimeridian throws.** Overpass's bbox is
  `south,west,north,east` with `west < east` and cannot represent a wrap.
  Failing loudly beats emitting a bbox that silently covers the whole globe the
  wrong way round. Detection uses a >180° longitude span, which cannot occur for
  a genuine res-8 hexagon (~1 km across).
- **`OVERPASS_SCHEMA_VERSION` must be bumped whenever the query changes shape**
  in a way that makes cached tiles non-equivalent — narrowing the tag filter,
  changing `out` mode. Forgetting is a silent-wrong-data bug: a narrowed query
  keeps serving old wide tiles, a widened one keeps serving old narrow ones and
  the missing features look like unmapped ground.

## The query, and a measured problem with it

```
[out:json][timeout:60][bbox:{south},{west},{north},{east}];
nwr[~"."~"."];
out geom;
```

- `nwr` selects nodes, ways and relations in one statement.
- `[~"."~"."]` is the Overpass idiom for "has at least one tag" — the honest
  reading of "everything", since untagged nodes carry no scoring information and
  their coordinates arrive anyway inline via `out geom`.
- `out geom` inlines member coordinates, so no recursive-down pass and no
  client-side node-reference resolution — the fragile part of the C# reference's
  `.ToComplete()` step.

**This query does not complete against public Overpass instances.** Measured
2026-07-28 on one res-8 tile: 504 Gateway Timeout after 101 s. A curated
key-filtered variant returned 2.90 MB in 96 s; a res-10 tile returning 60 KB
still took 75 s. Response time is dominated by server queueing, not by the
query. Full detail and the numbers are in `../testdata/README.md`; the fixture
capture script uses the key-filtered form. Making the key filter a first-class,
rule-table-derived option of this module is an open follow-up.

## Tests

- `overpass-query.test.ts` — bbox contains every boundary vertex; ordering;
  neighbour overlap; high latitude; the antimeridian throw; and the exact query
  text including each of the four clauses above.
