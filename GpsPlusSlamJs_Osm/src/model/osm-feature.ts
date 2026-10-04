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

/**
 * Do two features carry the same CONTENT - the same tags and the same geometry?
 *
 * **WHY THIS IS NOT `a === b`, and why that mattered.** Fetch tiles are H3
 * cells' bounding RECTANGLES, so adjacent tiles overlap, and `out geom` returns
 * a feature's whole geometry whenever its bbox is touched. A feature near a
 * seam is therefore delivered by several tiles - the same feature, byte for
 * byte - and the parser builds a fresh object each time. An identity comparison
 * calls every one of those an edit.
 *
 * `AffordanceIndex` used one, and so discarded the converted geometry and the
 * cached bounds of every re-delivered feature. Converting geometry is the
 * expensive half of scoring, and that class's own header promises it happens
 * "once per feature ever, not once per chunk".
 *
 * **IDENTITY IS ASSUMED ALREADY SETTLED.** This compares content only: the
 * caller looks features up by {@link featureKey}, which is type plus id, so two
 * features reaching this function are already the same OSM element. Comparing
 * type and id again would be redundant, and comparing them INSTEAD would be
 * wrong - it is exactly what makes an edited feature look unchanged.
 *
 * **EXACT COORDINATE COMPARISON, for the reason {@link positionsEqual} gives:**
 * Overpass emits the same node's coordinates identically wherever it appears,
 * so exactness is what makes re-delivery detectable at all. An epsilon would
 * additionally call a genuinely moved node unchanged.
 *
 * **THE BIAS IS TOWARDS "CHANGED".** Anything this cannot prove identical - a
 * shape it does not recognise, a member list of a different length - is
 * reported as different, so the caller re-converts. A needless re-conversion
 * costs microseconds; a missed one draws the old shape forever.
 */
export function sameFeatureContent(a: OsmFeature, b: OsmFeature): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (!sameTags(a.tags, b.tags)) return false;
  if (a.type === "node") {
    return b.type === "node" && positionsEqual(a.position, b.position);
  }
  if (a.type === "way") {
    return b.type === "way" && samePositions(a.geometry, b.geometry);
  }
  return b.type === "relation" && sameMembers(a.members, b.members);
}

function sameTags(a: OsmTags, b: OsmTags): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    // `Object.hasOwn` as well as the value check: an explicit `undefined` and a
    // missing key are different tag sets and compare equal without it.
    if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false;
  }
  return true;
}

function samePositions(a: readonly LatLng[], b: readonly LatLng[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return false;
    if (!positionsEqual(left, right)) return false;
  }
  return true;
}

/**
 * One member's identity and inlined geometry.
 *
 * Split out of `sameMembers` because the loop body carried the whole
 * comparison and tripped the complexity limit. The split is also the honest
 * shape: the loop is "same length, same members in the same order", and this is
 * "same member".
 */
function sameMember(a: OsmRelationMember, b: OsmRelationMember): boolean {
  if (a.type !== b.type || a.ref !== b.ref || a.role !== b.role) return false;
  return (
    sameOptionalPositions(a.geometry, b.geometry) &&
    sameOptionalPosition(a.position, b.position)
  );
}

/** Both absent, or both present and equal. Present-vs-absent is a change. */
function sameOptionalPositions(
  a: readonly LatLng[] | undefined,
  b: readonly LatLng[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return samePositions(a, b);
}

/** Both absent, or both present and equal. */
function sameOptionalPosition(
  a: LatLng | undefined,
  b: LatLng | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return positionsEqual(a, b);
}

/**
 * ORDER MATTERS, and not only for tidiness: a ring reversed is the same set of
 * positions and a different geometry, and `multipolygon-builder` stitches on
 * endpoint order.
 */
function sameMembers(
  a: readonly OsmRelationMember[],
  b: readonly OsmRelationMember[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return false;
    if (!sameMember(left, right)) return false;
  }
  return true;
}
