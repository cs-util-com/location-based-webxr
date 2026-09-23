/**
 * The sun clock (plan 2026-09-23-2149, M2): where the real sun is, and how
 * the time control moves it.
 *
 * WHY THESE TESTS MATTER. The owner chose a REAL sun with a twilight-only
 * range, a skipped night, finer steps near the horizon and "show what the
 * real sun does" at the poles (DEC-SUN-1..8). Each of those is a rule a
 * plausible-looking bug would break silently: a step that lands at −9° shows
 * a black sky, a skip that lands mid-afternoon loses the dawn, a "forward then
 * back" that is not the identity makes the control feel broken, a polar night
 * that snaps backwards traps the day key. The stepping is a per-day ORDERED
 * STOP LIST (plan §7, finding 2), so the identity and the exact dusk landing
 * hold by construction; these tests hold them anyway.
 */
import {
  apparentSolarTimeHours,
  solarPosition,
  solarNoon,
} from "gps-plus-slam-app-framework/geo/solar-position";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SUN_CLOCK,
  bootInstant,
  formatSunReadout,
  instantAt,
  moveToDate,
  parseSolarTime,
  parseSunDate,
  relocate,
  stepSun,
  stopsFor,
  sunDateOf,
  type SunPlace,
} from "./sun-clock.js";

const COLOGNE: SunPlace = { lat: 50.9231, lng: 6.9445 };
const TOKYO: SunPlace = { lat: 35.68, lng: 139.77 };
const SVALBARD: SunPlace = { lat: 78.22, lng: 15.65 };
const LAPLAND: SunPlace = { lat: 67, lng: 25 };
/** White nights: the June sun never drops below −6° here (min ≈ −3.1°). */
const TRONDHEIM: SunPlace = { lat: 63.43, lng: 10.4 };
const SEP_23 = { year: 2026, month: 9, day: 23 };
const DEG = 180 / Math.PI;
/**
 * How far a stop may sit past its grid line: crossings are bisected to 1 ms
 * and the sun moves at most 15°/h (4.2e-6° per ms). The first tests used
 * 1e-6, tighter than that precision; they passed only because the stop
 * filter DROPPED such crossings, which was M2 review finding 1 (civil dusk
 * lost on a third of the days).
 */
const CROSSING_TOL_DEG = 1e-5;

const elevation = (ms: number, place: SunPlace) =>
  solarPosition(ms, place.lat, place.lng).elevationRad * DEG;
const azimuth = (ms: number, place: SunPlace) =>
  solarPosition(ms, place.lat, place.lng).azimuthRad * DEG;

describe("booting", () => {
  // DEC-SUN-4: the evening golden hour (3.5°, west of south). The e2e suite
  // pins Sep 23 because its boot sun (~3.5° / 265°) reproduces the old
  // plausible-day default (3.4° / 266°), so every measured threshold holds.
  it("boots at the evening golden hour", () => {
    const t = bootInstant(SEP_23, COLOGNE);
    expect(elevation(t, COLOGNE)).toBeCloseTo(SUN_CLOCK.bootElevationDeg, 3);
    expect(azimuth(t, COLOGNE)).toBeGreaterThan(260);
    expect(azimuth(t, COLOGNE)).toBeLessThan(270);
  });

  // DEC-SUN-6, a day whose sun never reaches 3.5° but has twilight: the
  // highest sun of the day (plan §7, finding 3).
  it("boots at noon where the sun never reaches the golden-hour height", () => {
    const date = { year: 2026, month: 12, day: 21 };
    const t = bootInstant(date, LAPLAND);
    expect(Math.abs(t - solarNoon(date, LAPLAND.lng))).toBeLessThan(60_000);
    expect(elevation(t, LAPLAND)).toBeGreaterThan(SUN_CLOCK.minElevationDeg);
  });

  // Polar night: no showable sun that day; the nearest day with one.
  it("boots on the nearest day with a showable sun in polar night", () => {
    const date = { year: 2026, month: 12, day: 21 };
    const t = bootInstant(date, SVALBARD);
    expect(elevation(t, SVALBARD)).toBeGreaterThanOrEqual(
      SUN_CLOCK.minElevationDeg - CROSSING_TOL_DEG,
    );
    expect(sunDateOf(t, SVALBARD)).not.toEqual(date);
  });

  // Midnight sun: it never drops to 3.5°, so there is no golden hour; the
  // lowest sun of the day stands in for it.
  it("boots at the lowest sun under the midnight sun", () => {
    const date = { year: 2026, month: 6, day: 21 };
    const t = bootInstant(date, SVALBARD);
    const stops = stopsFor(date, SVALBARD);
    const lowest = Math.min(...stops.map((s) => elevation(s, SVALBARD)));
    expect(elevation(t, SVALBARD)).toBeCloseTo(lowest, 1);
  });
});

