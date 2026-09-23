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
import { normalizeBearingDeg } from '../utils/bearing-degrees.js';

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

/** Declination (rad) and the equation of time (minutes) at an instant. */
function sunAt(ms: number): { declination: number; eotMinutes: number } {
  const jd = ms / DAY_MS + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = normalizeBearingDeg(280.46646 + t * (36000.76983 + t * 0.0003032));
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

/** Air conditions for refraction; defaults are the standard 1010 hPa, 10 °C. */
export interface RefractionConditions {
  readonly pressureHPa?: number;
  readonly temperatureC?: number;
}

/** Validated air conditions, with the standard defaults filled in. */
function airOf(conditions: RefractionConditions): {
  pressure: number;
  temperature: number;
} {
  const pressure = conditions.pressureHPa ?? 1010;
  const temperature = conditions.temperatureC ?? 10;
  if (!(Number.isFinite(pressure) && pressure >= 0)) {
    throw new RangeError(
      `pressure must be a finite number ≥ 0 hPa, got ${pressure}`
    );
  }
  if (!(Number.isFinite(temperature) && temperature > -273.15)) {
    throw new RangeError(
      `temperature must be above absolute zero, got ${temperature} °C`
    );
  }
  return { pressure, temperature };
}

/**
 * How far the air lifts a body at a GEOMETRIC elevation, degrees: the
 * APPARENT elevation is the geometric one plus this. Saemundsson's formula
 * (Meeus, "Astronomical Algorithms", ch. 16: the true-to-apparent direction;
 * Bennett's formula is its inverse), with JPL Horizons' convention below the
 * horizon, where the formula diverges near −5°: clamped at −1°, then tapered
 * linearly to zero at the nadir. Scaled by pressure / 1010 hPa and
 * 283 K / temperature (Meeus 16.4).
 *
 * ~0.57° at the horizon (a sun geometrically 0.57° below it looks exactly
 * on it), ~1′ at 45°, 0 at the zenith. For drawing on the REAL sky (an AR
 * sun icon); the sky model itself is geometric.
 */
export function atmosphericRefractionDeg(
  geometricElevationDeg: number,
  conditions: RefractionConditions = {}
): number {
  requireFinite('elevation', geometricElevationDeg);
  const { pressure, temperature } = airOf(conditions);
  const h = geometricElevationDeg;
  if (h < -90 || h > 90) return 0;
  const clamped = Math.max(h, -1);
  let arcMinutes = 1.02 / Math.tan((clamped + 10.3 / (clamped + 5.11)) * DEG);
  if (h < -1) arcMinutes *= (h + 90) / 89;
  return (arcMinutes / 60) * (pressure / 1010) * (283 / (273 + temperature));
}

/** Options for `solarPosition`. */
export interface SolarPositionOptions {
  /**
   * `true` (standard air) or conditions: return the APPARENT elevation, as
   * the eye and a camera see it. Default: geometric.
   */
  readonly refraction?: boolean | RefractionConditions;
}

/**
 * The sun's elevation and azimuth at an instant and a place: GEOMETRIC by
 * default, APPARENT (refracted) with `{ refraction }`. Refraction only lifts
 * the elevation; the azimuth is unchanged.
 */
export function solarPosition(
  ms: number,
  latDeg: number,
  lngDeg: number,
  options: SolarPositionOptions = {}
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
  const geometric = Math.PI / 2 - zenith;
  const refraction = options.refraction ?? false;
  const lift =
    refraction === false
      ? 0
      : atmosphericRefractionDeg(
          geometric / DEG,
          refraction === true ? {} : refraction
        ) * DEG;
  return {
    elevationRad: geometric + lift,
    azimuthRad: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
  };
}

/**
 * 00:00 UTC of a calendar date, in ms. Built with setUTCFullYear, so years
 * 0-99 stay real years (Date.UTC maps them to 1900-1999), and checked by a
 * round trip, so 31 Feb or month 13 is rejected instead of rolling over
 * (M1 review, finding 4).
 */
function utcStartOf(date: SolarDate): number {
  const { year, month, day } = date;
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  const ms = d.getTime();
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isFinite(ms) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new RangeError(`not a calendar date: ${year}-${month}-${day}`);
  }
  return ms;
}

