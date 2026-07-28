/**
 * Model module — the typed OSM domain model and geometry conversion.
 * Pure, no I/O.
 */

export type {
  LatLng,
  OsmTags,
  OsmElementType,
  OsmNode,
  OsmWay,
  OsmRelation,
  OsmRelationMember,
  OsmFeature,
  OsmFeatureKey,
} from "./osm-feature.js";
export {
  featureKey,
  getOsmDebugUrl,
  isClosedWay,
  positionsEqual,
} from "./osm-feature.js";

export {
  RULE_KEY_SEPARATOR,
  toRuleKey,
  toRuleKeys,
  splitRuleKeyForDiagnostics,
} from "./osm-tags.js";

export type {
  PointGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  PolygonGeometry,
  MultiPolygonGeometry,
  OsmGeometry,
  GeometryError,
  GeometryErrorReason,
  GeometryResult,
} from "./osm-geometry.js";
export { toGeometry, isAreaWay, isArealRelation } from "./osm-geometry.js";

export type { Ring, StitchResult } from "./multipolygon-builder.js";
export {
  stitchRings,
  isClosedRing,
  isPointInRing,
  groupRingsIntoPolygons,
  signedRingArea,
} from "./multipolygon-builder.js";

export type { ParseResult, SkippedElement } from "./overpass-parser.js";
export { parseOverpassJson } from "./overpass-parser.js";
