/**
 * OSM element → geometry conversion.
 *
 * The rules here are ported from the C# reference's `OsmExtensions`, with one
 * deliberate upgrade: area detection uses osmtogeojson's `polygonFeatures`
 * table (vendored as `polygon-features.ts`) instead of the reference's
 * `highway`-only rule, which mis-classifies closed `barrier=fence` and
 * `natural=coastline`. The table still yields the reference's answer for the
 * case its oracle pins (closed `highway=footway` → LineString), so adopting it
 * is strictly a widening.
 *
 * Every entry point returns a result object rather than throwing. A single bad
 * element must degrade to "skipped and counted", never to a failed tile.
 *
 * @see osm-geometry.ts.md
 */

import type { LatLng, OsmFeature, OsmRelation, OsmWay } from "./osm-feature.js";
import { featureKey, isClosedWay } from "./osm-feature.js";
import type { Ring } from "./multipolygon-builder.js";
import { groupRingsIntoPolygons, stitchRings } from "./multipolygon-builder.js";
import type { PolygonFeatureRule } from "./polygon-features.js";
import { POLYGON_FEATURES } from "./polygon-features.js";

// ---------------------------------------------------------------------------
// Geometry types. Plain data, structured-cloneable (plan §4.2).
// ---------------------------------------------------------------------------

export interface PointGeometry {
  readonly kind: "point";
  readonly position: LatLng;
}
export interface LineStringGeometry {
  readonly kind: "linestring";
  readonly positions: readonly LatLng[];
}

/**
 * Several disconnected runs of one linear feature.
 *
 * `toGeometry` never produces this — an OSM way is one run — but CLIPPING does:
 * a way that crosses an area of interest, wanders off and comes back yields two
 * separate traversals. Joining them into a single linestring would fabricate a
 * segment between the last position of one run and the first of the next, and
 * that phantom chord then gets supercovered into cells the feature never
 * touched, INSIDE the area of interest where nothing filters them.
 *
 * So the kind exists to make "these parts are not connected" representable.
 * See `spatial/clip.ts`.
 */
export interface MultiLineStringGeometry {
  readonly kind: "multilinestring";
  readonly lines: readonly (readonly LatLng[])[];
}

export interface PolygonGeometry {
  readonly kind: "polygon";
  /** `rings[0]` is the outer ring; the rest are holes. */
  readonly rings: readonly Ring[];
}
export interface MultiPolygonGeometry {
  readonly kind: "multipolygon";
  /** Each entry is a polygon: outer ring first, then its holes. */
  readonly polygons: readonly (readonly Ring[])[];
}

export type OsmGeometry =
  | PointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

/** Why an element could not be converted. Exhaustive by design. */
export type GeometryErrorReason =
  | "degenerate-geometry"
  | "unclosable-ring"
  | "no-outer-ring"
  | "unsupported-relation-type";

export interface GeometryError {
  readonly reason: GeometryErrorReason;
  /** `type/id` of the offending element, so a human can go look at it. */
  readonly featureKey: string;
  readonly message: string;
}

export type GeometryResult =
  | { readonly ok: true; readonly geometry: OsmGeometry }
  | { readonly ok: false; readonly error: GeometryError };

// ---------------------------------------------------------------------------
// polygonFeatures — vendored area-detection table
// ---------------------------------------------------------------------------

const POLYGON_RULES: ReadonlyMap<string, PolygonFeatureRule> = new Map(
  POLYGON_FEATURES.map((rule) => [rule.key, rule]),
);

/**
 * Does a closed way bound an area?
 *
 * Order matters and mirrors osmtogeojson:
 *  1. not closed → never an area;
 *  2. explicit `area=no` → never an area (overrides everything);
 *  3. explicit `area=yes` → always an area;
 *  4. otherwise any tag whose key appears in the table and whose value passes
 *     that key's whitelist/blacklist test.
 *
 * An untagged closed way is NOT an area: nothing about it claims to bound
 * anything, and treating it as one would make every closed routing helper into
 * a scoreable surface.
 */
export function isAreaWay(way: OsmWay): boolean {
  if (!isClosedWay(way)) {
    return false;
  }
  const areaTag = way.tags["area"];
  if (areaTag === "no") {
    return false;
  }
  if (areaTag === "yes") {
    return true;
  }
  return Object.entries(way.tags).some(([key, value]) =>
    tagImpliesArea(key, value),
  );
}