describe("the stop list", () => {
  const days = [
    [SEP_23, COLOGNE],
    [{ year: 2026, month: 12, day: 21 }, COLOGNE],
    [{ year: 2026, month: 6, day: 21 }, COLOGNE],
    [{ year: 2026, month: 6, day: 21 }, SVALBARD],
    [{ year: 2026, month: 12, day: 21 }, LAPLAND],
    [{ year: 2026, month: 3, day: 20 }, TOKYO],
  ] as const;

  it.each(days)("is sorted and never below −6° (%o at %o)", (date, place) => {
    const stops = stopsFor(date, place);
    expect(stops.length).toBeGreaterThan(3);
    for (let i = 1; i < stops.length; i++)
      expect(stops[i]!).toBeGreaterThan(stops[i - 1]!);
    for (const s of stops) {
      expect(elevation(s, place)).toBeGreaterThanOrEqual(
        SUN_CLOCK.minElevationDeg - CROSSING_TOL_DEG,
      );
      expect(sunDateOf(s, place)).toEqual(date);
    }
  });

  // DEC-SUN-7: golden and blue hour are reachable in a few presses: near
  // the horizon consecutive stops differ by at most the fine step.
  it.each(days)("steps finely near the horizon (%o at %o)", (date, place) => {
    const stops = stopsFor(date, place);
    // Crossings are bisected to 1 ms, and the sun moves at most 15°/h
    // (4.2e-6° per ms), so each stop sits up to ~4e-6° past its line.
    const tooCoarse: string[] = [];
    for (let i = 1; i < stops.length; i++) {
      const [a, b] = [
        elevation(stops[i - 1]!, place),
        elevation(stops[i]!, place),
      ];
      const nearHorizon = Math.max(a, b) < SUN_CLOCK.fineBelowDeg;
      if (
        nearHorizon &&
        Math.abs(a - b) > SUN_CLOCK.fineStepDeg + CROSSING_TOL_DEG
      ) {
        tooCoarse.push(`${a.toFixed(3)}° → ${b.toFixed(3)}°`);
      }
    }
    expect(tooCoarse).toEqual([]);
  });

  // M2 review finding 1: the dusk crossing is bisected to 1 ms and can land a
  // hair BELOW −6° (up to ~4e-6°); an elevation filter at −6 − 1e-6 then
  // dropped civil dusk on about a third of the days, so the evening ended one
  // fine step early and "skip the night" jumped from −4.5°. Every day of a
  // year, at a mid and a low latitude.
  it.each([COLOGNE, TOKYO])(
    "keeps civil dawn and civil dusk on every day of the year (%o)",
    (place) => {
      const missing: string[] = [];
      for (let k = 0; k < 365; k++) {
        const d = new Date(Date.UTC(2026, 0, 1 + k));
        const date = {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
        };
        const stops = stopsFor(date, place);
        const first = elevation(stops[0]!, place);
        const last = elevation(stops[stops.length - 1]!, place);
        if (Math.abs(first + 6) > 1e-3 || Math.abs(last + 6) > 1e-3)
          missing.push(
            `${d.toISOString().slice(0, 10)}: ${first.toFixed(3)} … ${last.toFixed(3)}`,
          );
      }
      expect(missing).toEqual([]);
    },
  );

  // M2 review finding 7: white nights. The sun never reaches −6°, so there
  // is no night to skip: the day starts at its first instant (the solar
  // midnight) and the walk runs straight into the next day.
  it("runs through white nights without a skip", () => {
    const date = { year: 2026, month: 6, day: 21 };
    const stops = stopsFor(date, TRONDHEIM);
    expect(
      Math.min(...stops.map((s) => elevation(s, TRONDHEIM))),
    ).toBeGreaterThan(SUN_CLOCK.minElevationDeg);
    const next = stepSun(stops[stops.length - 1]!, TRONDHEIM, 1);
    expect(sunDateOf(next, TRONDHEIM)).toEqual({
      year: 2026,
      month: 6,
      day: 22,
    });
    // Straight on, not a jump: within one coarse step of the day boundary.
    expect(next - stops[stops.length - 1]!).toBeLessThan(
      SUN_CLOCK.coarseStepMs,
    );
    expect(elevation(bootInstant(date, TRONDHEIM), TRONDHEIM)).toBeCloseTo(
      SUN_CLOCK.bootElevationDeg,
      3,
    );
  });

  it("starts at civil dawn and ends at civil dusk on an ordinary day", () => {
    const stops = stopsFor(SEP_23, COLOGNE);
    expect(elevation(stops[0]!, COLOGNE)).toBeCloseTo(-6, 3);
    expect(elevation(stops[stops.length - 1]!, COLOGNE)).toBeCloseTo(-6, 3);
    expect(azimuth(stops[stops.length - 1]!, COLOGNE)).toBeGreaterThan(180);
    // The boot moment is a stop, so stepping from it is on the grid.
    expect(stops).toContain(bootInstant(SEP_23, COLOGNE));
  });
});

