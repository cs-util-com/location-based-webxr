/**
 * The globe's distance readout (round-4 plan 2026-09-28-2105 DEC-GL4-5):
 * the camera's altitude above the ellipsoid, and during the pin's dive the
 * distance to its target, as one line of text the owner can read on a
 * phone and name altitudes from ("the cloud fade should start at 12 km").
 * Pure: the lab measures, this formats and throttles.
 *
 * @see globe-readout.ts.md
 */

export const GLOBE_READOUT = {
  /**
   * The shortest time between two writes of the line: 4 a second. Fast
   * enough that a dive (tens of thousands of km in 15 s) reads as moving,
   * slow enough that a digit holds still long enough to be read.
   */
  intervalMs: 250,
} as const;

const km = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * A distance in metres as text: whole km from 100 km ("20,180 km"), one
 * decimal from 1 km ("45.6 km"), whole metres below ("850 m"). Negative
 * reads as 0 (the camera a hair under the ellipsoid); a non-finite number
 * reads "unknown" rather than throwing, since this runs every frame.
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "unknown";
  const m = Math.max(0, metres);
  if (m >= 99_950) return `${km.format(Math.round(m / 1000))} km`;
  if (m >= 999.5) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/**
 * The readout's line: "Altitude 1,234 km", and while a target is being
 * flown to, " · 1,300 km to the target" after it.
 */
export function globeReadoutText({
  altitudeM,
  targetDistanceM,
}: {
  altitudeM: number;
  targetDistanceM: number | null;
}): string {
  const altitude = `Altitude ${formatDistance(altitudeM)}`;
  return targetDistanceM === null
    ? altitude
    : `${altitude} · ${formatDistance(targetDistanceM)} to the target`;
}

/**
 * Hands a text to `write` at most once per `GLOBE_READOUT.intervalMs`, and
 * only when it differs from the last one written. `offer(text, nowMs)` is
 * called every frame; a change offered inside the interval is dropped, and
 * the next offer after it carries the newer value anyway.
 */
export function readoutThrottle(write: (text: string) => void): {
  offer(text: string, nowMs: number): void;
} {
  let last: string | null = null;
  let lastAt = -Infinity;
  return {
    offer(text, nowMs) {
      if (text === last || nowMs - lastAt < GLOBE_READOUT.intervalMs) return;
      last = text;
      lastAt = nowMs;
      write(text);
    },
  };
}