/**
 * Does one tag, on its own, make a closed way areal?
 *
 * Split out of {@link isAreaWay} to keep both under the complexity ratchet, and
 * because this is the part that is purely a function of the vendored table —
 * the surrounding function is the `area=*` override policy.
 */
function tagImpliesArea(key: string, value: string): boolean {
  const rule = POLYGON_RULES.get(key);
  if (rule === undefined) {
    return false;
  }
  if (rule.polygon === "all") {
    return true;
  }
  const listed = rule.values?.includes(value) ?? false;
  return rule.polygon === "whitelist" ? listed : !listed;
}

/**
 * Relation types this package treats as areal.
 *
 * `type=boundary` is included because the C# reference's `IsMultiPolygon`
 * recognised only the literal `multipolygon`, which the plan flags as a gap:
 * boundaries use the identical outer/inner member structure.
 */
const AREAL_RELATION_TYPES: ReadonlySet<string> = new Set([
  "multipolygon",
  "boundary",
]);

export function isArealRelation(relation: OsmRelation): boolean {
  const type = relation.tags["type"];
  return type !== undefined && AREAL_RELATION_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export function toGeometry(feature: OsmFeature): GeometryResult {
  switch (feature.type) {
    case "node":
      return {
        ok: true,
        geometry: { kind: "point", position: feature.position },
      };
    case "way":
      return wayToGeometry(feature);
    case "relation":
      return relationToGeometry(feature);
  }
}

function wayToGeometry(way: OsmWay): GeometryResult {
  if (way.geometry.length < 2) {
    return fail(
      "degenerate-geometry",
      way,
      `way has ${way.geometry.length} position(s); at least 2 are needed`,
    );
  }
  if (isAreaWay(way)) {
    return { ok: true, geometry: { kind: "polygon", rings: [way.geometry] } };
  }
  return {
    ok: true,
    geometry: { kind: "linestring", positions: way.geometry },
  };
}

function relationToGeometry(relation: OsmRelation): GeometryResult {
  if (!isArealRelation(relation)) {
    // The C# reference throws NotImplementedException here (e.g. relation
    // 9816495, a route). A library must survive these: routes, turn
    // restrictions and public-transport relations are everywhere, and none of
    // them describe a surface worth scoring.
    return fail(
      "unsupported-relation-type",
      relation,
      `relation type "${relation.tags["type"] ?? "(none)"}" is not areal`,
    );
  }

  const outerSegments = memberGeometries(relation, "outer");
  const innerSegments = memberGeometries(relation, "inner");

  if (outerSegments.length === 0) {
    return fail(
      "no-outer-ring",
      relation,
      'relation has no way member with role "outer"',
    );
  }

  const outerStitch = stitchRings(outerSegments);
  if (!outerStitch.ok) {
    return fail(
      "unclosable-ring",
      relation,
      `could not close ${outerStitch.unclosed.length} outer chain(s)`,
    );
  }

  // Holes are best-effort: a relation with a broken inner ring still has a
  // usable outline, and dropping the hole is far better than dropping the
  // building. Unclosed inner chains are discarded, not escalated.
  const innerStitch = stitchRings(innerSegments);
  const innerRings = innerStitch.ok ? innerStitch.rings : [];

  const polygons = groupRingsIntoPolygons(outerStitch.rings, innerRings);

  if (polygons.length === 1) {
    return { ok: true, geometry: { kind: "polygon", rings: polygons[0]! } };
  }
  return { ok: true, geometry: { kind: "multipolygon", polygons } };
}

/**
 * Way-member geometries for one role.
 *
 * Members whose geometry Overpass could not inline (it emits `null` entries for
 * positions outside the queried bbox) are skipped rather than half-used: a ring
 * stitched from partial geometry closes at the wrong place, which is worse than
 * no ring at all.
 */
function memberGeometries(
  relation: OsmRelation,
  role: string,
): readonly (readonly LatLng[])[] {
  const result: (readonly LatLng[])[] = [];
  for (const member of relation.members) {
    if (member.type !== "way" || member.role !== role) {
      continue;
    }
    const geometry = member.geometry;
    if (geometry === undefined || geometry.length < 2) {
      continue;
    }
    if (geometry.some((p) => p === null || p === undefined)) {
      continue;
    }
    result.push(geometry);
  }
  return result;
}

function fail(
  reason: GeometryErrorReason,
  feature: OsmFeature,
  message: string,
): GeometryResult {
  return {
    ok: false,
    error: { reason, featureKey: featureKey(feature), message },
  };
}
