/**
 * The typed OSM domain model.
 *
 * Deliberately a **raw element graph**, not GeoJSON. The scoring engine keys on
 * the long tail of raw tags (`surface=sand`, `wheelchair=yes`) and the future 3D
 * pipeline needs the Simple 3D Buildings outline↔part hierarchy, both of which
 * GeoJSON flattens away.
 *
 * Every type here is **structured-cloneable**: plain objects and arrays only, no
 * class instances, no methods, no closures. This is a hard constraint — these
 * values cross a Web Worker boundary in the consumer's bridge (plan §4.2).
 *
 * @see osm-feature.ts.md
 */

/**
 * A WGS84 position.
 *
 * `lng`, not `longitude`: this package matches the app framework's `GpsCoord`
 * and h3-js, rather than the core library's `LatLong`. Adapters are explicit
 * rather than overloading the field name (plan §4.5).
 */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Raw OSM tags exactly as mapped — never normalised, never bucketed. */
export type OsmTags = Readonly<Record<string, string>>;

/** OSM element kinds, matching Overpass's `type` field. */
export type OsmElementType = "node" | "way" | "relation";

export interface OsmNode {
  readonly type: "node";
  readonly id: number;
  readonly position: LatLng;
  readonly tags: OsmTags;
}

export interface OsmWay {
  readonly type: "way";
  readonly id: number;
  /**
   * Inline geometry from Overpass `out geom`. Never node references — resolving
   * those client-side is the fragile step the C# reference's `.ToComplete()`
   * did, and the whole point of `out geom` is to avoid it.
   */
  readonly geometry: readonly LatLng[];
  readonly tags: OsmTags;
}

/** One member of a relation, with its geometry already inlined by `out geom`. */
export interface OsmRelationMember {
  readonly type: OsmElementType;
  readonly ref: number;
  /** `outer`, `inner`, `part`, or `''` — never normalised away. */
  readonly role: string;
  /** Present for way members under `out geom`. */
  readonly geometry?: readonly LatLng[];
  /** Present for node members. */
  readonly position?: LatLng;
}

export interface OsmRelation {
  readonly type: "relation";
  readonly id: number;
  readonly members: readonly OsmRelationMember[];
  readonly tags: OsmTags;
}

/** Discriminated union over `type`. */
export type OsmFeature = OsmNode | OsmWay | OsmRelation;

/** Stable, type-qualified identity. OSM ids are only unique *within* a type. */
export type OsmFeatureKey = `${OsmElementType}/${number}`;

/**
 * The identity used as a map key everywhere in this package.
 *
 * A bare numeric id is NOT unique — node 1, way 1 and relation 1 all exist. The
 * C# reference used bare ids in its provenance map, which is a latent collision
 * this package does not inherit.
 */
export function featureKey(feature: OsmFeature): OsmFeatureKey {
  return `${feature.type}/${feature.id}`;
}

/**
 * Link to the element on openstreetmap.org, so any surprising score can be
 * traced to a real object in one click. Ported from
 * `OsmExtensions.GetOsmDebugUrl`, which only handled nodes.
 */
export function getOsmDebugUrl(type: OsmElementType, id: number): string {
  return `https://www.openstreetmap.org/${type}/${id}`;
}

/** True when a way's first and last positions coincide. */
export function isClosedWay(way: OsmWay): boolean {
  const { geometry } = way;
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  if (geometry.length < 4 || first === undefined || last === undefined) {
    // A ring needs at least 3 distinct corners plus the repeated closing
    // position. Anything shorter cannot bound an area.
    return false;
  }
  return positionsEqual(first, last);
}

/**
 * Exact coordinate equality.
 *
 * Deliberately exact, not epsilon-based: Overpass emits the *same* node's
 * coordinates identically wherever it appears, so ring stitching matches on
 * identity. An epsilon here would silently join ways that merely pass close to
 * each other, producing plausible-but-wrong rings.
 */
export function positionsEqual(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}
