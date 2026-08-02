/**
 * Tall structures that are not tagged as buildings — F34, §5.
 *
 * THE CASE THAT NAMED THIS FILE. Cologne Cathedral has two 157 m towers and only
 * one of them draws:
 *
 * - `way/645732604` "Nordturm" — `building=tower` **and** `man_made=tower`.
 * - `way/645732603` "Südturm" — `man_made=tower` **only**.
 *
 * `isBuilding` keys off `building`, so one is extruded and one is not. A
 * cathedral with a single tower reads as a failed fetch rather than as a tagging
 * distinction, and the general case — chimneys, masts, silos, storage tanks,
 * water towers — is the same gap at smaller scale.
 *
 * **THIS IS NOT A PORT, AND THAT IS WORTH KNOWING BEFORE TRUSTING IT.** §5.2 of
 * the round-6 plan read streets-gl in full: its `OSMAreaQualifierFactory` has no
 * `man_made` branch, so its Südturm is missing too. Nothing external supplies
 * the tag list or the height conventions here — which is why the list is short
 * and closed, and why most of the tests are about what must NOT be drawn.
 *
 * TWO EXCLUSIONS DO THE REAL WORK, and both prevent a DOUBLE draw rather than a
 * wrong one:
 *
 * - Anything `isBuilding` already claims. Otherwise the Nordturm is extruded
 *   twice in the same place, which is invisible until it z-fights.
 * - Anything that is a `building:part`. The five `Südturm (Sockel)` parts reach
 *   70.95 m and belong to the part path.
 *
 * @see tall-structures.ts.md
 */

import type { OsmFeature } from "../model/osm-feature.js";
import {
  isBuilding,
  isBuildingPart,
  parseLengthMetres,
} from "./building-heights.js";

/**
 * `man_made` values worth extruding as a volume.
 *
 * DELIBERATELY SHORT AND CLOSED. `man_made` is one of OSM's broadest keys: the
 * Cologne fixture alone carries 36 `man_made=surveillance`, plus `column`,
 * `street_cabinet`, `pipeline`, `water_well` and a bare `yes`. A permissive rule
 * would fill the street with furniture-sized boxes, which reads as a data bug
 * rather than as a feature — so a value not on this list draws NOTHING, and
 * never falls back to a default height.
 *
 * Every entry is something that is genuinely a tall vertical volume and that a
 * viewer would notice the absence of.
 */
export const TALL_STRUCTURE_KINDS: ReadonlySet<string> = new Set([
  "tower",
  "chimney",
  "mast",
  "silo",
  "storage_tank",
  "water_tower",
  "communications_tower",
  "cooling_tower",
  "gasometer",
]);

/**
 * True when a feature is a tall structure this module should extrude.
 *
 * AREAS ONLY. A node belongs to `poi.ts`, and two builders drawing the same
 * feature is the mistake every builder in this package has had to get right.
 */
export function isTallStructure(feature: OsmFeature): boolean {
  if (feature.type === "node") return false;
  // Already someone else's. See the header — both of these prevent a DOUBLE
  // draw, which is the failure mode that hides.
  if (isBuilding(feature) || isBuildingPart(feature)) return false;
  if (feature.tags["location"] === "underground") return false;
  const kind = feature.tags["man_made"];
  return kind !== undefined && TALL_STRUCTURE_KINDS.has(kind);
}

/**
 * How tall the structure is, or `undefined` when nothing says.
 *
 * NO DEFAULT, AND THAT IS THE OPPOSITE OF `building-heights.ts`. A building with
 * no height tag is still a building and `DEFAULT_BUILDING_HEIGHT_M` is a
 * reasonable stand-in — the error is a couple of metres. A `man_made=tower` with
 * no height could be a 5 m viewing platform or a 300 m transmitter, so a guess
 * at that scale is a landmark-sized lie in a view whose whole job is being
 * checked by eye. Drawing nothing is the honest failure.
 *
 * `parseLengthMetres` rather than `Number`, because `height=157 m` and
 * `height=40'` are both ordinary and `Number` returns NaN for both.
 */
export function tallStructureHeightM(feature: OsmFeature): number | undefined {
  const height = parseLengthMetres(feature.tags["height"]);
  if (height === undefined || !(height > 0)) return undefined;
  return height;
}
