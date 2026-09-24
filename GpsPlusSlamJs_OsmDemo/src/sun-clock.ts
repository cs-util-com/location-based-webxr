/**
 * The sun clock: where the REAL sun is for the map's place and a date, and
 * how the time control moves it (plan 2026-09-23-2149, M2; owner decisions
 * DEC-SUN-1..8). Replaces the "plausible day" of `sun-position.ts`'s
 * retired `sunAt`.
 *
 * THE MODEL. An instant (epoch ms) at a place. Its date is the local
 * APPARENT solar date at the place's longitude (`solarDateAt`), so "today"
 * means today at the anchor, whatever the browser's time zone.
 *
 * THE CONTROL IS A PER-DAY ORDERED STOP LIST (plan §7, finding 2): the
 * elevation-grid crossings near the horizon on both limbs (fine steps, where
 * dawn and dusk change fastest; DEC-SUN-7), a clock grid above that, solar
 * noon, the golden hour, and civil dawn and dusk. A step is the next stop in
 * the direction of travel, walking over days with no showable sun (the
 * night, DEC-SUN-5; polar night). So forward-then-back is the identity, the
 * range never leaves −6° (DEC-SUN-1), and dusk is always landed on exactly.
 *
 * @see sun-clock.ts.md
 */

import {
  apparentSolarTimeHours,
  instantAtApparentSolarTime,
  solarDateAt,
  solarMidnight,
  solarNoon,
  solarPosition,
  timeAtElevation,
  type SolarDate,
} from "gps-plus-slam-app-framework/geo/solar-position";

/** The clock's rules, in one place. */
export const SUN_CLOCK = {
  /** DEC-SUN-1: civil twilight; the physical sky renders reliably to here. */
  minElevationDeg: -6,
  /**
   * DEC-SUN-13: the demo boots at the AFTERNOON sun at this elevation
   * (noon where the day never reaches it); it replaced DEC-SUN-4's 3.5°
   * evening golden hour, which opened the scene nearly dark.
   */
  bootElevationDeg: 20,
  /** DEC-SUN-7: the elevation step near the horizon... */
  fineStepDeg: 1.5,
  /** ...below this elevation; above it the clock grid takes over. */
  fineBelowDeg: 12,
  /** The clock step above `fineBelowDeg`. */
  coarseStepMs: 30 * 60_000,
  /** Stops closer than this are one stop. */
  mergeMs: 60_000,
  /** How far a polar night is searched for a day with a showable sun. */
  maxDaySearch: 200,
  /**
   * A step skips stops closer than this (M2 review finding 2): after a date
   * move the instant is a fresh bisection that can sit a fraction of a
   * millisecond from a stop, and "stepping" onto it moves nothing. Far below
   * `mergeMs`, so forward-then-back stays the identity.
   */
  minStepMs: 1_000,
  /** The years the date pin and the input accept (the model: 1900-2100). */
  minYear: 1800,
  maxYear: 2200,
} as const;

/** The place the sun is computed for (the scene anchor). */
export interface SunPlace {
  readonly lat: number;
  readonly lng: number;
}

const RAD_TO_DEG = 180 / Math.PI;

const elevationDeg = (ms: number, place: SunPlace) =>
  solarPosition(ms, place.lat, place.lng).elevationRad * RAD_TO_DEG;

/** The solar date of an instant at a place. */
export function sunDateOf(ms: number, place: SunPlace): SolarDate {
  return solarDateAt(ms, place.lng);
}

