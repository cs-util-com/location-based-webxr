/**
 * A station's effective radii (tour kit plan K4, §8 D9): the creator's
 * activation and found radii, widened where the phone's measured accuracy
 * cannot resolve them, with one hysteresis convention shared with the
 * wayfinding HUD's arrival deadband (`distanceMin` / `distanceMax`, absolute
 * metres; §8 D9 ties the radii to that deadband, and DEC-H3 keeps one
 * hysteresis convention in this codebase, not a second fractional one).
 *
 * Pure. The numbers are chosen by `station-bands.sweep.test.ts`, which
 * simulates visitors under the framework's Gauss-Markov GPS noise model
 * over a range of noise levels; its header records what each constant
 * rests on and what value would reverse it.
 */

/** The radii a station is judged by, in horizontal metres. */
export interface StationBands {
  /** The authored activation radius, never inside `foundExitM`: the
   *  prefetch of the station's media starts at this plus its lead
   *  (`station-prefetch.ts`). Nothing toggles on it (K4 review R10: an
   *  "active" state with its own hysteresis drove nothing a visitor sees). */
  readonly activateM: number;
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
 * deadband. The found radius has the higher `STATION_POSE_FLOOR_M`.
 */
export const HUD_ARRIVAL_MIN_M = 1.5;
export const HUD_ARRIVAL_BAND_M = 1.5;

/**
 * The found radius is never below this (K4 review R7): the station poses the
 * viewer reads are off by up to 3.6 m at p90 (D34: codes measured at a
 * visit's start 1.9-3.6 m, notes 1.6-2.8 m), so a visitor standing on the
 * real spot is that far from the stored one. 5 m finds them within 3 s at
 * p90 under the fused model (2 s worst) and 15 s under the noisier ones
 * with a 3.6 m bias; the K4 floor of 1.5 m left them unfound for 108 s
 * (fused), 4 m for 6 s. Cost: every station is found from at least 5 m,
 * where the HUD's arrow hides; stations closer than about 10 m overlap
 * under `any` order. Reversed by station poses measurably better than
 * D34's (`station-bands.sweep.test.ts`).
 */
export const STATION_POSE_FLOOR_M = 5;

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
 * - found = max(authored found, FOUND_ACCURACY_FACTOR x accuracy, the
 *   station pose floor 5 m);
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
  const foundM = Math.max(
    finiteOr(station.foundRadiusM, 0),
    FOUND_ACCURACY_FACTOR * accuracy,
    STATION_POSE_FLOOR_M,
  );
  const foundExitM = foundM + band;
  const activateM = Math.max(finiteOr(station.activateRadiusM, 0), foundExitM);
  return { activateM, foundM, foundExitM };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
