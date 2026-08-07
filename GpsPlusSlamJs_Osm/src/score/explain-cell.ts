/**
 * Why one cell scores what it scores, tag by tag.
 *
 * WHAT THE INDEX CANNOT ANSWER. `CellScore.contributors` maps category → feature
 * key → **one** factor, which answers "which element made this cell 9?". The
 * question a surprising `0` actually raises is "which TAG made it 0, and what
 * was outvoted?" — and that is thrown away twice: the per-tag factors are local
 * to `scoreFeature`, and its `0` short-circuit means the tags after a veto are
 * never looked up at all.
 *
 * WHY RECOMPUTE RATHER THAN STORE. Keeping per-tag provenance for every
 * (cell, feature, category) multiplies the index's memory by the average tag
 * count and is paid on every cell whether or not anyone looks. Recomputing is
 * paid once, for one cell, when a human clicks it — and the inputs are already
 * in hand, because the caller holds the merged features and the rule table.
 *
 * WHY IT LIVES NEXT TO THE KERNEL. It must reproduce `scoreFeature`'s arithmetic
 * exactly, including the short-circuit, and the only way to keep that true over
 * time is to sit beside it with a test that pins the agreement. A copy in a
 * consumer would drift, and the drift would look like a scoring bug.
 *
 * @see explain-cell.ts.md
 */

import {
  getOsmDebugUrl,
  featureKey,
  type OsmFeature,
  type OsmFeatureKey,
} from "../model/osm-feature.js";
import { toRuleKey } from "../model/osm-tags.js";
import { isIgnoredTagKey } from "../rules/ignored-tags.js";
import {
  ruleValue,
  thresholdFor,
  type RuleTable,
} from "../rules/rule-table.js";

/** One tag's part in its feature's factor. */
export interface TagContribution {
  /** The OSM tag key, e.g. `landuse`. */
  readonly key: string;
  /** The OSM tag value, e.g. `cemetery`. */
  readonly value: string;
  /** The rule id the pair looks up, e.g. `landuse_cemetery`. */
  readonly ruleKey: string;
  /**
   * The multiplier this tag contributed.
   *
   * `undefined` means the table has **no rule at all** for this key — which is
   * different from a rule that scores `1`, even though both contribute nothing.
   * Conflating them is how a reader concludes the table covers a tag it has
   * never heard of.
   */
  readonly factor: number | undefined;
  /**
   * True when a `0` earlier in this feature's tags meant the scorer never
   * looked this tag up. Its `factor` is what the table WOULD have said.
   */
  readonly skippedByVeto: boolean;
  /** True when the ignore list marks this key as deliberately unscored. */
  readonly ignored: boolean;
}

/** One feature's contribution to a cell, opened up. */
export interface FeatureExplanation {
  readonly feature: OsmFeatureKey;
  /** The openstreetmap.org **browse** page — matching the C# reference. */
  readonly osmUrl: string;
  /** The product of this feature's tags — equals `scoreFeature(...)` exactly. */
  readonly factor: number;
  /** Every tag, in the order the scorer reads them. */
  readonly tags: readonly TagContribution[];
}

export interface CellExplanation {
  readonly cell: string;
  readonly category: string;
  /** The product of every feature's factor — equals the index's score. */
  readonly score: number;
  /** The table's threshold for this category, so a UI can place the score. */
  readonly threshold: number;
  /** In the order the features were supplied; ranking is the caller's choice. */
  readonly features: readonly FeatureExplanation[];
}

/**
 * Explains one cell's score from the features covering it.
 *
 * **The caller supplies the feature set, and must take it from the provenance
 * map rather than re-deriving it geometrically.** `CellScore.contributors[category]`
 * records every feature touching the cell — including those whose factor is `1`,
 * deliberately — so its keys are the complete and authoritative set. Recomputing
 * coverage from geometry would be a second source of truth about which features
 * touch the cell, free to disagree with the score being explained.
 *
 * ```ts
 * const keys = Object.keys(cellScore.contributors[category] ?? {});
 * const covering = keys
 *   .map((key) => allFeatures.get(key))
 *   .filter((f): f is OsmFeature => f !== undefined);
 * const why = explainCell(cellScore.cell, covering, table, category);
 * ```
 *
 * A feature the caller supplies that does not actually touch the cell will be
 * included in the product — there is nothing here that could detect it, and a
 * geometric check would reintroduce exactly the second source of truth above.
 */
export function explainCell(
  cell: string,
  features: Iterable<OsmFeature>,
  table: RuleTable,
  category: string,
): CellExplanation {
  const explained: FeatureExplanation[] = [];
  let score = 1;

  for (const feature of features) {
    const one = explainFeature(feature, table, category);
    explained.push(one);
    score *= one.factor;
  }

  return {
    cell,
    category,
    score,
    threshold: thresholdFor(table, category),
    features: explained,
  };
}

/**
 * One feature's tags, and the product they make.
 *
 * The product is accumulated with the SAME short-circuit as `scoreFeature` —
 * stopping at the first `0` — rather than multiplying every factor afterwards.
 * That is what makes the agreement exact by construction rather than by
 * coincidence: a later factor of `Infinity` would turn a plain product into
 * `NaN` where the scorer returns `0`. The tags after the veto still get their
 * own factors reported, marked `skippedByVeto`.
 */
function explainFeature(
  feature: OsmFeature,
  table: RuleTable,
  category: string,
): FeatureExplanation {
  const tags: TagContribution[] = [];
  let factor = 1;
  let vetoed = false;

  for (const [key, value] of Object.entries(feature.tags)) {
    const ruleKey = toRuleKey(key, value);
    // `ruleValue` returns 1 for both "no such rule" and "a rule scoring 1", so
    // the table is asked directly whether the rule exists at all.
    const hasRule = table.rules[ruleKey] !== undefined;
    const tagFactor = hasRule ? ruleValue(table, ruleKey, category) : undefined;

    tags.push({
      key,
      value,
      ruleKey,
      factor: tagFactor,
      skippedByVeto: vetoed,
      ignored: isIgnoredTagKey(key),
    });

    if (vetoed) continue;
    factor *= tagFactor ?? 1;
    if (factor === 0) vetoed = true;
  }

  return {
    feature: featureKey(feature),
    osmUrl: getOsmDebugUrl(feature.type, feature.id),
    factor,
    tags,
  };
}