/** The local apparent solar clock at an instant, as a pseudo-UTC epoch. */
const apparentEpoch = (ms: number, lngDeg: number) =>
  ms + lngDeg * 240_000 + sunAt(ms).eotMinutes * 60_000;

/**
 * The solar date an instant falls in at a longitude: the calendar date of
 * the local apparent solar clock, so the date changes exactly where
 * apparent solar time wraps through 00:00 (M1 review, finding 1).
 */
export function solarDateAt(ms: number, lngDeg: number): SolarDate {
  requireFinite('instant', ms);
  requireFinite('longitude', lngDeg);
  const d = new Date(Math.floor(apparentEpoch(ms, lngDeg)));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** The instant the apparent solar clock reads `offsetMs` into a date. */
function apparentInstant(
  date: SolarDate,
  lngDeg: number,
  offsetMs: number
): number {
  requireFinite('longitude', lngDeg);
  const target = utcStartOf(date) + offsetMs;
  // Fixed point of ms = target − lng·240 000 − EoT(ms): the equation of time
  // changes < 30 s/day, so each pass shrinks the error ~3000×.
  let ms = target - lngDeg * 240_000;
  const mean = ms;
  for (let pass = 0; pass < 3; pass++) {
    ms = mean - sunAt(ms).eotMinutes * 60_000;
  }
  return ms;
}

/**
 * The instant the local apparent solar clock reads `hours` on a solar date
 * (the inverse of `apparentSolarTimeHours` within that date). RangeError
 * for hours outside [0, 24).
 */
export function instantAtApparentSolarTime(
  date: SolarDate,
  lngDeg: number,
  hours: number
): number {
  requireFinite('hours', hours);
  if (hours < 0 || hours >= 24) {
    throw new RangeError(`hours must be in [0, 24), got ${hours}`);
  }
  return Math.max(
    solarMidnight(date, lngDeg),
    apparentInstant(date, lngDeg, hours * 3_600_000)
  );
}

/** The instant of solar noon (the sun on the meridian) on a solar date. */
export function solarNoon(date: SolarDate, lngDeg: number): number {
  return apparentInstant(date, lngDeg, DAY_MS / 2);
}

const sameDate = (a: SolarDate, b: SolarDate) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/**
 * The first millisecond of a solar date: apparent solar midnight, where
 * `solarDateAt` changes to this date. Consecutive dates TILE: one date ends
 * exactly where the next starts (the first version used noon − 12 h, which
 * left seams of up to 30 s; M1 review, finding 1).
 */
export function solarMidnight(date: SolarDate, lngDeg: number): number {
  let ms = Math.ceil(apparentInstant(date, lngDeg, 0));
  // Snap to the exact boundary; the solver lands within a millisecond.
  while (!sameDate(solarDateAt(ms, lngDeg), date)) ms += 1;
  while (sameDate(solarDateAt(ms - 1, lngDeg), date)) ms -= 1;
  return ms;
}

/** The calendar date after `date`. */
function nextDate(date: SolarDate): SolarDate {
  const d = new Date(utcStartOf(date) + DAY_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

const elevationDegAt = (ms: number, lat: number, lng: number) =>
  solarPosition(ms, lat, lng).elevationRad / DEG;

/**
 * The instant on a solar date when the sun crosses `elevationDeg`, on its
 * rising limb (solar midnight → noon) or its setting limb (noon → the next
 * midnight). `null` when it never does that day (midnight sun, polar night,
 * white nights below civil dusk). Bisection to 1 ms.
 *
 * Bisection assumes the elevation is monotone on each limb. It is NEARLY
 * so: the declination drifts during the day, and the measured excursions
 * are ≤ 2e-4° below 80° of latitude and ~2e-3° near the pole (M1 review,
 * finding 2). An elevation inside such an excursion can return `null`;
 * irrelevant for the thresholds the demos use (−6°, 3.5°) below ~85°.
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
  let low = limb === 'rising' ? solarMidnight(date, lngDeg) : noon;
  let high = limb === 'rising' ? noon : solarMidnight(nextDate(date), lngDeg);
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
