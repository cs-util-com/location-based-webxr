# `model/osm-feature.ts`

## Purpose

The typed OSM domain model: a **raw element graph**, not GeoJSON.

## Public API

- `LatLng` — `{ lat, lng }`. Note `lng`, matching the app framework's `GpsCoord`
  and h3-js, **not** the core library's `LatLong.longitude` (plan §4.5).
- `OsmTags` — `Readonly<Record<string, string>>`, raw and unnormalised.
- `OsmNode` / `OsmWay` / `OsmRelation` / `OsmRelationMember`.
- `OsmFeature` — the discriminated union over `type`.
- `OsmFeatureKey` — `` `${type}/${id}` ``.
- `featureKey(feature)` → `OsmFeatureKey`.
- `getOsmDebugUrl(type, id)` → openstreetmap.org permalink.
- `isClosedWay(way)` → boolean.
- `positionsEqual(a, b)` → boolean (exact).
- `sameFeatureContent(a, b)` → boolean. Same tags and same geometry, comparing
  CONTENT only - identity is assumed already settled by `featureKey`.

## Invariants & assumptions

- **`sameFeatureContent` exists because "the same feature" arrives as different
  objects.** Fetch tiles are H3 cells' bounding RECTANGLES, so adjacent tiles
  overlap; `out geom` returns a feature's whole geometry whenever its bbox is
  touched; and the parser builds a fresh object per delivery. `AffordanceIndex`
  compared held against incoming with `!==` on BOTH its merge paths, so every
  re-delivered duplicate near a seam looked like an edit and threw away its
  converted geometry - breaking that class's own promise that conversion happens
  once per feature ever.
  - **It compares content, never identity.** Two features reaching it have
    already matched on `featureKey` (type plus id). Comparing those again would
    be redundant; comparing them INSTEAD is what makes an edited feature look
    unchanged.
  - **Exact coordinates, for `positionsEqual`'s reason.** Overpass emits the
    same node's coordinates identically wherever it appears, which is what makes
    re-delivery detectable at all; an epsilon would also call a genuinely moved
    node unchanged.
  - **The bias is towards "changed".** Anything it cannot prove identical is
    reported different, so the caller re-converts. A needless re-conversion
    costs microseconds; a missed one draws the old shape forever.

- **Everything here is structured-cloneable.** Plain objects and arrays only —
  no class instances, no methods, no closures, no `Map`/`Set` on the wire. These
  values cross a Web Worker boundary in the consumer's bridge (plan §4.2), where
  a class instance would silently lose its methods or fail to post.
- **Raw tags, never normalised.** The scoring rules key on the long tail
  (`surface=sand`, `wheelchair=yes`), so lowercasing or trimming here would
  break exact matches. Also why we keep the element graph instead of converting
  to GeoJSON: GeoJSON flattens the outline↔`building:part` hierarchy that the
  later 3D work needs.
- **Identity is type-qualified.** OSM ids are unique only _within_ a type — node
  1, way 1 and relation 1 all exist. `featureKey` exists because the C#
  reference keyed its provenance map on the bare numeric id, which is a latent
  collision this port does not inherit.
- **`positionsEqual` is exact, not epsilon-based.** Overpass emits a shared
  node's coordinates identically wherever it appears, so ring stitching matches
  on identity. An epsilon would silently join ways that merely pass near each
  other, producing plausible-but-wrong rings.
- `isClosedWay` requires at least 4 positions: a ring needs 3 distinct corners
  plus the repeated closing position.

## Examples

```ts
import { featureKey, isClosedWay, getOsmDebugUrl } from "./osm-feature.js";

featureKey({ type: "way", id: 449879297, geometry: [], tags: {} });
// -> "way/449879297"

getOsmDebugUrl("way", 449879297);
// -> "https://www.openstreetmap.org/way/449879297"
```

## Tests

Exercised throughout `osm-geometry.test.ts`, `overpass-parser.test.ts` and
`multipolygon-builder.property.test.ts` rather than in a dedicated file — these
are type declarations plus four one-line predicates, and testing them in
isolation would restate the implementation rather than pin behaviour.
