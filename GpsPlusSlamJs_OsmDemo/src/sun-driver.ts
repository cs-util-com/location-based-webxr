/**
 * The sun's drivers: the real clock (`?now=1`) and the timelapse
 * (`?timelapse=<seconds>`), the two ways the sun moves without a hand on
 * the time controls.
 *
 * Each driver is a thunk-shaped function `(dispatch, getState) => stop`:
 * it moves the store's sun with `sunMoved` and nothing else, so the view,
 * the sun controls and the look weights follow the store as they do for a
 * hand on the slider. The timers are its resources; `stop` ends them, and
 * the page stops a driver as soon as a hand moves the sun.
 *
 * The rules are pure and tested here (`clockInstant`, `timelapseSpan`,
 * `chooseSunDriver`); the timers take injected clocks for the tests.
 *
 * @see sun-driver.ts.md
 */

import {
  apparentSolarTimeHours,
  solarNoon,
  solarPosition,
  timeAtElevation,
} from "gps-plus-slam-app-framework/geo/solar-position";

import { sunMoved, type SunState } from "./osm-store.js";
import {
  bootInstant,
  daySpan,
  parseSolarTime,
  SUN_CLOCK,
  sunDateOf,
  type SunPlace,
} from "./sun-clock.js";

/** The drivers' rules, in one place. */
export const SUN_DRIVER = {
  /** The real clock moves the sun this often. */
  clockStepMs: 10_000,
  /** The timelapse starts with the sun this high on the setting limb... */
  timelapseFromDeg: 12,
  /** ...and ends at civil dusk, where the clock's stops end. */
  timelapseToDeg: SUN_CLOCK.minElevationDeg,
  /** The shortest and longest timelapse a link may ask for. */
  minTimelapseSeconds: 5,
  maxTimelapseSeconds: 3600,
} as const;

/** Where a driver's warnings go unless a test passes its own. */
// eslint-disable-next-line no-console -- the one report of a refused link
const warnInConsole = (message: string): void => console.warn(message);

/** What the sun drivers dispatch, and what they read. */
type SunDispatch = (action: ReturnType<typeof sunMoved>) => unknown;
type SunGetState = () => { readonly sun: SunState };
/** A driver: started with the store's `dispatch` and `getState`, returns its stop. */
export type SunDriver = (
  dispatch: SunDispatch,
  getState: SunGetState,
) => () => void;

const elevationDeg = (ms: number, place: SunPlace) =>
  (solarPosition(ms, place.lat, place.lng).elevationRad * 180) / Math.PI;

/**
 * The sun the real clock shows at `nowMs`: the real sun while it is at or
 * above civil twilight (-6 degrees, the clock's floor), else held at the
 * night's edge: civil dusk before solar midnight, civil dawn after it. In
 * polar night, where the date has no such edge, the date's boot sun
 * (`bootInstant`).
 */
export function clockInstant(nowMs: number, place: SunPlace): number {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`the clock's instant must be finite, got ${nowMs}`);
  }
  if (elevationDeg(nowMs, place) >= SUN_CLOCK.minElevationDeg) return nowMs;
  const date = sunDateOf(nowMs, place);
  const span = daySpan(date, place);
  if (span === null) return bootInstant(date, place);
  return apparentSolarTimeHours(nowMs, place.lng) >= 12
    ? span.endMs
    : span.startMs;
}

/**
 * The span the timelapse plays on the solar date of `instantMs`: from the
 * sun at `SUN_DRIVER.timelapseFromDeg` on the setting limb (solar noon
 * where it never climbs that high) to civil dusk (the date's last stop
 * where the sun never drops that low, a white night). Null in polar night.
 */
export function timelapseSpan(
  instantMs: number,
  place: SunPlace,
): { readonly startMs: number; readonly endMs: number } | null {
  const date = sunDateOf(instantMs, place);
  const day = daySpan(date, place);
  if (day === null) return null;
  const startMs =
    timeAtElevation(
      date,
      place.lat,
      place.lng,
      SUN_DRIVER.timelapseFromDeg,
      "setting",
    ) ?? solarNoon(date, place.lng);
  const endMs =
    timeAtElevation(
      date,
      place.lat,
      place.lng,
      SUN_DRIVER.timelapseToDeg,
      "setting",
    ) ?? day.endMs;
  return endMs > startMs ? { startMs, endMs } : null;
}

