// @ts-check
/**
 * The views the globe's reference capture added after its first seven:
 * three held views and three holds of the reference flight at the altitudes
 * where the cloud shell volume's look lives (about 120, 60 and 20 km), and
 * the search for the dive time at which the flight passes an altitude. The
 * capture (`globe-reference-shots.smoke.spec.mjs`) takes them, the compare
 * script (`globe-reference-shots-compare.mjs`) knows their names.
 *
 * @see globe-reference-shots-views.mjs.md
 */

/**
 * Held views over the reference place, looking down the cloud bands
 * (heading north, pitch -25, as the 30 km view looks at its band).
 */
export const BAND_VIEWS = Object.freeze([
  { name: "8-shell-band-120km", altitudeKm: 120, headingDeg: 0, pitchDeg: -25 },
  { name: "9-shell-band-60km", altitudeKm: 60, headingDeg: 0, pitchDeg: -25 },
  { name: "10-shell-band-20km", altitudeKm: 20, headingDeg: 0, pitchDeg: -25 },
]);

/**
 * The reference flight held (`holdDiveAt`) where it passes these
 * altitudes: the camera's own pose in flight, which no held view takes.
 */
export const FLIGHT_HOLDS = Object.freeze([
  { name: "11-flight-120km", altitudeKm: 120 },
  { name: "12-flight-60km", altitudeKm: 60 },
  { name: "13-flight-20km", altitudeKm: 20 },
]);

/** Every added shot's name, in capture order. */
export const ADDED_SHOT_NAMES = Object.freeze(
  [...BAND_VIEWS, ...FLIGHT_HOLDS].map((v) => v.name),
);

/**
 * The first dive time (ms on the flight's own clock) at which the flight's
 * altitude is at or below `targetM`, and the altitude there. `altitudeAt`
 * reads the flight at a time without moving it (the lab's
 * `diveAltitudeAt`, through the page). The time doubles from `startMs`
 * until the flight is below the target, then `steps` halvings narrow it:
 * a flight that climbs first and then dives is found on its way down, as
 * long as it is above the target at every doubling before it.
 *
 * @param {(ms: number) => Promise<number | null> | number | null} altitudeAt
 * @param {number} targetM
 * @param {{ startMs?: number, maxMs?: number, steps?: number }} [options]
 * @returns {Promise<{ ms: number, altitudeM: number }>}
 */
export async function diveTimeFor(
  altitudeAt,
  targetM,
  { startMs = 1000, maxMs = 3_600_000, steps = 40 } = {},
) {
  if (!Number.isFinite(targetM) || targetM < 0) {
    throw new RangeError(`target altitude must be finite and >= 0: ${targetM}`);
  }
  const read = async (ms) => {
    const m = await altitudeAt(ms);
    if (typeof m !== "number" || !Number.isFinite(m)) {
      throw new Error(`no flight to read at ${ms} ms (altitude ${m})`);
    }
    return m;
  };
  const first = await read(0);
  if (first <= targetM) return { ms: 0, altitudeM: first };
  let lo = 0;
  let hi = Math.min(startMs, maxMs);
  while ((await read(hi)) > targetM) {
    if (hi >= maxMs) {
      throw new RangeError(
        `the flight stays above ${targetM} m to ${maxMs} ms`,
      );
    }
    lo = hi;
    hi = Math.min(hi * 2, maxMs);
  }
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if ((await read(mid)) > targetM) lo = mid;
    else hi = mid;
  }
  return { ms: hi, altitudeM: await read(hi) };
}
