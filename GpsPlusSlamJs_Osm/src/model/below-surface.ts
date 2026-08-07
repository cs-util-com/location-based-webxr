/**
 * Is this feature under the ground being scored?
 *
 * WHY THIS EXISTS. The scorer computes `heat = Π over features ( Π over tags )`
 * and **`0` is absorbing** — `scoreFeature` returns immediately on it, because
 * "a hard veto can never recover". That is exactly right for a wall across a
 * path, and wrong for a car park two levels below a plaza: the scorer is 2D, a
 * cell is a column, and everything whose footprint covers it contributes
 * equally. So a way under the Domplatte makes the walkable surface above it
 * score as not walkable.
 *
 * **`layer` was never being read.** It appears in `ignored-tags.ts`, which looks
 * like the answer and is not: that list is explicitly *"diagnostic, not
 * functional — nothing here changes a score"*, existing only to keep
 * `unmappedTagCounts` a short list of real rule candidates. Every tag absent
 * from the rule table already contributes the identity, so `layer=-1` neither
 * vetoed nor protected. The feature's OTHER tags did the damage.
 *
 * THE RISK IN FIXING IT IS SYMMETRIC, and the exclusions below carry as much
 * weight as the inclusions: a predicate that is too eager deletes real walkable
 * ground, which is the same defect in the opposite direction and much harder to
 * spot — nothing looks broken, there is simply less map.
 *
 * @see below-surface.ts.md
 */

import type { OsmFeature } from "./osm-feature.js";

/**
 * `tunnel` values that put the way UNDER the surface.
 *
 * NOT `building_passage`, and that exclusion is the whole reason this is a value
 * set rather than a presence check on the key. A building passage is an arcade
 * or gateway THROUGH a building at ground level — walkable surface, and exactly
 * the kind of covered pedestrian route a walkability map exists to find.
 */
const SUBSURFACE_TUNNELS = new Set(["yes", "culvert"]);

/**
 * Parses a `layer` / `level` value, or `undefined` when it is not a number.
 *
 * DEFENSIVE BECAUSE OSM VALUES ARE FREE TEXT: `-1;0` (a way spanning two
 * layers), `−1` (U+2212, which `Number` rejects), empty strings and outright
 * junk all occur. Anything unparseable is left to the caller, which treats it as
 * surface — see the note there for why that direction is the safe one.
 */
function parseVerticalTag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * True when the feature is not on the walking surface, and so should contribute
 * nothing to a cell's score.
 *
 * **Skipped rather than clamped, and skipped for EVERY category**, because the
 * claim is about geometry rather than about walkability: "this is not on the
 * surface being scored" is category-independent, and expressing it as
 * per-category factors would let a future rule-table edit undo it.
 *
 * **`layer > 0` is deliberately NOT handled here.** A bridge deck and the ground
 * beneath it both score, so the demo shows one surface where there are two —
 * wrong, but benign next to a wrong veto, and fixing it means deciding which
 * surface wins. Filed as F59.
 */
export function isBelowSurface(feature: OsmFeature): boolean {
  const tags = feature.tags;

  // UNPARSEABLE MEANS SURFACE. Today everything scores as surface, so keeping
  // that behaviour on malformed data changes nothing; guessing "below" would
  // silently delete ground. And `-1;0` genuinely touches the surface, so for the
  // commonest malformed case surface is the correct answer, not just the safe
  // one.
  const layer = parseVerticalTag(tags["layer"]);
  if (layer !== undefined && layer < 0) return true;

  const level = parseVerticalTag(tags["level"]);
  if (level !== undefined && level < 0) return true;

  if (tags["location"] === "underground") return true;

  const tunnel = tags["tunnel"];
  if (tunnel !== undefined && SUBSURFACE_TUNNELS.has(tunnel)) return true;

  return false;
}
