/**
 * Overpass JSON (`out geom`) → the typed OSM feature model.
 *
 * This is the package's outermost trust boundary: everything upstream of it is
 * a network response from a server we do not control. The plan's defensive
 * requirement is absolute — **a single bad element degrades to "skipped and
 * counted", never to a failed tile** — so nothing in this module throws on
 * malformed input, and every rejection names the offending element.
 *
 * @see overpass-parser.ts.md
 */

import type {
  LatLng,
  OsmFeature,
  OsmRelationMember,
  OsmTags,
} from "./osm-feature.js";

/** Why one element was dropped. */
export interface SkippedElement {
  /** `type/id` where both are known, else a best-effort description. */
  readonly featureKey: string;
  readonly reason: string;
}

export interface ParseResult {
  readonly features: readonly OsmFeature[];
  readonly skipped: readonly SkippedElement[];
  /** Overpass's own copyright string, when present — surfaced for attribution. */
  readonly copyright?: string;
  /** `osm3s.timestamp_osm_base`: how fresh the underlying planet data is. */
  readonly osmBaseTimestamp?: string;
}

/**
 * Parses an Overpass JSON payload.
 *
 * Accepts `unknown` deliberately: callers hand it `await response.json()`, and
 * pretending that value is already well-typed is exactly the assumption that
 * turns a bad gateway's HTML error page into a crash.
 */
export function parseOverpassJson(payload: unknown): ParseResult {
  const skipped: SkippedElement[] = [];

  if (!isRecord(payload)) {
    return {
      features: [],
      skipped: [
        { featureKey: "(payload)", reason: "payload is not an object" },
      ],
    };
  }

  const elements = payload["elements"];
  if (!Array.isArray(elements)) {
    return {
      features: [],
      skipped: [
        { featureKey: "(payload)", reason: "payload has no `elements` array" },
      ],
    };
  }

  const features: OsmFeature[] = [];
  for (let i = 0; i < elements.length; i++) {
    const parsed = parseElement(elements[i], i);
    if ("feature" in parsed) {
      features.push(parsed.feature);
    } else {
      skipped.push(parsed.skip);
    }
  }

  const osm3s = payload["osm3s"];
  const meta = isRecord(osm3s) ? osm3s : undefined;

  return {
    features,
    skipped,
    copyright: asString(meta?.["copyright"]),
    osmBaseTimestamp: asString(meta?.["timestamp_osm_base"]),
  };
}

type ElementOutcome =
  | { readonly feature: OsmFeature }
  | { readonly skip: SkippedElement };

function parseElement(raw: unknown, index: number): ElementOutcome {
  if (!isRecord(raw)) {
    return skip(`(element #${index})`, "element is not an object");
  }

  const type = raw["type"];
  const id = raw["id"];
  if (typeof type !== "string") {
    return skip(`(element #${index})`, "element has no string `type`");
  }
  if (typeof id !== "number" || !Number.isFinite(id)) {
    return skip(`${type}/(element #${index})`, "element has no numeric `id`");
  }
  const key = `${type}/${id}`;
  const tags = parseTags(raw["tags"]);

  switch (type) {
    case "node":
      return parseNode(raw, id, key, tags);
    case "way":
      return parseWay(raw, id, key, tags);
    case "relation":
      return parseRelation(raw, id, key, tags);
    default:
      return skip(key, `unknown element type "${type}"`);
  }
}

function parseNode(
  raw: Record<string, unknown>,
  id: number,
  key: string,
  tags: OsmTags,
): ElementOutcome {
  const position = toLatLng(raw["lat"], raw["lon"]);
  if (position === undefined) {
    return skip(key, "node has no valid lat/lon");
  }
  return { feature: { type: "node", id, position, tags } };
}

function parseWay(
  raw: Record<string, unknown>,
  id: number,
  key: string,
  tags: OsmTags,
): ElementOutcome {
  const geometry = parseGeometry(raw["geometry"]);
  if (geometry === undefined) {
    // Overpass only omits `geometry` when the query did not use `out geom`.
    // That is a query bug, not a data problem, so it is worth naming loudly in
    // the skip reason rather than silently producing an empty tile.
    return skip(
      key,
      "way has no usable `geometry` array (was the query built with `out geom`?)",
    );
  }
  if (geometry.length < 2) {
    return skip(key, `way geometry has only ${geometry.length} position(s)`);
  }
  return { feature: { type: "way", id, geometry, tags } };
}

function parseRelation(
  raw: Record<string, unknown>,
  id: number,
  key: string,
  tags: OsmTags,
): ElementOutcome {
  const rawMembers = raw["members"];
  if (!Array.isArray(rawMembers)) {
    return skip(key, "relation has no `members` array");
  }

  const members: OsmRelationMember[] = [];
  for (const rawMember of rawMembers) {
    const member = parseMember(rawMember);
    if (member !== undefined) {
      members.push(member);
    }
  }
  // A relation with zero usable members is kept, not skipped: its TAGS still
  // matter to diagnostics ("this multipolygon was unusable"), and geometry
  // conversion reports the real reason with a typed error.
  return { feature: { type: "relation", id, members, tags } };
}

function parseMember(raw: unknown): OsmRelationMember | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const type = raw["type"];
  const ref = raw["ref"];
  if (
    (type !== "node" && type !== "way" && type !== "relation") ||
    typeof ref !== "number"
  ) {
    return undefined;
  }
  const role = typeof raw["role"] === "string" ? raw["role"] : "";
  const geometry = parseGeometry(raw["geometry"]);
  const position = toLatLng(raw["lat"], raw["lon"]);

  return {
    type,
    ref,
    role,
    ...(geometry !== undefined ? { geometry } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

/**
 * Parses a `geometry` array.
 *
 * Overpass emits `null` entries for positions outside the queried bbox when a
 * way is clipped. Those are dropped, and a geometry that ends up with fewer
 * than 2 usable positions returns `undefined` rather than a stub — a partially
 * materialised way stitches into a ring that closes in the wrong place, which
 * is a far more damaging failure than a missing feature.
 */
function parseGeometry(raw: unknown): readonly LatLng[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const positions: LatLng[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const position = toLatLng(entry["lat"], entry["lon"]);
    if (position !== undefined) {
      positions.push(position);
    }
  }
  return positions.length >= 2 ? positions : undefined;
}

/** Overpass says `lon`; this package says `lng`. Converted exactly here. */
function toLatLng(lat: unknown, lon: unknown): LatLng | undefined {
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return undefined;
  }
  return { lat, lng: lon };
}

/** Non-string tag values are dropped, not coerced — a coerced tag is a fake. */
function parseTags(raw: unknown): OsmTags {
  if (!isRecord(raw)) {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      tags[key] = value;
    }
  }
  return tags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function skip(featureKey: string, reason: string): ElementOutcome {
  return { skip: { featureKey, reason } };
}
