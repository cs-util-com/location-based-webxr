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
 * scores nearly every rule, so the same hexagons come back in similar colours
 * whatever category is selected. A picture that does not say what it is a
 * picture OF cannot be checked by eye, and naming the category is the smallest
 * thing that makes the redraw visible.
 *
 * **This reason used to be stated as "`heatScale` re-normalises the ramp to
 * each category's own maximum", and that mechanism was deleted by DEC-H5.** The
 * reason survives the mechanism — what makes the picture ambiguous is the
 * OVERLAP between categories, not the normalisation, and a fixed ramp does
 * nothing about overlap. Corrected rather than dropped because it is the
 * rationale for a test, and a rationale citing a function that no longer exists
 * reads as though the test is obsolete.
 *
 * WHY IT IS A PURE MODEL AND NOT A DOM BUILDER. The interesting parts — which
 * bands exist, what they are labelled, that no two of them render alike — are
 * decisions, and decisions deserve tests that do not need a browser.
 *
 * @see legend-model.ts.md
 */

import {
  describeScale,
  formatScore,
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

/**
 * How a band is DRAWN — the one answer both views read (W13, DEC-R3-16).
 *
 * A TREATMENT RATHER THAN A COLOUR, because one of the four bands is not a
 * colour. DEC-7 draws `identity` as an OUTLINE — `fill: false` — and the
 * unfilledness IS the statement: "no rule said anything here" must not paint a
 * claim the data does not support. A solid hexagon cannot equal "no fill", so
 * "one function, two consumers" is achievable for three bands and is a category
 * error for the fourth unless the shared answer carries the KIND as well.
 *
 * Before this existed the 3D grid coloured every drawn cell through
 * `heatColour`, which returns the ramp's darkest stop for ANY score at or below
 * the threshold — so a veto, an identity and a below-bar cell were one
 * near-black colour in 3D and red, dashed-outline and dim on the map. The file
 * claimed both views applied the same rule; that was true of WHICH cells are
 * drawn and false of what they look like.
 */
export interface BandTreatment {
  readonly kind: "fill" | "outline";
  /** `#rrggbb`. The fill colour, or the stroke for an outline. */
  readonly colour: string;
}

/**
 * The treatment for one band — the shared answer.
 *
 * `ramp` needs the score and the scale; the other three are categorical and
 * ignore both. Taking them anyway keeps every caller's call site identical,
 * which is what stops a caller from special-casing one band and drifting.
 */
export function bandTreatment(
  band: LegendStopKind,
  score: number,
  scale: HeatScale,
): BandTreatment {
  switch (band) {
    case "ramp":
      return { kind: "fill", colour: toHex(heatColour(score, scale)) };
    case "veto":
      // Solid and off-palette: a veto is a categorical statement, not a low
      // score, so it must not read as the dark end of the ramp.
      return { kind: "fill", colour: VETO_COLOUR };
    case "identity":
      // OUTLINE ONLY, in both views. This is DEC-7's whole point.
      return { kind: "outline", colour: IDENTITY_COLOUR };
    case "below":
      return { kind: "fill", colour: BELOW_THRESHOLD_COLOUR };
  }
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
  /** The top of the FIXED ramp — the same number for every category and place. */
  readonly maxLabel: string;
  /**
   * The highest score actually present, formatted (DEC-H7).
   *
   * Beside the ramp rather than on it. Once the ramp stopped being derived,
   * every number in this model became a constant, and a legend that reports
   * nothing about the data on screen is against `describeScale`'s stated
   * purpose. It is also the only way to tell "everything here saturates" from
   * "everything here is flat" — which look identical on a clipped ramp.
   */
  readonly observedLabel: string;
  /** How many cells clear the bar. Drives {@link emptyMessage}. */
  readonly aboveThresholdCount: number;
  /** The three sub-threshold bands, or empty when they are not being drawn. */
  readonly bands: readonly LegendStop[];
  /** `describeScale`'s sentence, kept as the strip's title / screen-reader text. */
  readonly description: string;
  /**
   * Set when NO cell scores above the bar, and the ramp therefore has no range.
   *
   * THE REPORTED BUG (finding R3-8): switching to a category nothing qualifies
   * for — `spawnPoint` in the note — printed seven identical swatches labelled
   * "1" at both ends. That is correct output from a degenerate scale and it is
   * not the FACT, which is "no cell here scores above the bar for this
   * category". A ramp cannot say that; a sentence can.
   *
   * Carried as a message rather than a boolean so the view has nothing to
   * decide, and so the wording is testable without a browser.
   */
  readonly emptyMessage?: string;
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
const VETO_COLOUR = "#c8304a";

/** "No rule said anything here" — outline only, so it asserts nothing. */
const IDENTITY_COLOUR = "#6f7995";

/** Scored, but under the bar. A dimmed relative of the ramp's dark end. */
const BELOW_THRESHOLD_COLOUR = "#3a3358";

// NOT EXPORTED ANY MORE (W13): `bandTreatment` is the one way to ask what a band
// looks like, so the raw constants have no caller outside this file. Exporting
// them again would be re-opening the second colour path this item closed.

// FORMATTING LIVES IN `heat-colours.ts` (DEC-R6b-6). This file used to carry its
// own `round`, and the duplication had a cost rather than being untidy: the
// sixth session's "von 1 bis <very long number>" is `maxLabel`, built HERE, while
// `describeScale` is only the strip's title. Fixing one copy would have
// abbreviated the tooltip and left the number on screen exactly as reported.
// One `formatScore`, used by both.

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
  /**
   * What the DATA does, now that the ramp no longer says (DEC-H7).
   *
   * REQUIRED, not optional. An optional argument would let a caller silently
   * stop supplying it and get the pre-fix behaviour back — and the pre-fix
   * behaviour is a legend that cannot say "nothing here", which is the exact
   * defect (R3-8) this pair exists to keep fixed.
   */
  data: { readonly aboveThresholdCount: number; readonly observedMax: number },
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

  // NOTHING HERE IS NOW A COUNT, NOT A DEGENERATE SCALE (DEC-H7).
  //
  // This used to ask `scale.max <= scale.threshold`, which worked only BECAUSE
  // the max was observed: `heatScale` collapsed it onto the threshold when
  // nothing cleared the bar, and every ramp stop then sampled the identical
  // colour — the reported bug, seven grey squares between two labels reading
  // "1" (R3-8).
  //
  // Under a FIXED ramp `max > threshold` always, so that test can never be true
  // again. The fix would have died silently and its e2e would have stayed
  // green, which is why the count is threaded in rather than inferred. It is
  // also what the condition always MEANT.
  const empty = data.aboveThresholdCount === 0;

  return {
    category,
    ramp,
    minLabel: formatScore(scale.threshold),
    maxLabel: formatScore(scale.max),
    // WHAT THE DATA DOES, beside a ramp that no longer moves. `describeScale`'s
    // stated purpose is letting the picture be checked against the arithmetic,
    // and a constant ramp removes every number that came from the data — so a
    // field of saturated cells would read identically to a flat field.
    observedLabel: formatScore(data.observedMax),
    aboveThresholdCount: data.aboveThresholdCount,
    bands: showBelowThreshold ? bandsFor(scale) : [],
    description: describeScale(scale),
    ...(empty
      ? {
          emptyMessage: `no cell scores above ${formatScore(scale.threshold)} for ${category} here`,
        }
      : {}),
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
      label: `up to ${formatScore(scale.threshold)} — below the bar`,
    },
  ];
}
