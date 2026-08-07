/**
 * `explainCell`'s output, shaped for a collapsible tree.
 *
 * THE QUESTION THIS ANSWERS, in the owner's words: "I want to see that it was a
 * meadow and a park and maybe even had a bench, but that the cemetery reset it
 * to zero regardless of how high the other ratings were." That needs three
 * things the popup cannot give — every feature, every tag under each one, and
 * the tags the veto short-circuit never looked up.
 *
 * WHY THE RUNNING PRODUCT IS PART OF THE MODEL. A column of factors and a total
 * asks the reader to multiply in their head to check the total — which is the
 * whole task they came to do. Accumulating it per row turns "is 48 right?" into
 * reading down a column.
 *
 * WHY FEATURES ARE RE-ORDERED HERE. `explainCell` returns them in the order it
 * was given, deliberately — ranking is presentation. The panel ranks by the same
 * `|log(factor)|` magnitude the popup uses, so the vetoing feature is the first
 * row a reader opens rather than the last one they scroll to.
 *
 * @see explanation-tree.ts.md
 */

import type { CellExplanation } from "gps-plus-slam-osm";

import { magnitudeOf } from "./contributor-order.js";

/** What a tag did, as one word a UI can style on. */
type TagState = "scored" | "veto" | "skipped" | "no-rule" | "ignored";

/** What a feature did to the cell's product. */
type FeatureState = "veto" | "raised" | "lowered" | "silent";

interface TagRow {
  readonly key: string;
  readonly value: string;
  readonly ruleKey: string;
  /** The factor, or `—` when the table has no rule for the tag. */
  readonly factorLabel: string;
  /** The feature's product after this tag, so the total is traceable. */
  readonly runningLabel: string;
  readonly state: TagState;
}

export interface FeatureRow {
  readonly key: string;
  readonly osmUrl: string;
  /** The unrounded factor. Ordering uses this; only `factorLabel` is rounded. */
  readonly factor: number;
  readonly factorLabel: string;
  readonly state: FeatureState;
  readonly tags: readonly TagRow[];
}

export interface ExplanationTree {
  readonly cell: string;
  readonly category: string;
  readonly scoreLabel: string;
  readonly thresholdLabel: string;
  readonly aboveThreshold: boolean;
  /** One sentence for the panel header, for the cases a table cannot carry. */
  readonly summary: string;
  readonly features: readonly FeatureRow[];
}

/** Multiplicative scores produce 3.6000000000000005; round for display only. */
function label(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function tagState(tag: {
  factor: number | undefined;
  skippedByVeto: boolean;
  ignored: boolean;
}): TagState {
  if (tag.skippedByVeto) return "skipped";
  if (tag.factor === 0) return "veto";
  if (tag.factor === undefined) return tag.ignored ? "ignored" : "no-rule";
  return tag.ignored ? "ignored" : "scored";
}

function featureState(factor: number): FeatureState {
  if (factor === 0) return "veto";
  if (factor > 1) return "raised";
  if (factor < 1) return "lowered";
  return "silent";
}

/**
 * Turns one cell's explanation into rows.
 *
 * The running product is accumulated with the SAME short-circuit the scorer
 * uses: once a tag vetoes, every later row stays at `0`, because that is what
 * the product actually did. Continuing to multiply the skipped factors would
 * print a column that never happened.
 */
export function explanationTree(explanation: CellExplanation): ExplanationTree {
  const features = explanation.features
    .map((feature): FeatureRow => {
      let running = 1;
      const tags = feature.tags.map((tag): TagRow => {
        if (!tag.skippedByVeto) running *= tag.factor ?? 1;
        return {
          key: tag.key,
          value: tag.value,
          ruleKey: tag.ruleKey,
          factorLabel: tag.factor === undefined ? "—" : label(tag.factor),
          runningLabel: label(running),
          state: tagState(tag),
        };
      });
      return {
        key: feature.feature,
        osmUrl: feature.osmUrl,
        factor: feature.factor,
        factorLabel: label(feature.factor),
        state: featureState(feature.factor),
        tags,
      };
    })
    // Ranked on the raw factor, never on the rounded label — and by the same
    // |log| magnitude the popup uses, so the two lists cannot disagree about
    // which contributor is worth reading first.
    .sort(
      (a, b) =>
        magnitudeOf(b.factor) - magnitudeOf(a.factor) ||
        a.key.localeCompare(b.key),
    );

  const above = explanation.score > explanation.threshold;
  return {
    cell: explanation.cell,
    category: explanation.category,
    scoreLabel: label(explanation.score),
    thresholdLabel: label(explanation.threshold),
    aboveThreshold: above,
    summary: summaryFor(explanation.score, explanation.threshold, features),
    features,
  };
}

/**
 * The one sentence a table of numbers cannot say.
 *
 * The three cases that are genuinely different to a reader — nothing is mapped
 * here, something vetoed it, it scored but under the bar — look almost identical
 * as rows, and telling them apart is the entire reason the panel exists.
 */
function summaryFor(
  score: number,
  threshold: number,
  features: readonly FeatureRow[],
): string {
  if (features.length === 0) {
    return "Nothing is mapped here — this cell is the identity.";
  }
  const veto = features.find((f) => f.state === "veto");
  if (veto !== undefined) {
    return `Vetoed by ${veto.key}: a single 0 makes the whole product 0, whatever else scored.`;
  }
  if (score <= threshold) {
    return `Scored ${label(score)}, which does not clear the ${label(threshold)} bar.`;
  }
  return `Scored ${label(score)}, above the ${label(threshold)} bar.`;
}
