/**
 * The workspace's one distance formatter.
 *
 * WHY IT IS SHARED AT ALL. Three packages formatted the same quantity for the
 * same user with three different rules — `1234.5 m` on the wayfinding HUD,
 * `1.2 km` on the OSM demo's map, `1.23 km` in the recorder's session summary —
 * and none of them knew about the others.
 *
 * WHY IT TAKES OPTIONS RATHER THAN UNIFYING THE OUTPUT. The three genuinely
 * want different precision, and that is not an accident to be flattened: a
 * world-space HUD label a few metres away, a map label naming a walk, and a
 * session total are read in different situations. What is worth unifying is the
 * RULE — where the kilometre boundary sits, how rounding works, what happens
 * below zero — so a fourth caller inherits the decisions instead of inventing
 * them.
 *
 * The options are deliberately few and each one is a decision a caller has
 * actually made. A formatter with a knob per past disagreement is the shape
 * nobody can predict the output of.
 *
 * @see format-distance.ts.md
 */

export interface DistanceFormatOptions {
  /**
   * Round the metre value to this multiple before printing.
   *
   * `10` gives "120 m" rather than "123.4 m" — right where the underlying
   * number is not that precise and false precision would mislead.
   */
  readonly metreStep?: number;
  /** Decimals for the metre form. Default `1`. */
  readonly metreDecimals?: number;
  /** Decimals for the kilometre form. Default `1`. */
  readonly kmDecimals?: number;
  /**
   * Above this many metres, print kilometres. `null` never switches.
   *
   * Default `1000`. `null` is for callers whose subject is always near — a
   * world-space AR label at 1.5 km is not a real situation, and forcing it
   * through a kilometre branch would only make the common case read worse.
   */
  readonly kilometreAboveM?: number | null;
}

/**
 * Formats a distance in metres for display.
 *
 * **Negative input clamps to zero.** Distance is a magnitude; a negative one
 * means a caller subtracted in the wrong order, and "-3.0 m" on screen is
 * strictly less useful than "0 m" for finding that out. Non-finite input
 * likewise formats as zero rather than propagating `NaN` into the UI.
 */
/**
 * Rounds `value` to the nearest multiple of `step`.
 *
 * `> 0` and not just `!== 1`: a zero step would divide by zero and a negative
 * one would flip the sign — both leave the value unstepped instead. A
 * FRACTIONAL step is honoured; the option doc promises "this multiple".
 */
function stepMetres(value: number, step: number): number {
  return step > 0 && step !== 1 ? Math.round(value / step) * step : value;
}

export function formatDistance(
  metres: number,
  options: DistanceFormatOptions = {}
): string {
  const {
    metreStep = 1,
    metreDecimals = 1,
    kmDecimals = 1,
    kilometreAboveM = 1000,
  } = options;

  const safe = Number.isFinite(metres) ? Math.max(0, metres) : 0;

  if (kilometreAboveM !== null && safe >= kilometreAboveM) {
    return `${(safe / 1000).toFixed(kmDecimals)} km`;
  }

  return `${stepMetres(safe, metreStep).toFixed(metreDecimals)} m`;
}