function addDays(date: SolarDate, days: number): SolarDate {
  const d = new Date(0);
  d.setUTCFullYear(date.year, date.month - 1, date.day + days);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** −6, −4.5, …, 12: the elevations the fine steps sit on. */
const FINE_GRID: readonly number[] = (() => {
  const out: number[] = [];
  const { minElevationDeg, fineBelowDeg, fineStepDeg } = SUN_CLOCK;
  const count = Math.round((fineBelowDeg - minElevationDeg) / fineStepDeg);
  for (let i = 0; i <= count; i++) out.push(minElevationDeg + i * fineStepDeg);
  return out;
})();

/**
 * The stops of one solar date at a place, ascending; empty when the sun
 * never reaches −6° that day (polar night).
 */
export function stopsFor(date: SolarDate, place: SunPlace): number[] {
  const start = solarMidnight(date, place.lng);
  const end = solarMidnight(addDays(date, 1), place.lng);
  // CROSSINGS ARE KEPT UNFILTERED (M2 review finding 1): they lie on the
  // grid by construction, and a 1 ms bisection can land a crossing of −6° up
  // to ~4e-6° BELOW it, which an elevation filter dropped on about a third of
  // the days, taking civil dusk with it. Only the other candidates (the
  // day's start and noon) are tested for being showable.
  const crossings: number[] = [];
  for (const elevation of [...FINE_GRID, SUN_CLOCK.bootElevationDeg]) {
    for (const limb of ["rising", "setting"] as const) {
      const t = timeAtElevation(date, place.lat, place.lng, elevation, limb);
      if (t !== null) crossings.push(t);
    }
  }
  const others = [start, solarNoon(date, place.lng)].filter(
    (t) => elevationDeg(t, place) >= SUN_CLOCK.minElevationDeg,
  );
  for (let t = start; t < end; t += SUN_CLOCK.coarseStepMs) {
    if (elevationDeg(t, place) > SUN_CLOCK.fineBelowDeg) others.push(t);
  }
  const showable = [...crossings, ...others]
    .filter((t) => t >= start && t < end)
    .sort((a, b) => a - b);
  const stops: number[] = [];
  for (const t of showable) {
    const last = stops[stops.length - 1];
    if (last === undefined || t - last >= SUN_CLOCK.mergeMs) stops.push(t);
  }
  // The boot moment is always a stop in its own right (the boot lands on
  // it): if merging dropped it for a neighbour, restore the exact instant.
  const golden = timeAtElevation(
    date,
    place.lat,
    place.lng,
    SUN_CLOCK.bootElevationDeg,
    "setting",
  );
  if (golden !== null && !stops.includes(golden)) {
    const i = stops.findIndex((s) => Math.abs(s - golden) < SUN_CLOCK.mergeMs);
    if (i >= 0) stops[i] = golden;
  }
  return stops;
}

/**
 * Where the clock boots on a date (DEC-SUN-4, DEC-SUN-6): the evening
 * golden hour; else the highest sun (it never reaches 3.5°); else the lowest
 * sun (midnight sun, it never drops to 3.5°); in polar night, the nearest
 * day with a showable sun, searched in `direction` (0: both ways, forward
 * first).
 */
export function bootInstant(
  date: SolarDate,
  place: SunPlace,
  direction: -1 | 0 | 1 = 0,
): number {
  const golden = timeAtElevation(
    date,
    place.lat,
    place.lng,
    SUN_CLOCK.bootElevationDeg,
    "setting",
  );
  if (golden !== null) return golden;
  const stops = stopsFor(date, place);
  if (stops.length > 0) {
    const noon = solarNoon(date, place.lng);
    if (elevationDeg(noon, place) < SUN_CLOCK.bootElevationDeg) return noon;
    return stops.reduce((low, s) =>
      elevationDeg(s, place) < elevationDeg(low, place) ? s : low,
    );
  }
  for (let k = 1; k <= SUN_CLOCK.maxDaySearch; k++) {
    for (const sign of direction === 0 ? [1, -1] : [direction]) {
      const day = addDays(date, sign * k);
      if (stopsFor(day, place).length > 0) return bootInstant(day, place);
    }
  }
  throw new RangeError(
    `no showable sun within ${SUN_CLOCK.maxDaySearch} days at ${place.lat}°`,
  );
}

/** The next stop after (direction 1) or before (−1) an instant. */
export function stepSun(
  ms: number,
  place: SunPlace,
  direction: -1 | 1,
): number {
  const date = sunDateOf(ms, place);
  const today = stopsFor(date, place);
  const { minStepMs } = SUN_CLOCK;
  const here =
    direction === 1
      ? today.find((s) => s >= ms + minStepMs)
      : [...today].reverse().find((s) => s <= ms - minStepMs);
  if (here !== undefined) return here;
  for (let k = 1; k <= SUN_CLOCK.maxDaySearch; k++) {
    const stops = stopsFor(addDays(date, direction * k), place);
    if (stops.length > 0)
      return direction === 1 ? stops[0]! : stops[stops.length - 1]!;
  }
  return ms;
}

/** Elevation and limb of an instant: its "phase" in the day. */
function phaseOf(ms: number, place: SunPlace) {
  const date = sunDateOf(ms, place);
  return {
    date,
    elevation: elevationDeg(ms, place),
    limb:
      ms < solarNoon(date, place.lng)
        ? ("rising" as const)
        : ("setting" as const),
  };
}

const dayNumber = (d: SolarDate) =>
  Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

/**
 * The instant on `date` nearest a phase (plan §7 finding 3; M2 review
 * finding 3): the same elevation on the same limb; where the sun never
 * climbs that high, the date's noon (the highest sun, so noon stays noon as
 * autumn days lower it); where it never drops that low, the date's boot
 * (the lowest sun); in polar night, the boot's snap in `direction`.
 */
function nearestPhase(
  date: SolarDate,
  place: SunPlace,
  phase: ReturnType<typeof phaseOf>,
  direction: -1 | 0 | 1,
): number {
  const t = timeAtElevation(
    date,
    place.lat,
    place.lng,
    phase.elevation,
    phase.limb,
  );
  if (t !== null) return t;
  const noon = solarNoon(date, place.lng);
  const noonElevation = elevationDeg(noon, place);
  if (
    noonElevation < phase.elevation &&
    noonElevation >= SUN_CLOCK.minElevationDeg
  ) {
    return noon;
  }
  return bootInstant(date, place, direction);
}

/** The same phase (elevation on the same limb) on another date. */
export function moveToDate(
  ms: number,
  place: SunPlace,
  date: SolarDate,
): number {
  const phase = phaseOf(ms, place);
  const direction = Math.sign(dayNumber(date) - dayNumber(phase.date)) as
    -1 | 0 | 1;
  return nearestPhase(date, place, phase, direction);
}

/** The same phase at another place, on the same solar date. */
export function relocate(ms: number, from: SunPlace, to: SunPlace): number {
  const phase = phaseOf(ms, from);
  return nearestPhase(phase.date, to, phase, 0);
}

/**
 * "YYYY-MM-DD" → a date that exists within `minYear`..`maxYear`, else null
 * (the `?date=` test pin and the date input, which passes through years
 * like 0002 while a year is typed digit by digit).
 */
export function parseSunDate(text: string | null): SolarDate | null {
  const m = text === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m === null) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (date.year < SUN_CLOCK.minYear || date.year > SUN_CLOCK.maxYear) {
    return null;
  }
  const check = addDays(date, 0);
  return check.year === date.year &&
    check.month === date.month &&
    check.day === date.day
    ? date
    : null;
}

