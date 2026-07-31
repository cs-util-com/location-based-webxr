/**
 * POI markers, as placement data (W12).
 *
 * WHAT THIS IS FOR. The demo's core affordance is "click a thing and it tells you
 * what it is", and until now the only clickable thing was an affordance cell — an
 * abstraction over the data rather than an object in it. A POI marker is the
 * first feature a user can point at and be told about directly.
 *
 * NO GEOMETRY HERE, for the same reason as `trees.ts`: markers are numerous and
 * identical up to a transform, so they are what `InstancedMesh` exists for, and
 * emitting placements keeps this package free of `three` (plan §4.2). The
 * consumer decides what a marker looks like.
 *
 * NO PER-TYPE ICONS, deliberately. The testing notes asked to see *that*
 * something is there and be able to ask what it is; they did not ask for a
 * playground pictogram. An icon set is a large amount of art and a taxonomy
 * decision, and it can be added later behind this same placement type.
 *
 * WHAT IT MUST NOT DRAW. Every builder in this package has to answer "who owns
 * this feature", and two of them got it wrong on the first attempt. Trees belong
 * to `trees.ts`; areas belong to `plates.ts` and to W14. So this selects on
 * **node-ness as well as tags** — `amenity=parking` is overwhelmingly a way, and
 * selecting on the tag alone would put a marker in the middle of every car park
 * in the tile.
 *
 * @see poi.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { featureKey, type OsmFeatureKey } from "../model/osm-feature.js";
import type { EnuFrame, EnuPoint } from "./enu.js";

/**
 * The tag keys that make a node a place worth marking, in PRECEDENCE ORDER.
 *
 * The order is load-bearing, not cosmetic. A node can carry several of these at
 * once (`amenity=cafe` + `tourism=information` is ordinary), and object key order
 * in JS is insertion order — so "the first key on the object" would make the
 * answer depend on how the Overpass JSON happened to be written, and the same
 * node could report different kinds on two runs. Fixing the order here makes it
 * a property of the data rather than of its serialisation.
 *
 * Deliberately NOT "every tagged node". A `barrier=gate` or a routing node is
 * not something a user points at to ask what it is, and marking everything would
 * bury the ones that are.
 */
export const POI_KEYS = [
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "historic",
  "healthcare",
  "office",
  "craft",
  "emergency",
] as const;

export interface PoiMarker {
  readonly feature: OsmFeatureKey;
  /** Metres east/north of the frame origin. */
  readonly position: EnuPoint;
  /** Ground height at the marker, metres. */
  readonly groundHeightM: number;
  /** `key=value` of the primary tag, e.g. `amenity=cafe`. */
  readonly kind: string;
  /** A short human label: the `name` tag, else the primary tag's value. */
  readonly label: string;
}

export interface BuildPoiOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
}

/**
 * The primary tag as `key=value`, or `undefined` when nothing qualifies.
 *
 * Exported because the details panel needs the same answer the marker was built
 * from — deriving it twice from the tags is how the label on screen and the
 * label in the panel drift apart.
 */
export function poiKind(tags: Record<string, string>): string | undefined {
  for (const key of POI_KEYS) {
    const value = tags[key];
    if (value !== undefined && value !== "" && value !== "no") {
      return `${key}=${value}`;
    }
  }
  return undefined;
}

/** Whether a feature is a node this builder owns. */
export function isPoiNode(feature: OsmFeature): boolean {
  if (feature.type !== "node") return false;
  const tags = feature.tags as Record<string, string> | undefined;
  if (tags === undefined) return false;
  // Trees are `trees.ts`'s. Drawn twice, a tree is a cone with a marker inside
  // it — and the marker wins the pick, so the user clicks a tree and is told
  // about a tree-shaped POI.
  if (tags["natural"] === "tree") return false;
  return poiKind(tags) !== undefined;
}

/** Markers for every qualifying node in `features`, in input order. */
export function buildPoiMarkers(
  features: Iterable<OsmFeature>,
  options: BuildPoiOptions,
): PoiMarker[] {
  const markers: PoiMarker[] = [];

  for (const feature of features) {
    if (!isPoiNode(feature) || feature.type !== "node") continue;
    const tags = feature.tags as Record<string, string>;
    const kind = poiKind(tags);
    // Cannot happen after `isPoiNode`, but narrowing it here keeps the marker's
    // `kind` a plain `string` rather than pushing an optional through to every
    // consumer of the placement.
    if (kind === undefined) continue;

    markers.push({
      feature: featureKey(feature),
      position: options.frame.toEnu(feature.position),
      // Not NaN when unsampled: NaN propagates into the instance transform and
      // removes the object from the scene with nothing reported.
      groundHeightM: options.groundHeightM?.(feature.position) ?? 0,
      kind,
      // The VALUE rather than the whole `key=value` — a marker labelled
      // "amenity=cafe" reads as debug output rather than as a place.
      label: tags["name"] ?? kind.slice(kind.indexOf("=") + 1),
    });
  }

  return markers;
}
