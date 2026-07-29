/**
 * What the colours mean, as data.
 *
 * WHY A LEGEND REPLACES THE SENTENCE RATHER THAN JOINING IT. The header used to
 * carry `describeScale`'s "above 1 (the identity is 1) up to 8, log scale — each
 * colour step is an equal RATIO, because the score is a product". First-session
 * feedback was that it is not readable. It is also not decoration: it is the
 * on-screen answer to iteration 8's second question — are the unbounded scores
 * practically thresholdable — and deleting it deletes an answer. So the claim is
 * kept and the FORM changes (DEC-13): a swatch strip says the same thing
 * pictorially, and the sentence survives as the strip's accessible text.
 *
 * WHY THE CATEGORY NAME IS PART OF IT. The reported symptom was "switching
 * category did not reset the map". The map does redraw — but every category
 * scores nearly every rule, and `heatScale` re-normalises the ramp to each
 * category's own maximum, so the same hexagons are drawn in similar colours. A
 * picture that does not say what it is a picture OF cannot be checked by eye.
 * Naming the category is the smallest thing that makes the redraw visible.
 *
 * WHY IT IS A PURE MODEL AND NOT A DOM BUILDER. The interesting parts — which
 * bands exist, what they are labelled, that no two of them render alike — are
 * decisions, and decisions deserve tests that do not need a browser.
 *
 * @see legend-model.ts.md
 */

import {
  describeScale,
  heatColour,
  toHex,
  type HeatScale,
} from "./heat-colours.js";

/**
 * A sub-threshold band, or a ramp stop.
 *
 * - `ramp` — a sample of the logarithmic ramp above the threshold.
 * - `veto` — score exactly `0`: some rule said "never here".
 * - `identity` — score exactly `1`: no rule said anything at all.
 * - `below` — `0 < score <= threshold`: rules spoke, and did not clear the bar.
 */
export type LegendStopKind = "ramp" | "veto" | "identity" | "below";

/**
 * Which band a score falls in.
 *
 * TOTAL over every finite score, and that matters: the map asks this for every
 * cell it draws, so a score the classifier has no answer for is a cell with no
 * fill — an invisible hole rather than a visible error. Non-finite scores land
 * in `identity`, the band that asserts the least.
 */
export function classifyScore(
  score: number,
  threshold: number,
): LegendStopKind {
  if (!Number.isFinite(score)) return "identity";
  if (score === 0) return "veto";
  if (score > threshold) return "ramp";
  // Order matters here: at the default threshold of 1 the identity IS the bar,
  // so "exactly 1" has to be tested before "under the bar" or it is swallowed.
  if (score === 1) return "identity";
  return "below";
}

export interface LegendStop {
  readonly kind: LegendStopKind;
  /** `#rrggbb`. For an outline-only stop this is the stroke, not a fill. */
  readonly colour: string;
  /** False means "draw the outline, leave the middle empty". */
  readonly fill: boolean;
  /** Shown next to the swatch. Empty for the interior ramp stops. */
  readonly label: string;
}

export interface LegendModel {
  /** The category these colours belong to. */
  readonly category: string;
  /** Swatches from the threshold up to the highest score on screen. */
  readonly ramp: readonly LegendStop[];
  readonly minLabel: string;
  readonly maxLabel: string;
  /** The three sub-threshold bands, or empty when they are not being drawn. */
  readonly bands: readonly LegendStop[];
  /** `describeScale`'s sentence, kept as the strip's title / screen-reader text. */
  readonly description: string;
}

/** How many swatches the strip samples the ramp at. */
const RAMP_STOPS = 7;

/**
 * A hard veto, and it must not read as "the bottom of the ramp".
 *
 * Deliberately outside the viridis palette: `0` is a categorical statement
 * ("never here"), not a low score, and colouring it as the ramp's dark end
 * would put it on the same axis as a merely-weak cell.
 */
export const VETO_COLOUR = "#c8304a";

/** "No rule said anything here" — outline only, so it asserts nothing. */
export const IDENTITY_COLOUR = "#6f7995";

/** Scored, but under the bar. A dimmed relative of the ramp's dark end. */
export const BELOW_THRESHOLD_COLOUR = "#3a3358";

/** Multiplicative scores produce 3.6000000000000005; round for display only. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Builds the legend for one scale and category.
 *
 * `showBelowThreshold` mirrors the map's own checkbox: the bands are only
 * described when they are actually being drawn, because a legend explaining
 * colours that are not on screen is worse than no legend.
 */
export function legendModel(
  scale: HeatScale,
  category: string,
  showBelowThreshold: boolean,
): LegendModel {
  const ramp: LegendStop[] = [];
  for (let i = 0; i < RAMP_STOPS; i++) {
    // Sampled through `heatColour` rather than by interpolating the palette
    // here, so the strip cannot drift from what the map actually paints — the
    // one way a legend becomes an active lie.
    const at =
      scale.max <= scale.threshold
        ? scale.threshold
        : scale.threshold *
          Math.pow(scale.max / scale.threshold, i / (RAMP_STOPS - 1));
    ramp.push({
      kind: "ramp",
      colour: toHex(heatColour(at, scale)),
      fill: true,
      label: "",
    });
  }

  return {
    category,
    ramp,
    minLabel: String(round(scale.threshold)),
    maxLabel: String(round(scale.max)),
    bands: showBelowThreshold ? bandsFor(scale) : [],
    description: describeScale(scale),
  };
}

/**
 * The three sub-threshold bands (DEC-7).
 *
 * They exist so that `0` and `1` can be told apart, which is the entire point of
 * revealing hidden cells: "a rule vetoed this" and "no rule has ever mentioned
 * this" are opposite statements that the old single skip rendered identically —
 * as nothing at all.
 */
function bandsFor(scale: HeatScale): LegendStop[] {
  return [
    {
      kind: "veto",
      colour: VETO_COLOUR,
      fill: true,
      label: "0 — vetoed",
    },
    {
      kind: "identity",
      colour: IDENTITY_COLOUR,
      fill: false,
      label: "1 — nothing known",
    },
    {
      kind: "below",
      colour: BELOW_THRESHOLD_COLOUR,
      fill: true,
      label: `up to ${round(scale.threshold)} — below the bar`,
    },
  ];
}