/**
 * The timelapse's length from the link: null when absent; a number of
 * seconds clamped to `SUN_DRIVER`'s range; null, with a warning, for
 * anything else.
 */
export function parseTimelapseSeconds(
  text: string | null,
  warn: (message: string) => void = warnInConsole,
): number | null {
  if (text === null) return null;
  const seconds = Number(text);
  if (text.trim() === "" || !Number.isFinite(seconds) || seconds <= 0) {
    warn(`timelapse "${text}" ignored: it needs a number of seconds`);
    return null;
  }
  return Math.min(
    SUN_DRIVER.maxTimelapseSeconds,
    Math.max(SUN_DRIVER.minTimelapseSeconds, seconds),
  );
}

/** Which driver the link starts. */
export type SunDriverChoice =
  | { readonly kind: "none" }
  | { readonly kind: "clock" }
  | { readonly kind: "timelapse"; readonly seconds: number };

/**
 * The driver the link asks for. A pinned time (`?time=`) wins over both
 * drivers, the timelapse over the clock; a driver that loses is named in a
 * warning, so a link that asks for two things says which one it got.
 */
export function chooseSunDriver(
  params: {
    readonly time: string | null;
    readonly timelapse: string | null;
    readonly now: string | null;
  },
  warn: (message: string) => void = warnInConsole,
): SunDriverChoice {
  const wantsClock = params.now === "1";
  const pinned = parseSolarTime(params.time) !== null;
  if (pinned) {
    if (params.timelapse !== null) warn("timelapse ignored: time pins the sun");
    if (wantsClock) warn("now=1 ignored: time pins the sun");
    return { kind: "none" };
  }
  const seconds = parseTimelapseSeconds(params.timelapse, warn);
  if (seconds !== null) {
    if (wantsClock) warn("now=1 ignored: the timelapse moves the sun");
    return { kind: "timelapse", seconds };
  }
  return wantsClock ? { kind: "clock" } : { kind: "none" };
}

/**
 * The real clock: moves the sun to `clockInstant(now)` at once and every
 * `SUN_DRIVER.clockStepMs`, at the place the store's sun is at then (a
 * re-anchor moves it along).
 */
export function followClock(
  options: {
    readonly now?: () => number;
    readonly every?: (tick: () => void, ms: number) => () => void;
  } = {},
): SunDriver {
  const now = options.now ?? (() => Date.now());
  const every =
    options.every ??
    ((tick, ms) => {
      const id = setInterval(tick, ms);
      return () => clearInterval(id);
    });
  return (dispatch, getState) => {
    const tick = () => {
      dispatch(sunMoved(clockInstant(now(), getState().sun.place)));
    };
    tick();
    return every(tick, SUN_DRIVER.clockStepMs);
  };
}

/**
 * The timelapse: plays `timelapseSpan` in `seconds`, looped, one sun move
 * per animation frame. The span is the one of the sun's date at the start,
 * and is found again at a new place (a re-anchor). Stops itself, with a
 * warning, where there is nothing to play (polar night).
 */
export function playTimelapse(options: {
  readonly seconds: number;
  readonly now?: () => number;
  readonly frame?: (callback: () => void) => () => void;
  readonly warn?: (message: string) => void;
}): SunDriver {
  const { seconds } = options;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`a timelapse needs a positive length, got ${seconds}`);
  }
  const now = options.now ?? (() => performance.now());
  const frame =
    options.frame ??
    ((callback) => {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    });
  const warn = options.warn ?? warnInConsole;
  return (dispatch, getState) => {
    const startedAt = now();
    let place = getState().sun.place;
    let span = timelapseSpan(getState().sun.instantMs, place);
    let cancel: () => void = () => undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      cancel();
    };
    const step = () => {
      if (stopped) return;
      const sun = getState().sun;
      if (sun.place.lat !== place.lat || sun.place.lng !== place.lng) {
        place = sun.place;
        span = timelapseSpan(sun.instantMs, place);
      }
      if (span === null) {
        warn("timelapse stopped: the sun does not set here on this date");
        stop();
        return;
      }
      const fraction = ((((now() - startedAt) / (seconds * 1000)) % 1) + 1) % 1;
      dispatch(sunMoved(span.startMs + fraction * (span.endMs - span.startMs)));
      cancel = frame(step);
    };
    step();
    return stop;
  };
}
