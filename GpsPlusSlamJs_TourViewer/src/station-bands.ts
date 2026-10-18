/**
 * A station's effective radii (tour kit plan K4, §8 D9; tour editor plan
 * 2026-10-17-1816 D16): the creator's found radius exactly as the tour
 * gives it - a station is reached by its radius only, on the phone's
 * current best position, never widened by the measured accuracy and with
 * no floor of its own (D16: whether a station is reached "depends only on
 * the tour's settings, how close one must be") - and around it one
 * hysteresis band shared with the wayfinding HUD's arrival deadband
 * (`distanceMin` / `distanceMax`, absolute metres; DEC-H3 keeps one
 * hysteresis convention in this codebase, not a second fractional one).
 *
 * Pure. `station-bands.sweep.test.ts` simulates visitors under the
 * framework's Gauss-Markov GPS noise model and records what the D16 rule
 * costs at each radius and accuracy.
 */

/** The radii a station is judged by, in horizontal metres. */
export interface StationBands {
  /** The authored activation radius, never inside `foundExitM`: the
   *  prefetch of the station's media starts at this plus its lead
   *  (`station-prefetch.ts`). Nothing toggles on it (K4 review R10: an
   *  "active" state with its own hysteresis drove nothing a visitor sees). */
  readonly activateM: number;
  /** Inside this the station is FOUND (once; found never reverts): the
   *  authored found radius. It is also the HUD target's `distanceMin`: the
   *  arrow hides as "arrived". */
  readonly foundM: number;
  /** The HUD target's `distanceMax`: a hidden arrow comes back beyond it. */
  readonly foundExitM: number;
}

/**
 * The band beyond the found radius is at least this many times the
 * accuracy: the HUD's `distanceMax` (`foundExitM`), where the breadcrumbs
 * stop, and the activation radius's floor. Since the found latch removes a
 * station's HUD target the moment it is found, the band changes only where
 * the dots end and how early the prefetch starts; it was swept for an
 * activation hysteresis that no longer exists (R10) and is kept at 1.0, not
 * re-swept: nothing a visitor sees reverses on it.
 */
export const BAND_ACCURACY_FACTOR = 1.0;

/**
 * The wayfinding HUD's field-validated arrival deadband (AnchorStarter,
 * WayfindingHudDemo: hide at 1.5 m, come back at 3.0 m): the floor of the
 * band, so a station's arrow never comes back closer than the HUD's own
 * deadband.
 */
export const HUD_ARRIVAL_MIN_M = 1.5;
export const HUD_ARRIVAL_BAND_M = 1.5;

/**
 * Accuracies above this are clamped (and a missing or nonsense one reads as
 * this): 25 m, the typical geofence of GPS-only tour products (plan §2).
 * The clamp keeps the HUD's band finite; above it the station line says
 * the GPS is too weak and the run judges no arrival (`tooWeakToGuide`).
 */
export const ACCURACY_CEILING_M = 25;

/**
 * Whether a position is too weak to guide by: its accuracy is known and
 * above the ceiling. The station line says so and the run judges no
 * arrival on it - one rule, so the two agree (PR #640 review). D16 forbids
 * WIDENING the found radius by the accuracy, not refusing a fix the guide
 * itself calls unusable. Unknown (null, a position by a code alone) is not
 * too weak.
 */
export function tooWeakToGuide(accuracyM: number | null): boolean {
  return accuracyM !== null && accuracyM > ACCURACY_CEILING_M;
}

/** A usable accuracy, or the ceiling. */
function clampAccuracy(accuracyM: number | null): number {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return ACCURACY_CEILING_M;
  }
  return Math.min(accuracyM, ACCURACY_CEILING_M);
}

/**
 * The effective radii of one station at the measured accuracy.
 *
 * - found = the authored found radius (D16);
 * - band = max(BAND_ACCURACY_FACTOR x accuracy, the HUD's 1.5 m);
 * - activate = max(authored activation, found + band): the prefetch starts
 *   before the station can be found, never after;
 * - the found exit is the found radius plus the band.
 */
export function stationBands(
  station: { readonly activateRadiusM: number; readonly foundRadiusM: number },
  accuracyM: number | null,
): StationBands {
  const accuracy = clampAccuracy(accuracyM);
  const band = Math.max(BAND_ACCURACY_FACTOR * accuracy, HUD_ARRIVAL_BAND_M);
  const foundM = finiteOr(station.foundRadiusM, 0);
  const foundExitM = foundM + band;
  const activateM = Math.max(finiteOr(station.activateRadiusM, 0), foundExitM);
  return { activateM, foundM, foundExitM };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
