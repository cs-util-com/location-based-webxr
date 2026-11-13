/**
 * Angles the short way round: an angle wrapped into (-pi, pi], and one
 * angle eased toward another without spinning the long way past pi. The
 * package's one copy of both (a turning sign, a glyph, a visit's yaw).
 *
 * @see angle-easing.ts.md
 */

/** `a` (radians) wrapped into (-pi, pi]; NaN stays NaN. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** `from` moved toward `to` by the share `k` (0 none, 1 all) of the
 *  shorter turn between them, in radians. The result is not wrapped. */
export function easeAngle(from: number, to: number, k: number): number {
  return from + wrapAngle(to - from) * k;
}