/** "HH:MM" apparent solar time → hours, else null (the `?time=` test pin). */
export function parseSolarTime(text: string | null): number | null {
  const m = text === null ? null : /^(\d{2}):(\d{2})$/.exec(text);
  if (m === null) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? hours + minutes / 60 : null;
}

/** The instant a date's apparent solar clock reads `hours` at a place. */
export function instantAt(
  date: SolarDate,
  place: SunPlace,
  hours: number,
): number {
  return instantAtApparentSolarTime(date, place.lng, hours);
}

/**
 * "15:47 solar time" (DEC-SUN-8: labelled, never the wall clock). No date:
 * the date field beside it shows the date (the owner, 2026-09-24).
 */
export function formatSunReadout(ms: number, place: SunPlace): string {
  // The epsilon (M2 review finding 6): an instant booted at HH:MM reads
  // back a hair below the minute in floating point, and a plain floor
  // showed the minute before. 1e-6 min is 60 µs, far below a displayed one.
  const minutes = apparentSolarTimeHours(ms, place.lng) * 60;
  const total = Math.floor(minutes + 1e-6) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm} solar time`;
}

/**
 * Today on the VIEWER's own calendar (DEC-SUN-14): the device's local date.
 * The sun is still computed for the map's place; only "which day" follows
 * the viewer, because "today at the map's place" read as a bug from another
 * time zone (New York on the evening of the 23rd, seen at 02:00 on the 24th).
 */
export function viewerToday(now: Date): SolarDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/**
 * The span the time slider covers on a date (DEC-SUN-15): civil dawn to
 * civil dusk, i.e. the day's first to last stop; the whole showable day
 * under a midnight sun; `null` in polar night (the clock never lands there).
 */
export function daySpan(
  date: SolarDate,
  place: SunPlace,
): { readonly startMs: number; readonly endMs: number } | null {
  const stops = stopsFor(date, place);
  if (stops.length === 0) return null;
  return { startMs: stops[0]!, endMs: stops[stops.length - 1]! };
}

/** The instant at a slider position in [0, 1] (clamped), linear in time. */
export function sliderToInstant(
  fraction: number,
  date: SolarDate,
  place: SunPlace,
): number {
  if (!Number.isFinite(fraction)) {
    throw new RangeError(`slider position must be finite, got ${fraction}`);
  }
  const span = daySpan(date, place);
  if (span === null) return bootInstant(date, place);
  const p = Math.min(1, Math.max(0, fraction));
  return span.startMs + p * (span.endMs - span.startMs);
}

/** The slider position of an instant within its own date's span, [0, 1]. */
export function instantToSlider(ms: number, place: SunPlace): number {
  const span = daySpan(sunDateOf(ms, place), place);
  if (span === null || span.endMs === span.startMs) return 0;
  return Math.min(
    1,
    Math.max(0, (ms - span.startMs) / (span.endMs - span.startMs)),
  );
}
