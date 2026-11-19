/**
 * The sun's drivers: the real clock and the timelapse.
 *
 * WHY THESE TESTS MATTER. Both run unattended on a screen nobody touches
 * (a wall, a review link), so a wrong rule shows as a city frozen at night
 * or a timelapse that never reaches dusk, and nobody is there to move the
 * slider. The rules are pinned at real places and dates, the precedence of
 * the link's three keys is pinned, and the timers are driven with fake
 * clocks so the tests see every dispatch.
 */

import {
  solarPosition,
  timeAtElevation,
} from "gps-plus-slam-app-framework/geo/solar-position";
import { describe, expect, it, vi } from "vitest";

import type { SunState } from "./osm-store.js";
import { daySpan, sunDateOf, SUN_CLOCK } from "./sun-clock.js";
import {
  chooseSunDriver,
  clockInstant,
  followClock,
  parseTimelapseSeconds,
  playTimelapse,
  SUN_DRIVER,
  timelapseSpan,
} from "./sun-driver.js";

const COLOGNE = { lat: 50.94, lng: 6.96 };
const TROMSO = { lat: 69.65, lng: 18.96 };
const DATE = { year: 2026, month: 9, day: 23 };
const elevation = (ms: number, place = COLOGNE) =>
  (solarPosition(ms, place.lat, place.lng).elevationRad * 180) / Math.PI;
const at = (deg: number, limb: "rising" | "setting") =>
  timeAtElevation(DATE, COLOGNE.lat, COLOGNE.lng, deg, limb)!;

describe("clockInstant", () => {
  it("is the real sun while it is at or above civil twilight", () => {
    const afternoon = at(20, "setting");
    expect(clockInstant(afternoon, COLOGNE)).toBe(afternoon);
    const twilight = at(-5, "setting");
    expect(clockInstant(twilight, COLOGNE)).toBe(twilight);
  });

  // WHY: below -6 degrees the sky does not render reliably; the clock holds
  // the night's edge instead: the dusk just past in the evening, the dawn
  // to come after midnight.
  it("holds civil dusk before midnight and civil dawn after it", () => {
    const span = daySpan(DATE, COLOGNE)!;
    const lateEvening = at(-6, "setting") + 2 * 3_600_000;
    const evening = clockInstant(lateEvening, COLOGNE);
    expect(evening).toBe(span.endMs);
    expect(elevation(evening)).toBeCloseTo(SUN_CLOCK.minElevationDeg, 2);
    const earlyMorning = at(-6, "rising") - 2 * 3_600_000;
    expect(sunDateOf(earlyMorning, COLOGNE)).toEqual(DATE);
    expect(clockInstant(earlyMorning, COLOGNE)).toBe(span.startMs);
  });

  it("shows the boot sun in polar night, and refuses a NaN instant", () => {
    const polarNoon = Date.UTC(2026, 11, 21, 11);
    const held = clockInstant(polarNoon, TROMSO);
    expect(elevation(held, TROMSO)).toBeGreaterThanOrEqual(
      SUN_CLOCK.minElevationDeg,
    );
    expect(() => clockInstant(Number.NaN, COLOGNE)).toThrow(RangeError);
  });
});

describe("timelapseSpan", () => {
  // WHY: the timelapse is for watching the looks change, so it must start
  // in daylight above the first blend and end where the clock ends.
  it("plays from 12 degrees on the setting limb to civil dusk", () => {
    const span = timelapseSpan(at(30, "rising"), COLOGNE)!;
    expect(elevation(span.startMs)).toBeCloseTo(SUN_DRIVER.timelapseFromDeg, 2);
    expect(elevation(span.endMs)).toBeCloseTo(SUN_DRIVER.timelapseToDeg, 2);
    expect(span.endMs).toBeGreaterThan(span.startMs);
  });

  it("starts at noon where the sun never climbs that high, and is null in polar night", () => {
    const winter = Date.UTC(2026, 0, 20, 11);
    const low = { lat: 66, lng: 18.96 };
    const span = timelapseSpan(winter, low)!;
    expect(elevation(span.startMs, low)).toBeLessThan(
      SUN_DRIVER.timelapseFromDeg,
    );
    expect(
      timelapseSpan(Date.UTC(2026, 11, 21, 11), { lat: 80, lng: 0 }),
    ).toBeNull();
  });
});

