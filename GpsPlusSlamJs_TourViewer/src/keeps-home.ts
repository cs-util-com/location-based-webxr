/**
 * Whether an item moved within or near its station's circle keeps that
 * station, by distance alone (pure): the station rule's tolerance. The
 * tour document asks it before it seats a moved item anew
 * (`tour-document.ts`, `keepsHome`), and adds there that the move must
 * not take the item into another station's circle.
 *
 * @see keeps-home.ts.md
 */

/** How far past its station's found radius a moved item still keeps the
 *  station (m): absorbs a typed offset's rounding and an AR settle's
 *  noise, never so much that a station's content stands far outside the
 *  circle where visitors see it. */
export const KEEPS_HOME_TOLERANCE_M = 0.5;

function isDistance(m: number): boolean {
  return Number.isFinite(m) && m >= 0;
}

/**
 * True when an item that stood `wasM` from its station's anchor before
 * the move (the gesture's start) and stands `nowM` from it after keeps
 * the station of found radius `radiusM`: within the radius and
 * `toleranceM`, or no farther out than it stood before (an item left
 * outside by a radius lowered under it may move about out there, and
 * back in). The bound is the circle, never the previous place, so no run
 * of small moves carries an item outward without limit. False for a
 * distance or a radius that is not a finite, non-negative number.
 */
export function keepsHomeDistance(
  at: {
    readonly radiusM: number;
    readonly wasM: number;
    readonly nowM: number;
  },
  toleranceM: number = KEEPS_HOME_TOLERANCE_M,
): boolean {
  const { radiusM, wasM, nowM } = at;
  if (!isDistance(radiusM) || !isDistance(nowM) || !isDistance(toleranceM)) {
    return false;
  }
  if (nowM <= radiusM + toleranceM) return true;
  return isDistance(wasM) && nowM <= wasM;
}
