# `source/overpass-query.ts`

## Purpose

Builds the Overpass QL query for one fetch tile, and converts an H3 cell into
the bounding box it needs.

## Public API

- `OVERPASS_SCHEMA_VERSION` — part of every cache key.
- `BoundingBox` — `{ south, west, north, east }`.
- `cellToBoundingBox(cell)` → `BoundingBox`. **Throws `AntimeridianCellError`**
  for a cell spanning ±180°.
- `buildTileQuery(bbox, timeoutSeconds?, keys?)` → Overpass QL string.
- `dropUnselectedRelations(payload, keys?)` → `{ elements, droppedRelations }`.
  The counterpart of `buildTileQuery`: it removes the relations that query's
  single unqualified relation statement admits and the old per-key statements
  would not have returned. **Anyone calling `buildTileQuery` directly must call
  this on the response**, or they receive areal relations carrying none of the
  selected keys. Never throws; an unrecognised payload passes through unchanged
  so the parser downstream stays the thing that rejects it.
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
- **The query asks for MORE relations than it keeps, on purpose (2026-09-20).**
  `buildTileQuery` emits 32 `nw["key"]` statements plus **one**
  `relation["type"~"^(multipolygon|boundary)$"]`, replacing the 32 keyed
  relation statements that used to be there. Measured against
  `z.overpass-api.de`: median 18.6 s → 10.8 s at Cologne res 7 over 5 paired
  samples, and 24.3 s → 12.9 s over Manhattan's 22 km² box. The old form also
  carried the variance, ranging 12.0-27.1 s.
  - **The single statement is a strict SUPERSET of the 32 it replaces**, by set
    theory rather than measurement: `relation["k"]["type"~R]` selects a subset
    of `relation["type"~R]` over the same bbox, for every `k`. So nothing that
    used to arrive can go missing.
  - **`dropUnselectedRelations` removes the surplus before parsing**, so the
    element set reaching the index is exactly the old one. Verified live at
    production resolution on 2026-09-20: the new query returned 32,278 elements,
    the filter dropped 18, and the result was identical to the old query's
    32,260 elements — **0 missing, 0 extra**, compared by element id.
  - **Why filter rather than keep the extra relations.** They are areal, so
    `buildFeatureIndex` would accept them. Whether any could move a score is an
    empirical question about the rule table and **not** one set theory answers:
    an element arrives on any selected key and then brings _all_ its tags, so
    rules keyed on non-selected tags fire routinely on incidentally delivered
    elements. Filtering makes the question moot instead of guessing at it. If a
    differential later shows the extra relations are worth keeping, the filter
    call is the one line to delete.
  - **`OVERPASS_SCHEMA_VERSION` is deliberately NOT bumped**, which is the
    correct reading of the rule below rather than an exception to it: the
    delivered element set is unchanged, so previously cached tiles remain
    equivalent. Bumping would force every user to re-download identical data.
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