describe("chooseSunDriver and parseTimelapseSeconds", () => {
  const none = { time: null, timelapse: null, now: null };

  // WHY: a review link pins the time so a screenshot is reproducible; a
  // driver that moved the sun anyway would make the pin a lie, so the pin
  // wins, and the link is told which key lost.
  it("lets a pinned time win, then the timelapse, then the clock", () => {
    const warn = vi.fn();
    expect(
      chooseSunDriver({ time: "18:30", timelapse: "30", now: "1" }, warn),
    ).toEqual({ kind: "none" });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockClear();
    expect(
      chooseSunDriver({ ...none, timelapse: "30", now: "1" }, warn),
    ).toEqual({
      kind: "timelapse",
      seconds: 30,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(chooseSunDriver({ ...none, now: "1" }, warn)).toEqual({
      kind: "clock",
    });
    expect(chooseSunDriver({ ...none, now: "yes" }, warn)).toEqual({
      kind: "none",
    });
    expect(chooseSunDriver(none, warn)).toEqual({ kind: "none" });
  });

  it("clamps the length and ignores what is not a number of seconds", () => {
    const warn = vi.fn();
    expect(parseTimelapseSeconds(null, warn)).toBeNull();
    expect(parseTimelapseSeconds("1", warn)).toBe(
      SUN_DRIVER.minTimelapseSeconds,
    );
    expect(parseTimelapseSeconds("99999", warn)).toBe(
      SUN_DRIVER.maxTimelapseSeconds,
    );
    expect(parseTimelapseSeconds("45.5", warn)).toBe(45.5);
    for (const bad of ["", "abc", "-3", "0", "Infinity"]) {
      expect(parseTimelapseSeconds(bad, warn)).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });
});

/** A store stand-in: the sun, and every instant dispatched. */
function fakeStore(sun: SunState) {
  let state = { sun };
  const instants: number[] = [];
  return {
    instants,
    dispatch: (action: { type: string; payload: number }) => {
      instants.push(action.payload);
      state = { sun: { ...state.sun, instantMs: action.payload } };
    },
    getState: () => state,
    moveTo: (place: SunState["place"]) => {
      state = { sun: { ...state.sun, place } };
    },
  };
}

describe("followClock", () => {
  it("moves the sun at once and on every tick, until stopped", () => {
    const store = fakeStore({ instantMs: 0, place: COLOGNE });
    let tick: () => void = () => undefined;
    const stopTimer = vi.fn();
    const every = vi.fn((t: () => void, ms: number) => {
      tick = t;
      expect(ms).toBe(SUN_DRIVER.clockStepMs);
      return stopTimer;
    });
    let now = at(20, "setting");
    const stop = followClock({ now: () => now, every })(
      store.dispatch,
      store.getState,
    );
    expect(store.instants).toEqual([now]);
    now += SUN_DRIVER.clockStepMs;
    tick();
    expect(store.instants).toEqual([now - SUN_DRIVER.clockStepMs, now]);
    stop();
    expect(stopTimer).toHaveBeenCalledTimes(1);
  });
});

describe("playTimelapse", () => {
  function frames() {
    const queue: (() => void)[] = [];
    return {
      frame: (callback: () => void) => {
        queue.push(callback);
        return () => {
          const i = queue.indexOf(callback);
          if (i >= 0) queue.splice(i, 1);
        };
      },
      run: () => queue.shift()?.(),
      get pending() {
        return queue.length;
      },
    };
  }

  // WHY: the looks change between 12 and -6 degrees; a timelapse that ran
  // past dusk or stopped short would never show blue hour, and one that
  // did not loop would leave a review screen dark.
  it("plays the span in the given time, looped, one move per frame", () => {
    const store = fakeStore({ instantMs: at(30, "rising"), place: COLOGNE });
    const span = timelapseSpan(at(30, "rising"), COLOGNE)!;
    const f = frames();
    let t = 1000;
    const stop = playTimelapse({ seconds: 10, now: () => t, frame: f.frame })(
      store.dispatch,
      store.getState,
    );
    expect(store.instants.at(-1)).toBe(span.startMs);
    t += 5000;
    f.run();
    expect(store.instants.at(-1)).toBeCloseTo(
      (span.startMs + span.endMs) / 2,
      0,
    );
    t += 5000;
    f.run();
    expect(store.instants.at(-1)).toBe(span.startMs);
    stop();
    expect(f.pending).toBe(0);
    f.run();
    expect(store.instants).toHaveLength(3);
  });

  it("finds the span again at a new place, and stops where the sun does not set", () => {
    const store = fakeStore({ instantMs: at(30, "rising"), place: COLOGNE });
    const f = frames();
    const warn = vi.fn();
    playTimelapse({ seconds: 10, now: () => 0, frame: f.frame, warn })(
      store.dispatch,
      store.getState,
    );
    const tokyo = { lat: 35.68, lng: 139.69 };
    store.moveTo(tokyo);
    const shown = store.getState().sun.instantMs;
    f.run();
    expect(store.instants.at(-1)).toBe(timelapseSpan(shown, tokyo)!.startMs);
    // Polar night at 80 degrees: no span, so no move and a warning.
    const polar = {
      instantMs: Date.UTC(2026, 11, 21, 12),
      place: { lat: 80, lng: 0 },
    };
    const polarStore = fakeStore(polar);
    playTimelapse({ seconds: 10, now: () => 0, frame: f.frame, warn })(
      polarStore.dispatch,
      polarStore.getState,
    );
    expect(polarStore.instants).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a length that is not positive", () => {
    expect(() => playTimelapse({ seconds: 0 })).toThrow(RangeError);
    expect(() => playTimelapse({ seconds: Number.NaN })).toThrow(RangeError);
  });
});
