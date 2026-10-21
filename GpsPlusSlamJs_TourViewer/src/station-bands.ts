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
 * How precise the position is - a code's, the GPS's with a number, or
 * nothing to judge by - is the framework's one rule for every app
 * (`gps-plus-slam-app-framework/state/position-precision`); these bands
 * only read it.
 *
 * Pure. `station-bands.sweep.test.ts` simulates visitors under the
 * framework's Gauss-Markov GPS noise model and records what the D16 rule
 * costs at each radius and accuracy.
 */

import {
  POSITION_PRECISION_CEILING_M,
  type PositionPrecision,
} from "gps-plus-slam-app-framework/state/position-precision";

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

/** A usable accuracy, or the precision rule's ceiling (25 m, the typical
 *  geofence of GPS-only tour products): above it the band is clamped, so
 *  the HUD's band stays finite, and a missing or nonsense one reads as it,
 *  the widest band there is. Above the ceiling the position is too weak to
 *  guide by (`PositionPrecision.tooWeak`): the station line says so and
 *  the run judges no arrival. */
function clampAccuracy(accuracyM: number | null): number {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return POSITION_PRECISION_CEILING_M;
  }
  return Math.min(accuracyM, POSITION_PRECISION_CEILING_M);
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
  return bandsWith(
    station,
    Math.max(BAND_ACCURACY_FACTOR * accuracy, HUD_ARRIVAL_BAND_M),
  );
}

/**
 * A station's bands at a position of this precision (PR #642 review: the
 * prefetch, the HUD's band and the breadcrumbs' stop read one rule with
 * the run and the line):
 * - a position a CODE holds (`'code'`) takes the HUD's own band, whatever
 *   the fixes say: their accuracy says nothing about it, and `stationBands`
 *   would read the unknown as the ceiling, the widest band there is;
 * - a GPS position takes its accuracy's (`stationBands`), an alignment no
 *   code holds included: from the first fix the session holds one (the
 *   library's identity at the zero), so "aligned" alone says nothing about
 *   how good the position is;
 * - nothing to judge by (`'none'`) takes the widest, as an unknown
 *   accuracy always has.
 */
export function judgedStationBands(
  station: { readonly activateRadiusM: number; readonly foundRadiusM: number },
  precision: PositionPrecision,
): StationBands {
  return precision.source === "code"
    ? bandsWith(station, HUD_ARRIVAL_BAND_M)
    : stationBands(station, precision.accuracyM);
}

function bandsWith(
  station: { readonly activateRadiusM: number; readonly foundRadiusM: number },
  band: number,
): StationBands {
  const foundM = finiteOr(station.foundRadiusM, 0);
  const foundExitM = foundM + band;
  const activateM = Math.max(finiteOr(station.activateRadiusM, 0), foundExitM);
  return { activateM, foundM, foundExitM };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
