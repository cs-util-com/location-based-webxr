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
  /**
   * Below this altitude the line also names the height above the ground
   * (round-4 plan 2026-10-11-0122 DEC-R4-1): there the two differ visibly
   * (by 4 % over a 4 km mountain at 100 km); above it the extra words only
   * crowd a phone's bottom line.
   */
  groundBelowM: 100_000,
  /**
   * How long the landed line waits for the relief's height under the
   * camera before it says the altitude above sea level instead, ms (r816's
   * city flight: the height never came, and the line said a bare
   * "Arrived." forever). The relief's tile under a landed camera arrives
   * within a few frames when it comes at all; 8 s is several frames even
   * on SwiftShader's frame a second.
   */
  landedWaitMs: 8_000,
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
 * The readout's line: "Altitude 1,234 km"; below `groundBelowM`, where the
 * ground under the camera is known (`groundM`, m above the ellipsoid),
 * " · 150 m above ground" after it (DEC-R4-1); and while a target is being
 * flown to, " · 1,300 km to the target".
 */
export function globeReadoutText({
  altitudeM,
  targetDistanceM,
  groundM = null,
}: {
  altitudeM: number;
  targetDistanceM: number | null;
  groundM?: number | null;
}): string {
  const parts = [`Altitude ${formatDistance(altitudeM)}`];
  if (
    groundM !== null &&
    Number.isFinite(groundM) &&
    altitudeM < GLOBE_READOUT.groundBelowM
  ) {
    // The sea is drawn at 0 (as the clearance takes it): never a depth.
    parts.push(
      `${formatDistance(altitudeM - Math.max(0, groundM))} above ground`,
    );
  }
  if (targetDistanceM !== null) {
    parts.push(`${formatDistance(targetDistanceM)} to the target`);
  }
  return parts.join(" · ");
}

/**
 * The continuous flight's landed line (round-4 plan DEC-R4-1; the R4b
 * milestone review, finding 2): "Arrived, 158 m above the ground." from
 * the camera's height above the drawn ground under it (`aboveGroundM`,
 * the readout's number); "Arrived, 150 m above sea level." from its
 * `altitudeM` without a relief (`aboveGroundM` null), or once
 * `landedWaitMs` has passed without a relief height (`undefined`); null
 * while it still waits for one.
 */
export function landedLineText({
  aboveGroundM,
  altitudeM,
  waitedMs,
}: {
  aboveGroundM: number | null | undefined;
  altitudeM: number;
  waitedMs: number;
}): string | null {
  if (typeof aboveGroundM === "number") {
    return `Arrived, ${formatDistance(aboveGroundM)} above the ground.`;
  }
  if (aboveGroundM === undefined && waitedMs < GLOBE_READOUT.landedWaitMs) {
    return null;
  }
  return `Arrived, ${formatDistance(altitudeM)} above sea level.`;
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
