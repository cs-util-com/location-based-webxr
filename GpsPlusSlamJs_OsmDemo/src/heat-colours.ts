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
  /** The highest score present, so the ramp uses its full range. */
  readonly max: number;
}

/**
 * Builds a scale from the data actually on screen.
 *
 * Derived from the data rather than fixed, because the useful range differs by
 * category and by place — `walkable` in a city saturates where `restingArea`
 * has a handful of cells at 6. A fixed scale would make most categories look
 * uniformly dark and hide precisely the variation being judged.
 */
export function heatScale(
  scores: readonly number[],
  threshold: number
): HeatScale {
  let max = threshold;
  for (const score of scores) {
    if (Number.isFinite(score) && score > max) max = score;
  }
  return { threshold, max };
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
  const hex = (v: number) => v.toString(16).padStart(2, '0');
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
    `above ${scale.threshold} (the identity is 1) up to ${round(scale.max)}, ` +
    `log scale — each colour step is an equal RATIO, because the score is a product`
  );
}

function round(value: number): number {
  // Multiplicative scores produce things like 3.6000000000000005. Rounding at
  // the PRESENTATION boundary keeps the oracle values exact in the model, which
  // is where they have to stay exact.
  return Math.round(value * 100) / 100;
}