describe("stepping", () => {
  // Forward then back is the identity, from every stop (the e2e's "stepping
  // back returns to where it started" relies on it).
  it("returns to the same stop after forward then back", () => {
    for (const [date, place] of [
      [SEP_23, COLOGNE],
      [{ year: 2026, month: 6, day: 21 }, SVALBARD],
      [{ year: 2026, month: 12, day: 21 }, LAPLAND],
    ] as const) {
      for (const s of stopsFor(date, place)) {
        expect(stepSun(stepSun(s, place, 1), place, -1)).toBe(s);
        expect(stepSun(stepSun(s, place, -1), place, 1)).toBe(s);
      }
    }
  });

  // M2 review finding 2: after a date move or a relocation the instant is a
  // fresh bisection, which can sit a fraction of a millisecond from a stop.
  // A press that then "steps" onto that stop moves the sun by nothing, and
  // the control feels dead. A step skips any stop within a second.
  it("never steps onto a stop less than a second away", () => {
    const stops = stopsFor(SEP_23, COLOGNE);
    for (const s of stops.slice(1, -1)) {
      expect(stepSun(s - 0.5, COLOGNE, 1)).toBe(stepSun(s, COLOGNE, 1));
      expect(stepSun(s + 0.5, COLOGNE, -1)).toBe(stepSun(s, COLOGNE, -1));
    }
  });

  // DEC-SUN-5: past civil dusk the next stop is the NEXT day's civil dawn.
  it("skips the night from civil dusk to the next civil dawn, and back", () => {
    const stops = stopsFor(SEP_23, COLOGNE);
    const dusk = stops[stops.length - 1]!;
    const dawn = stepSun(dusk, COLOGNE, 1);
    expect(sunDateOf(dawn, COLOGNE)).toEqual({ year: 2026, month: 9, day: 24 });
    expect(elevation(dawn, COLOGNE)).toBeCloseTo(-6, 3);
    expect(azimuth(dawn, COLOGNE)).toBeLessThan(180);
    expect(stepSun(dawn, COLOGNE, -1)).toBe(dusk);
  });

  // Never outside the range, wherever and whenever the walk goes.
  it("never lands below −6°", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.constantFrom(COLOGNE, TOKYO, SVALBARD, LAPLAND),
        fc.array(fc.constantFrom(1 as const, -1 as const), {
          minLength: 1,
          maxLength: 40,
        }),
        (dayOfYear, place, steps) => {
          const d = new Date(Date.UTC(2026, 0, 1 + dayOfYear));
          let t = bootInstant(
            {
              year: d.getUTCFullYear(),
              month: d.getUTCMonth() + 1,
              day: d.getUTCDate(),
            },
            place,
          );
          for (const direction of steps) {
            t = stepSun(t, place, direction);
            expect(elevation(t, place)).toBeGreaterThanOrEqual(
              SUN_CLOCK.minElevationDeg - CROSSING_TOL_DEG,
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("changing the date or the place keeps the phase", () => {
  // The same elevation on the same limb (plan §7, finding 3): golden hour
  // stays golden hour, a day later or across the world.
  it("keeps the golden hour on the next day", () => {
    const t = bootInstant(SEP_23, COLOGNE);
    const next = moveToDate(t, COLOGNE, { year: 2026, month: 9, day: 24 });
    expect(sunDateOf(next, COLOGNE)).toEqual({ year: 2026, month: 9, day: 24 });
    expect(elevation(next, COLOGNE)).toBeCloseTo(3.5, 2);
    expect(azimuth(next, COLOGNE)).toBeGreaterThan(180);
  });

  // M2 review finding 3, a changed interpretation: where the phase does not
  // exist because the new day's sun never climbs that HIGH, the nearest phase
  // is that day's noon, not its golden hour. The first version re-booted, so
  // "a day later" at a September noon jumped to the evening (each autumn day's
  // noon is a little lower than the last).
  it("keeps noon at noon when the next day's sun is lower", () => {
    const noon = solarNoon(SEP_23, COLOGNE.lng);
    const next = { year: 2026, month: 9, day: 24 };
    expect(moveToDate(noon, COLOGNE, next)).toBe(solarNoon(next, COLOGNE.lng));
    const dec = { year: 2026, month: 12, day: 21 };
    expect(moveToDate(noon, COLOGNE, dec)).toBe(solarNoon(dec, COLOGNE.lng));
  });

  // And where it never drops that LOW (a golden hour carried into the
  // midnight sun), the lowest sun of the day, as the boot does.
  it("lands on the lowest sun when the new day never drops that low", () => {
    const golden = bootInstant({ year: 2026, month: 3, day: 1 }, SVALBARD);
    const june = { year: 2026, month: 6, day: 21 };
    expect(moveToDate(golden, SVALBARD, june)).toBe(
      bootInstant(june, SVALBARD),
    );
  });

  // Polar night snaps in the direction of travel, so "day +" never traps.
  it("snaps forward through polar night when moving forward", () => {
    const start = bootInstant({ year: 2026, month: 11, day: 1 }, SVALBARD);
    const target = { year: 2026, month: 12, day: 1 };
    const moved = moveToDate(start, SVALBARD, target);
    const landed = sunDateOf(moved, SVALBARD);
    expect(Date.UTC(landed.year, landed.month - 1, landed.day)).toBeGreaterThan(
      Date.UTC(2026, 11, 1),
    );
  });

  it("keeps the golden hour across a relocation", () => {
    const t = bootInstant(SEP_23, COLOGNE);
    const moved = relocate(t, COLOGNE, TOKYO);
    expect(elevation(moved, TOKYO)).toBeCloseTo(3.5, 2);
    expect(azimuth(moved, TOKYO)).toBeGreaterThan(180);
  });
});

describe("parsing and the readout", () => {
  it("parses the test pins and rejects anything else", () => {
    expect(parseSunDate("2026-09-23")).toEqual(SEP_23);
    expect(parseSunDate("2026-02-31")).toBeNull();
    expect(parseSunDate("23.09.2026")).toBeNull();
    // M2 review finding 4: a date typed digit by digit passes through years
    // like 0002; the solar model is validated for 1900-2100, so the pin and
    // the input accept 1800-2200 and nothing wider.
    expect(parseSunDate("0002-09-23")).toBeNull();
    expect(parseSunDate("1799-12-31")).toBeNull();
    expect(parseSunDate("2201-01-01")).toBeNull();
    expect(parseSunDate("1800-01-01")).toEqual({
      year: 1800,
      month: 1,
      day: 1,
    });
    expect(parseSunDate("2200-12-31")).toEqual({
      year: 2200,
      month: 12,
      day: 31,
    });
    expect(parseSunDate(null)).toBeNull();
    expect(parseSolarTime("17:36")).toBeCloseTo(17.6, 9);
    expect(parseSolarTime("24:00")).toBeNull();
    expect(parseSolarTime("7:5")).toBeNull();
    expect(parseSolarTime(null)).toBeNull();
  });

  // M2 review finding 6: the instant a `?time=HH:MM` pin boots at reads back
  // a hair BELOW the minute (floating point), and a plain floor showed 06:22
  // for a 06:23 pin. Every minute of a day round-trips.
  it("reads a pinned minute back as that minute", () => {
    const wrong: string[] = [];
    for (let m = 0; m < 24 * 60; m++) {
      const t = instantAt(SEP_23, COLOGNE, m / 60);
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      if (!formatSunReadout(t, COLOGNE).startsWith(hhmm))
        wrong.push(
          `${hhmm} → ${formatSunReadout(t, COLOGNE)} (${apparentSolarTimeHours(t, COLOGNE.lng) * 60})`,
        );
    }
    expect(wrong).toEqual([]);
  });

  // DEC-SUN-8: labelled local apparent solar time, never the wall clock.
  it("reads the golden hour as apparent solar time with its date", () => {
    const text = formatSunReadout(bootInstant(SEP_23, COLOGNE), COLOGNE);
    expect(text).toMatch(/^17:\d\d solar time, 23 Sep$/);
  });
});
