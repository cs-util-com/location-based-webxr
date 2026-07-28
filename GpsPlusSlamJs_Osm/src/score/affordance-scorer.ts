/**
 * The multiplicative scoring kernel, ported from
 * `OsmHeatMapsManager.CalcHeatFor`.
 *
 * The whole engine is ~20 lines of arithmetic, and that is the point: the
 * valuable part of the C# system is not the code but the **tuned values** and
 * the fact that its tests pin exact expected products (a beach cell at
 * 5 × 7 = 35, a tile at 105). That makes this port *verifiable* rather than
 * merely plausible, which is why the model was kept over a bounded [0,1]
 * redesign.
 *
 * The engine is **category-agnostic**: it multiplies whatever numbers the rule
 * table declares under whatever category names the table declares. The game
 * vocabulary is just one possible table.
 *
 * @see affordance-scorer.ts.md
 */

import type { OsmFeature, OsmFeatureKey } from "../model/osm-feature.js";
import { toRuleKey } from "../model/osm-tags.js";
import type { RuleTable } from "../rules/rule-table.js";
import { ruleValue } from "../rules/rule-table.js";
import { isIgnoredTagKey } from "../rules/ignored-tags.js";
import type { H3FeatureIndex } from "../spatial/h3-feature-index.js";

/**
 * One cell's score in one category, with the evidence behind it.
 *
 * `contributors` is a plain `Record`, **not a `Map`** — the scored chunk is
 * cached through the string-valued `OsmBlobStore`, and a `Map` JSON-serialises
 * to `{}` silently, which would read as "this score has no explanation" rather
 * than as a bug.
 */
export interface CellScore {
  readonly cell: string;
  /** category → score. Unbounded; see the warning in the sidecar. */
  readonly scores: Readonly<Record<string, number>>;
  /** category → (feature key → the factor that feature contributed). */
  readonly contributors: Readonly<
    Record<string, Readonly<Record<OsmFeatureKey, number>>>
  >;
}

export interface ScoreOptions {
  /** Score only these categories. Defaults to every category in the table. */
  readonly categories?: readonly string[];
  /**
   * Collect unmapped tag counts.
   *
   * Off by default because it costs a map write per unmatched tag in the hot
   * loop, and it is a tuning aid rather than a runtime need.
   */
  readonly collectUnmapped?: boolean;
}

export interface ScoreResult {
  readonly cells: readonly CellScore[];
  /**
   * Tags seen that the table does not score, filtered through the ignore list.
   *
   * How the rule table gets improved over time. Empty unless
   * `collectUnmapped` is set.
   */
  readonly unmappedTagCounts: Readonly<Record<string, number>>;
  /** Rule lookups performed. Exposed so the short-circuit can be ASSERTED. */
  readonly lookups: number;
}

/**
 * Scores one feature against one category.
 *
 * The kernel. Starts at the multiplicative identity `1`, multiplies in every
 * matching tag's value, and **returns immediately on `0`** — a hard veto can
 * never recover, so continuing would be wasted work with an identical result.
 *
 * A feature with no tags, or no tags the table knows, scores exactly `1`: it
 * contributes nothing rather than vetoing.
 */
export function scoreFeature(
  feature: OsmFeature,
  category: string,
  table: RuleTable,
  counters?: { lookups: number },
): number {
  let heat = 1;
  for (const [key, value] of Object.entries(feature.tags)) {
    if (counters !== undefined) counters.lookups++;
    heat *= ruleValue(table, toRuleKey(key, value), category);
    // Short-circuit. `0` is absorbing, so the answer cannot change.
    if (heat === 0) return 0;
  }
  return heat;
}

/**
 * Scores every cell in the index.
 *
 * `heat(cell, category) = Π over features touching the cell ( Π over that
 * feature's tags ( ruleValue[tag][category] ) )`.
 *
 * Order-independent by construction: multiplication is commutative, and the
 * short-circuit only skips work whose result is already determined.
 */
export function scoreCells(
  index: H3FeatureIndex,
  table: RuleTable,
  options: ScoreOptions = {},
): ScoreResult {
  const categories = options.categories ?? table.categories;
  const counters = { lookups: 0 };
  const unmapped: Record<string, number> = {};
  const cells: CellScore[] = [];

  for (const [cell, entries] of index.byCell) {
    const scores: Record<string, number> = {};
    const contributors: Record<string, Record<OsmFeatureKey, number>> = {};

    for (const category of categories) {
      let total = 1;
      const perFeature: Record<OsmFeatureKey, number> = {};

      for (const entry of entries) {
        const feature = index.features.get(entry.feature);
        if (feature === undefined) continue;
        const factor = scoreFeature(feature, category, table, counters);
        // Recorded even when it is 1: "this feature touched the cell and said
        // nothing" is different information from "this feature was not here",
        // and the debugging value of the provenance map is the whole reason the
        // C# reference kept one.
        perFeature[entry.feature] = factor;
        total *= factor;
      }

      scores[category] = total;
      contributors[category] = perFeature;
    }

    cells.push({ cell, scores, contributors });
  }

  if (options.collectUnmapped === true) {
    countUnmapped(index, table, unmapped);
  }

  return { cells, unmappedTagCounts: unmapped, lookups: counters.lookups };
}

/**
 * Counts tags the table does not score, minus the known-irrelevant ones.
 *
 * Counted per FEATURE, not per (feature, cell): a building covering 200 cells
 * would otherwise report its `addr:city` two hundred times and drown the signal
 * this diagnostic exists to provide.
 */
function countUnmapped(
  index: H3FeatureIndex,
  table: RuleTable,
  into: Record<string, number>,
): void {
  for (const feature of index.features.values()) {
    for (const [key, value] of Object.entries(feature.tags)) {
      if (table.rules[toRuleKey(key, value)] !== undefined) continue;
      if (isIgnoredTagKey(key)) continue;
      into[key] = (into[key] ?? 0) + 1;
    }
  }
}

/**
 * The cells whose score in `category` is above the table's threshold.
 *
 * Strictly above, matching the C# reference. The default threshold is `1`, so
 * "above" means "at least one rule said something positive here" — a cell that
 * merely scores the identity is not a region.
 */
export function cellsAboveThreshold(
  result: ScoreResult,
  category: string,
  threshold: number,
): string[] {
  return result.cells
    .filter((cell) => (cell.scores[category] ?? 1) > threshold)
    .map((cell) => cell.cell);
}

/**
 * Link to an element on openstreetmap.org, from a provenance key.
 *
 * A thin adapter over `model/osm-feature.ts`'s `getOsmDebugUrl(type, id)`,
 * which takes the pieces rather than the composed key. Provenance is keyed by
 * `type/id`, so this is the form a caller reading `contributors` actually has —
 * and the point of the provenance map is that a surprising score can be traced
 * to a real object in ONE click. A helper that needed the key split first would
 * mean nobody clicks.
 */
export function debugUrlForKey(featureKey: OsmFeatureKey): string {
  return `https://www.openstreetmap.org/${featureKey}`;
}
