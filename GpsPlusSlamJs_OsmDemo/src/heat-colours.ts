/**
 * Turning unbounded affordance scores into colours a human can read.
 *
 * THIS MODULE IS WHERE ITERATION 8's SECOND QUESTION GETS ANSWERED. The scoring
 * model is multiplicative and deliberately unbounded (the plan's §2 carries the
 * flaw over from the C# reference on purpose), so a cell overlapped by five
 * mapped features scores far higher than the identical physical surface with one
 * feature mapped. The open question was whether that makes thresholds
 * *practically* un-pickable in real data.
 *
 * A linear colour ramp would answer it badly: one cell at 1587 flattens
 * everything else to the bottom of the scale, and the map would look empty
 * whatever the data said. So the ramp is **logarithmic above the threshold**,
 * which is the honest presentation of a multiplicative quantity — equal ratios
 * get equal colour steps, exactly as equal ratios get equal products.
 *
 * The scale is also **reported**, not hidden: `describeScale` gives the numbers
 * behind the picture so "looks plausible" can be checked against "1 is the
 * identity, 10 is one strong rule, 100 is two".
 *
 * @see heat-colours.ts.md
 */

/** A colour stop, RGB 0-255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Viridis-like ramp, sampled at five stops.
 *
 * Perceptually near-uniform and colour-blind safe, which matters because the
 * whole output of this demo is a human judging a picture. A rainbow ramp
 * invents banding that reads as structure in the data.
 */
const RAMP: readonly Rgb[] = [
  { r: 68, g: 1, b: 84 }, // deep purple — just above the threshold
  { r: 59, g: 82, b: 139 },
  { r: 33, g: 145, b: 140 },
  { r: 94, g: 201, b: 98 },
  { r: 253, g: 231, b: 37 }, // yellow — the strongest cells present
];

export interface HeatScale {
  /** Scores at or below this are not part of the ramp at all. */
  readonly threshold: number;
  /**
   * The top of the ramp. **Fixed at {@link HEAT_CAP} since DEC-H5**, not the
   * highest score present — which is what it used to be, and what made a cell's
   * colour depend on cells the user could not see.
   */
  readonly max: number;
}

/**
 * The top of the ramp — FIXED, not derived (DEC-H5).
 *
 * WHY A CONSTANT AT ALL. The scale used to be the maximum score on screen, so a
 * cell's colour depended on cells the user could not see: walk far enough for
 * the hottest cell to leave the retained set and every remaining cell brightens
 * with no change in its own data. **The picture reported a change that did not
 * happen.** Tolerable on a desktop where you click between places; in AR the
 * user walks continuously and the grid is what they are reading. It also made
 * two observations incomparable — here versus a kilometre back, today versus
 * last week.
 *
 * WHY 1e4 SPECIFICALLY, and it is measured rather than chosen. The decade
 * histogram over the corpus (`corpus-score-distribution.test.ts`,
 * `category-score-distributions.test.ts`) says:
 *
 * - The region above 1e4 holds ~10-14 % of `walkable` cells spread over EIGHT
 *   orders of magnitude. Up there a product-of-factors score is largely reading
 *   how thoroughly the patch was mapped rather than how walkable it is.
 * - Roughly two thirds of coloured cells sit below 1000, which is where the
 *   resolution belongs.
 * - It clips at most 3.9 % of every other category — less than the 9.8-13.9 %
 *   accepted for `walkable`, the category it was chosen for.
 *
 * **The accepted cost, stated:** at Heidelberg roughly one coloured `walkable`
 * cell in four saturates, so an outstanding spot stops being distinguishable
 * from a merely very good one.
 *
 * **The objection this file used to carry is measured and does not hold.** It
 * said a fixed scale "would make most categories look uniformly dark and hide
 * precisely the variation being judged". The ramp is logarithmic, so at the
 * weaker corpus site the five non-`walkable` categories' maxima land at 68 %,
 * 76 %, 91 %, 95 % and 107 % of a ramp running 1 → 1e4.
 */
export const HEAT_CAP = 1e4;

/**
 * The scale for a category — a constant, given that category's threshold.
 *
 * TAKES THE THRESHOLD RATHER THAN THE CATEGORY, which is a deliberate deviation
 * from DEC-H6's `scaleFor(category)`. The cap is the same for all six
 * categories (measured), while the threshold is already per-category and
 * already arrives from `thresholdFor(table, category)` — so a `category`
 * parameter would be an argument that looks nothing up. If a per-category cap
 * is ever justified, this is where it goes.
 */
export function fixedScale(threshold: number): HeatScale {
  // THE CAP HAS TO STAY ABOVE THE THRESHOLD, and this guard is a regression the
  // fixed ramp introduced (r513 review). `heatScale` seeded `max = threshold`
  // and grew from there, so `max >= threshold` held by construction. A constant
  // cap does not: thresholds come from a publicly editable Google Sheet through
  // `toNumber`, and `legend-model.test.ts` already exercises 250 000 as a
  // "large threshold off the rule sheet".
  //
  // At `threshold >= HEAT_CAP` the span goes non-positive, `heatFraction`'s
  // guard returns 0 for every score, and the entire grid paints the ramp's dark
  // end with no message — a uniformly dark map caused by one sheet edit, which
  // is the same class of failure as the `#NaNNaNNaN` scar that guard was
  // written for.
  //
  // One decade above the threshold rather than a hard clamp: it keeps a usable
  // ramp, stays a pure function of a table constant (so it is still fixed, not
  // data-derived), and makes the degenerate case impossible rather than merely
  // survivable.
  return { threshold, max: Math.max(HEAT_CAP, threshold * 10) };
}

