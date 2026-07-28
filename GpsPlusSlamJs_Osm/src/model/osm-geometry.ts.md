# `model/osm-geometry.ts`

## Purpose

Converts an `OsmFeature` into a geometry, deciding in particular whether a
closed way bounds an **area** or is a **line that loops**.

## Public API

- `toGeometry(feature)` → `GeometryResult`, i.e.
  `{ ok: true, geometry }` or `{ ok: false, error }`. **Never throws.**
- `isAreaWay(way)` → boolean.
- `isArealRelation(relation)` → boolean.
- Geometry types: `PointGeometry`, `LineStringGeometry`, `PolygonGeometry`
  (`rings[0]` outer, rest holes), `MultiPolygonGeometry`.
- `GeometryError` — `{ reason, featureKey, message }` where `reason` is one of
  `degenerate-geometry`, `unclosable-ring`, `no-outer-ring`,
  `unsupported-relation-type`.

## Invariants & assumptions

- **Nothing throws.** A single bad element must degrade to "skipped and
  counted", never to a failed tile — the C# reference throws
  `NotImplementedException` for non-multipolygon relations and for unclosable
  rings, which is wrong for a library that runs against whatever the real planet
  contains.
- **Area detection uses the vendored `polygon-features.json`**, not the C#
  reference's `highway`-only rule. That table (27 entries, from
  `tyrasd/osm-polygon-features`, the same one osmtogeojson uses) is checked-in
  **data we own and version**, which is categorically different from taking a
  runtime dependency.
  - Precedence: not closed → line; `area=no` → line; `area=yes` → area;
    otherwise any tag whose key is in the table and whose value passes that
    key's whitelist/blacklist test.
  - It reproduces the C# oracle where that oracle is right: closed
    `highway=footway` (way 449879297) is still a LineString, because `highway`
    is a whitelist of `services`/`rest_area`/`escape`/`elevator`.
  - It fixes the two cases the C# rule got wrong: closed `barrier=fence` and
    closed `natural=coastline` are **not** areas.
- **An untagged closed way is not an area.** Nothing about it claims to bound
  anything.
- **`type=boundary` is areal too.** The C# `IsMultiPolygon` recognised only the
  literal `multipolygon`; boundaries use the identical outer/inner structure.
- **Holes are best-effort.** An unclosable _inner_ ring is dropped and the
  polygon is still returned — a building with a missing courtyard beats no
  building. An unclosable _outer_ ring fails the whole feature.
- **Members with `null` positions are skipped whole, not truncated.** Overpass
  emits `null` for positions outside the queried bbox; a half-materialised way
  stitches into a ring that closes in the wrong place, which is a worse failure
  than a missing feature.

## Examples

```ts
const result = toGeometry(feature);
if (!result.ok) {
  diagnostics.count(result.error.reason, result.error.featureKey);
} else if (result.geometry.kind === "polygon") {
  coverCells(result.geometry.rings);
}
```

## Tests

- `osm-geometry.test.ts` — the rule table case by case, including the
  way-449879297 rule, the two C# mis-classifications, `area=yes`/`area=no`
  overrides, split and reversed multipolygon rings, multiple outers **with**
  holes (which C# throws on), and all four typed-error paths.
- `osm-geometry.differential.test.ts` — 18 tag combinations plus three
  multipolygon shapes compared against `osmtogeojson`. **Note:** `osmtogeojson`
  mutates the payload it is given (it rewrites `member.ref` to `"_fullGeom<id>"`),
  so the harness deep-clones before calling it. That mutation cost an hour of
  false debugging and is now documented in both the test and the findings doc.
- `multipolygon-builder.property.test.ts` — the ring algebra.
