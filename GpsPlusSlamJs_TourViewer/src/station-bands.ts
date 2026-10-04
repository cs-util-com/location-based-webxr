/**
 * A station's effective radii (tour kit plan K4, §8 D9): the creator's
 * activation and found radii, widened where the phone's measured accuracy
 * cannot resolve them, with one hysteresis convention shared with the
 * wayfinding HUD's arrival deadband (`distanceMin` / `distanceMax`, absolute
 * metres; DEC-F4 and DEC-H3: one hysteresis convention in this codebase,
 * not a second fractional one).
 *
 * Pure. The numbers are chosen by `station-bands.sweep.test.ts`, which
 * simulates visitors under the framework's Gauss-Markov GPS noise model
 * over a range of noise levels; its header records what each constant
 * rests on and what value would reverse it.
 */

/** The radii a station is judged by, in horizontal metres. */
export interface StationBands {
  /** Inside this the station becomes ACTIVE (its figure shows, its media
   *  are fetched). */
  readonly activateM: number;
  /** Beyond this an active, not yet found station turns inactive again. */
  readonly activateExitM: number;
  /** Inside this the station is FOUND (once; found never reverts). It is
   *  also the HUD target's `distanceMin`: the arrow hides as "arrived". */
  readonly foundM: number;
  /** The HUD target's `distanceMax`: a hidden arrow comes back beyond it. */
  readonly foundExitM: number;
}

/**
 * The found radius is at least this many times the measured accuracy. 1.0
 * finds a visitor standing on the spot within 3 s at p90 in every noise
 * model swept; 0.5 does not (25 s at p90 under the noisiest model). 1.5
 * would find as reliably but fire about 1.4x farther away.
 */
export const FOUND_ACCURACY_FACTOR = 1.0;

/**
 * The hysteresis band is at least this many times the accuracy: 1.0 keeps a
 * visitor standing exactly on a radius to at most 7 toggles in 2 minutes at
 * p90 under the noisiest model (1-4 under the others); 0.5 allows 5-18.
 */
export const BAND_ACCURACY_FACTOR = 1.0;

/**
 * The wayfinding HUD's field-validated arrival deadband (AnchorStarter,
 * WayfindingHudDemo: hide at 1.5 m, come back at 3.0 m): the floor of the
 * found radius and of the band, so a station is never tighter than the arrow
 * that leads to it.
 */
export const HUD_ARRIVAL_MIN_M = 1.5;
export const HUD_ARRIVAL_BAND_M = 1.5;

/**
 * Accuracies above this are clamped (and a missing or nonsense one reads as
 * this): 25 m, the typical geofence of GPS-only tour products (plan §2). A
 * fix this poor is not used to FIND a station at all (`station-run.ts`); the
 * clamp only keeps the HUD's band finite.
 */
export const ACCURACY_CEILING_M = 25;

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
 * - found = max(authored found, FOUND_ACCURACY_FACTOR x accuracy, the HUD's
 *   1.5 m);
 * - band = max(BAND_ACCURACY_FACTOR x accuracy, the HUD's 1.5 m);
 * - activate = max(authored activation, found + band): a station is active
 *   before it can be found, never after;
 * - each exit is its entry plus the band.
 */
export function stationBands(
  station: { readonly activateRadiusM: number; readonly foundRadiusM: number },
  accuracyM: number | null,
): StationBands {
  const accuracy = clampAccuracy(accuracyM);
  const band = Math.max(BAND_ACCURACY_FACTOR * accuracy, HUD_ARRIVAL_BAND_M);
  const foundM = Math.max(
    finiteOr(station.foundRadiusM, 0),
    FOUND_ACCURACY_FACTOR * accuracy,
    HUD_ARRIVAL_MIN_M,
  );
  const foundExitM = foundM + band;
  const activateM = Math.max(finiteOr(station.activateRadiusM, 0), foundExitM);
  return { activateM, activateExitM: activateM + band, foundM, foundExitM };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
