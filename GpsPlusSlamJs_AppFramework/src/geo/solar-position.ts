/**
 * The real sun for a place and an instant (plan 2026-09-23-2149, M1;
 * DEC-SUN-2): the NOAA solar-calculator algorithm (Meeus, "Astronomical
 * Algorithms", ch. 25, low-precision form). Measured within 0.019° of a
 * VSOP87 reference (astronomy-engine) over 1800-2100; the sun's disc is
 * 0.53° wide. A few dozen trigonometric operations, no dependency.
 *
 * GEOMETRIC positions: no atmospheric refraction (the sky model is
 * geometric). An augmented-reality overlay on the REAL sun would add
 * refraction (up to ~0.57° at the horizon) on top.
 *
 * Conventions: elevation above the horizon; azimuth clockwise from north
 * (east = 90°), the frame `sunDirection` in OsmDemo expects. Instants are
 * epoch milliseconds (UTC); a "solar date" is the local APPARENT solar day
 * at a longitude, centred on its solar noon, so day boundaries never depend
 * on the browser's time zone.
 *
 * @see solar-position.ts.md
 */

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;

/** A calendar date, read as the local apparent solar day at a longitude. */
export interface SolarDate {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
}

/** The sun's geometric direction. */
export interface SolarPosition {
  readonly elevationRad: number;
  /** Clockwise from north, [0, 2π). */
  readonly azimuthRad: number;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`);
  }
}

function requirePlace(latDeg: number, lngDeg: number): void {
  requireFinite('latitude', latDeg);
  requireFinite('longitude', lngDeg);
  if (Math.abs(latDeg) > 90) {
    throw new RangeError(`latitude must be within ±90°, got ${latDeg}`);
  }
}

const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Declination (rad) and the equation of time (minutes) at an instant. */
function sunAt(ms: number): { declination: number; eotMinutes: number } {
  const jd = ms / DAY_MS + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = wrap360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * DEG;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * DEG;
  const apparentLongitude =
    (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const meanObliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * DEG;
  const declination = Math.asin(
    Math.sin(obliquity) * Math.sin(apparentLongitude)
  );
  const y = Math.tan(obliquity / 2) ** 2;
  const l0r = l0 * DEG;
  const eot =
    y * Math.sin(2 * l0r) -
    2 * e * Math.sin(mr) +
    4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
    0.5 * y * y * Math.sin(4 * l0r) -
    1.25 * e * e * Math.sin(2 * mr);
  return { declination, eotMinutes: (4 * eot) / DEG };
}

/** Minutes of UTC since midnight UTC. */
const utcMinutes = (ms: number) => (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;

/** Local apparent solar time at a longitude, hours in [0, 24). */
export function apparentSolarTimeHours(ms: number, lngDeg: number): number {
  requireFinite('instant', ms);
  requireFinite('longitude', lngDeg);
  const minutes = utcMinutes(ms) + sunAt(ms).eotMinutes + 4 * lngDeg;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  // A value that rounds to exactly 1440 is midnight of the next day.
  return wrapped / 60 >= 24 ? 0 : wrapped / 60;
}

/** The sun's geometric elevation and azimuth at an instant and a place. */
export function solarPosition(
  ms: number,
  latDeg: number,
  lngDeg: number
): SolarPosition {
  requireFinite('instant', ms);
  requirePlace(latDeg, lngDeg);
  const { declination } = sunAt(ms);
  const hourAngle = (apparentSolarTimeHours(ms, lngDeg) * 15 - 180) * DEG;
  const lat = latDeg * DEG;
  const cosZenith =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  // atan2 form: well-conditioned at noon, where the arccos form is not.
  const azimuth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) -
        Math.tan(declination) * Math.cos(lat)
    ) + Math.PI;
  return {
    elevationRad: Math.PI / 2 - zenith,
    azimuthRad: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
  };
}

function requireDate(date: SolarDate): void {
  const { year, month, day } = date;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new RangeError(`not a calendar date: ${year}-${month}-${day}`);
  }
}

/** The instant of solar noon (the sun on the meridian) on a solar date. */
export function solarNoon(date: SolarDate, lngDeg: number): number {
  requireDate(date);
  requireFinite('longitude', lngDeg);
  // Mean noon at the longitude, then corrected by the equation of time at
  // the corrected instant (it changes < 30 s/day, so two passes converge).
  let noon =
    Date.UTC(date.year, date.month - 1, date.day, 12) -
    (lngDeg / 15) * 3_600_000;
  const mean = noon;
  for (let pass = 0; pass < 3; pass++) {
    noon = mean - sunAt(noon).eotMinutes * 60_000;
  }
  return noon;
}

/** The apparent solar midnight that STARTS a solar date (its lowest sun). */
export function solarMidnight(date: SolarDate, lngDeg: number): number {
  return solarNoon(date, lngDeg) - DAY_MS / 2;
}

const elevationDegAt = (ms: number, lat: number, lng: number) =>
  solarPosition(ms, lat, lng).elevationRad / DEG;

/**
 * The instant on a solar date when the sun crosses `elevationDeg`, on its
 * rising limb (solar midnight → noon) or its setting limb (noon → the next
 * midnight). `null` when it never does that day (midnight sun, polar night,
 * white nights below civil dusk). Bisection to 1 ms.
 */
export function timeAtElevation(
  date: SolarDate,
  latDeg: number,
  lngDeg: number,
  elevationDeg: number,
  limb: 'rising' | 'setting'
): number | null {
  requirePlace(latDeg, lngDeg);
  requireFinite('elevation', elevationDeg);
  const noon = solarNoon(date, lngDeg);
  let low = limb === 'rising' ? noon - DAY_MS / 2 : noon;
  let high = limb === 'rising' ? noon : noon + DAY_MS / 2;
  const above = (ms: number) =>
    elevationDegAt(ms, latDeg, lngDeg) >= elevationDeg;
  // Rising: below at the start, above at the end; setting: the reverse.
  const startAbove = above(low);
  const endAbove = above(high);
  if (limb === 'rising' ? startAbove || !endAbove : !startAbove || endAbove) {
    return null;
  }
  while (high - low > 1) {
    const mid = (low + high) / 2;
    if (above(mid) === endAbove) high = mid;
    else low = mid;
  }
  return high;
}