/**
 * Position of a score on the ramp, 0..1.
 *
 * Logarithmic, so equal RATIOS are equal steps. `max === threshold` (every cell
 * identical) collapses to 0 rather than dividing by zero — a flat map is the
 * correct picture of flat data.
 */
export function heatFraction(score: number, scale: HeatScale): number {
  if (!Number.isFinite(score) || score <= scale.threshold) return 0;
  // A LOG RAMP NEEDS A POSITIVE THRESHOLD, and nothing upstream guarantees one:
  // thresholds come from the live Google Sheet through `toNumber`, which accepts
  // `0` and negatives. With `threshold = 0`, `Math.log(0)` is `-Infinity`, so
  // `span` is `Infinity` and `at` is `Infinity/Infinity` — NaN, which the clamp
  // below does NOT catch, so `RAMP[NaN]` falls through and `toHex` emits
  // `#NaNNaNNaN`. Leaflet treats that as an invalid fill and drops the path, so
  // one bad sheet edit blanks the entire map while every score is still fine.
  //
  // The `score <= threshold` return above does not save it: at a threshold of
  // zero every drawn cell has a positive score, so every cell reaches here.
  if (!(scale.threshold > 0) || !(scale.max > 0)) return 0;
  const span = Math.log(scale.max) - Math.log(scale.threshold);
  if (span <= 0) return 0;
  const at = (Math.log(score) - Math.log(scale.threshold)) / span;
  return Math.min(1, Math.max(0, at));
}

/** Interpolates the ramp at 0..1. */
export function heatColour(score: number, scale: HeatScale): Rgb {
  const at = heatFraction(score, scale) * (RAMP.length - 1);
  const low = Math.floor(at);
  const high = Math.min(RAMP.length - 1, low + 1);
  const f = at - low;
  const a = RAMP[low] ?? RAMP[0];
  const b = RAMP[high] ?? RAMP[RAMP.length - 1];
  if (a === undefined || b === undefined) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(a.r + (b.r - a.r) * f),
    g: Math.round(a.g + (b.g - a.g) * f),
    b: Math.round(a.b + (b.b - a.b) * f),
  };
}

/** `#rrggbb`, for Leaflet and CSS. */
export function toHex({ r, g, b }: Rgb): string {
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * The scale in words, so the picture can be checked against the arithmetic.
 *
 * Without this the demo answers "does it look plausible?" and not "is 1 really
 * the identity here?" — and only the second question is worth a session.
 */
export function describeScale(scale: HeatScale): string {
  return (
    `above ${formatScore(scale.threshold)} (the identity is 1) up to a FIXED ${formatScore(scale.max)}, ` +
    `log scale — each colour step is an equal RATIO, because the score is a product. ` +
    `The same score is the same colour everywhere, so anything above the top reads as the top`
  );
}

/**
 * Above this, a score is printed as a magnitude rather than as a number.
 *
 * 1e4 rather than 1e5 (DEC-R6b-6). The legend's job is to make "1 is the
 * identity, 10 is one strong rule, 100 is two" checkable; past four digits the
 * value has stopped being something a human reads and become a magnitude, and a
 * stable line width matters more there than the extra precision. The cost, taken
 * knowingly: `12000` prints as `1.2e4`, which is arguably worse than the plain
 * number — a narrow band, against a tail that runs to 1e13.
 */
const EXPONENTIAL_ABOVE = 1e4;

/**
 * A score, as the legend should print it.
 *
 * WHY THIS IS NOT JUST `round`. The sixth session read the legend as "von 1 bis"
 * followed by a very long number — a screenshot showed
 * `walkable 1 … 27992463056732.17`. That is not an outlier: the score is a
 * PRODUCT of rule factors and products compound, so round 6's corpus measurement
 * found `walkable` at Cologne spanning twelve orders of magnitude (p99 = 8.1e6,
 * max = 1.4e12). Full precision is the wrong presentation for that quantity at
 * almost any position.
 *
 * Applied to the THRESHOLD as well as the max, because both come off the same
 * compounding scale — abbreviating only one would leave the identical defect one
 * field to the left.
 *
 * **EXPORTED, and that is the point.** `legend-model.ts` builds the labels the
 * user actually reads (`describeScale` is only the strip's title and
 * screen-reader text) and used to carry its own copy of `round`. Two formatters
 * meant fixing one and leaving the other printing the reported number unchanged.
 * There is now one.
 */
export function formatScore(value: number): string {
  // Defensive: the pipeline filters non-finite scores, but this function is
  // reachable from an exported one and "Infinity" in the legend would read as a
  // broken demo rather than as a broken input.
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < EXPONENTIAL_ABOVE) return String(round(value));

  // One decimal on the mantissa, and no trailing `.0`: the whole point is a
  // short, stable line, and `1.234568e5` would reproduce the problem in a new
  // notation. `toExponential` gives `2.8e+13`; the `+` buys nothing here.
  return value.toExponential(1).replace("e+", "e").replace(".0e", "e");
}

function round(value: number): number {
  // Multiplicative scores produce things like 3.6000000000000005. Rounding at
  // the PRESENTATION boundary keeps the oracle values exact in the model, which
  // is where they have to stay exact.
  return Math.round(value * 100) / 100;
}
