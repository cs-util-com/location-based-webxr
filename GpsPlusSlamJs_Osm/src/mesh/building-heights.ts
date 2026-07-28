/**
 * Simple 3D Buildings (S3DB) height resolution.
 *
 * WHY THIS IS ITS OWN FILE. The geometry of a building is easy; deciding how
 * TALL it is, and which part of it starts where, is where OSM's real messiness
 * lives. OSM2World devotes a 446-line class (`LevelAndHeightData.java`) to it.
 * Separating it means the extruder is pure geometry and every tagging quirk has
 * one place to live and one place to be tested.
 *
 * THE INSIGHT THAT MAKES S3DB WORTH SUPPORTING AT ALL: landmark detail is FREE
 * if you honour `building:part` and `min_height`. Cologne Cathedral is not a
 * model file and not a special case — it is many `building:part` polygons, each
 * with its own height and `min_height`. A naive one-polygon extrusion gives a
 * box; the same extruder applied per part gives something recognisably
 * cathedral-shaped, with no landmark database anywhere. That is why
 * `building:part` support is first in the plan's ordering (§8, 24 % of buildings
 * in the census) rather than an advanced feature.
 *
 * @see building-heights.ts.md
 */

import type { OsmFeature, OsmTags } from "../model/osm-feature.js";

/** Metres per level when only `building:levels` is mapped. */
export const DEFAULT_LEVEL_HEIGHT_M = 3;

/** Used when nothing at all says how tall a building is. */
export const DEFAULT_BUILDING_HEIGHT_M = 6;

export interface BuildingHeights {
  /** Height of the eaves above ground: where the walls stop and the roof starts. */
  readonly eaveHeightM: number;
  /** Total height including the roof. */
  readonly totalHeightM: number;
  /** Where the walls START. Non-zero for an upper `building:part`. */
  readonly minHeightM: number;
  /** `roof:shape`, normalised; `flat` when absent or unrecognised. */
  readonly roofShape: RoofShape;
  /** True when no tag gave a height and the default was used. */
  readonly heightIsGuessed: boolean;
}

/**
 * Roof shapes this package can generate.
 *
 * A deliberate subset of OSM2World's 26. The ordering in the plan (§8) is by
 * quality-per-effort: flat first, then the cheap parametric shapes, and only
 * then the ones needing a straight skeleton. `gabled` and `hipped` are here
 * because they are common; see `roof.ts` for exactly how far their support goes
 * and where it stops.
 */
export type RoofShape =
  | "flat"
  | "pyramidal"
  | "skillion"
  | "gabled"
  | "hipped"
  | "dome";

const KNOWN_SHAPES = new Set<RoofShape>([
  "flat",
  "pyramidal",
  "skillion",
  "gabled",
  "hipped",
  "dome",
]);

/**
 * Parses an OSM length: metres by default, feet when suffixed.
 *
 * OSM allows `12`, `12 m`, `12m` and `40'` (feet), and real data contains all
 * of them plus junk. Junk returns `undefined` rather than `0` — a building of
 * height zero is invisible, which reads as "not mapped" instead of "bad tag".
 */
export function parseLengthMetres(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();

  const feet = /^(-?\d+(?:\.\d+)?)\s*'?\s*$/.exec(text);
  if (text.endsWith("'") && feet?.[1] !== undefined) {
    return Number(feet[1]) * 0.3048;
  }

  const metres = /^(-?\d+(?:\.\d+)?)\s*m?$/i.exec(text);
  if (metres?.[1] === undefined) return undefined;
  const value = Number(metres[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Parses a level count, which OSM sometimes writes as a decimal. */
function parseLevels(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

function normaliseRoofShape(raw: string | undefined): RoofShape {
  if (raw === undefined) return "flat";
  const shape = raw.trim().toLowerCase();
  // `half-hipped`, `round`, `gambrel`, `mansard`, `onion`, `saltbox`… all fall
  // back to flat rather than to a wrong shape. A flat extrusion of the right
  // footprint at the right height is a much smaller error than a confidently
  // wrong roof, and at walking distance a roof is barely visible anyway (§8.4).
  return KNOWN_SHAPES.has(shape as RoofShape) ? (shape as RoofShape) : "flat";
}

/**
 * Resolves the heights of one building or building part.
 *
 * Precedence, highest first — this is the order S3DB specifies and the order
 * mappers expect:
 *
 * 1. `height` — the total, including the roof.
 * 2. `building:levels` × 3 m, plus `roof:height` if present.
 * 3. A default, flagged as guessed.
 *
 * `min_height` (or `building:min_level` × 3 m) is where the walls START, and it
 * is what makes `building:part` produce real shapes rather than a pile of boxes
 * all standing on the ground.
 */
export function resolveHeights(tags: OsmTags): BuildingHeights {
  const roofShape = normaliseRoofShape(tags["roof:shape"]);

  const minHeightM =
    parseLengthMetres(tags["min_height"]) ??
    (parseLevels(tags["building:min_level"]) ?? 0) * DEFAULT_LEVEL_HEIGHT_M;

  const roofHeightM =
    parseLengthMetres(tags["roof:height"]) ??
    (parseLevels(tags["roof:levels"]) ?? 0) * DEFAULT_LEVEL_HEIGHT_M;

  const tagged = parseLengthMetres(tags["height"]);
  const levels = parseLevels(tags["building:levels"]);

  let totalHeightM: number;
  let heightIsGuessed = false;

  if (tagged !== undefined && tagged > 0) {
    totalHeightM = tagged;
  } else if (levels !== undefined && levels > 0) {
    totalHeightM = levels * DEFAULT_LEVEL_HEIGHT_M + roofHeightM;
  } else {
    totalHeightM = DEFAULT_BUILDING_HEIGHT_M + roofHeightM;
    heightIsGuessed = true;
  }

  // A roof cannot be taller than the building. Clamping rather than trusting
  // keeps a mistyped `roof:height=30` on a 10 m house from producing a spike
  // through the sky, which is the most visible bad-data artefact in practice.
  const eaveHeightM = Math.max(
    minHeightM,
    totalHeightM - Math.min(roofHeightM, totalHeightM - minHeightM),
  );

  return {
    minHeightM: Math.max(0, minHeightM),
    eaveHeightM: Math.max(minHeightM, eaveHeightM),
    totalHeightM: Math.max(minHeightM, totalHeightM),
    roofShape,
    heightIsGuessed,
  };
}

/** True when a feature is a building outline. */
export function isBuilding(feature: OsmFeature): boolean {
  const value = feature.tags["building"];
  return value !== undefined && value !== "no";
}

/** True when a feature is a `building:part` volume. */
export function isBuildingPart(feature: OsmFeature): boolean {
  const value = feature.tags["building:part"];
  return value !== undefined && value !== "no";
}
