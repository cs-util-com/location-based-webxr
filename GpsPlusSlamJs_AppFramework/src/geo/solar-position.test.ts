/**
 * Tests for the real sun (plan 2026-09-23-2149, M1; DEC-SUN-2).
 *
 * Why this file matters: the sun drives every light in the demos' sky, and
 * a wrong one is not an error but a plausible-looking lie (a sunset in the
 * east, a winter noon at 60°). The algorithm is checked three ways, none of
 * them against itself:
 * - physical anchors that need no library (noon altitude at an equinox and
 *   a solstice, a due-south noon);
 * - astronomy-engine (VSOP87 with nutation and ΔT), a test-only dependency,
 *   over a sweep of centuries, latitudes and hours, by ANGULAR separation
 *   (raw azimuth is ill-conditioned near the zenith);
 * - event times against astronomy-engine's own altitude search.
 * A first plan used `suncalc` as the oracle; it was measured 0.22° off in
 * 2026 and 1.2° in 1900, so a correct implementation would have failed.
 */
import * as Astronomy from 'astronomy-engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  apparentSolarTimeHours,
  atmosphericRefractionDeg,
  instantAtApparentSolarTime,
  solarMidnight,
  solarNoon,
  solarDateAt,
  solarPosition,
  timeAtElevation,
  type SolarDate,
} from './solar-position.js';

const DEG = Math.PI / 180;
const COLOGNE = { lat: 50.9375, lng: 6.9603 };

/** astronomy-engine's GEOMETRIC (unrefracted) altitude/azimuth, degrees. */
function reference(ms: number, lat: number, lng: number) {
  const time = Astronomy.MakeTime(new Date(ms));
  const observer = new Astronomy.Observer(lat, lng, 0);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  const hor = Astronomy.Horizon(time, observer, eq.ra, eq.dec);
  return { altitude: hor.altitude, azimuth: hor.azimuth };
}

/** Great-circle angle between two alt/az directions, degrees. */
function separationDeg(
  a: { altitude: number; azimuth: number },
  b: { altitude: number; azimuth: number }
) {
  const v = (d: { altitude: number; azimuth: number }) => {
    const alt = d.altitude * DEG;
    const az = d.azimuth * DEG;
    return [
      Math.cos(alt) * Math.sin(az),
      Math.sin(alt),
      Math.cos(alt) * Math.cos(az),
    ];
  };
  const [p, q] = [v(a), v(b)];
  const dot = p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG;
}

function mine(ms: number, lat: number, lng: number) {
  const p = solarPosition(ms, lat, lng);
  return { altitude: p.elevationRad / DEG, azimuth: p.azimuthRad / DEG };
}

describe('solarPosition: physical anchors (no library)', () => {
  // At solar noon the sun is due south (north of the tropics) and stands at
  // 90° − latitude + declination. At the 2026 March equinox (20 Mar 14:46
  // UTC) the declination is ~0 (it moves ~0.4°/day); at the June solstice
  // (21 Jun 08:24 UTC) it is +23.44°.
  it('stands at 90° − latitude at an equinox noon, due south', () => {
    const noon = solarNoon({ year: 2026, month: 3, day: 20 }, COLOGNE.lng);
    const p = mine(noon, COLOGNE.lat, COLOGNE.lng);
    expect(Math.abs(p.altitude - (90 - COLOGNE.lat))).toBeLessThan(0.3);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(0.05);
  });

  it('stands at 90° − latitude + 23.44° at the June solstice noon', () => {
    const noon = solarNoon({ year: 2026, month: 6, day: 21 }, COLOGNE.lng);
    const p = mine(noon, COLOGNE.lat, COLOGNE.lng);
    expect(Math.abs(p.altitude - (90 - COLOGNE.lat + 23.44))).toBeLessThan(
      0.05
    );
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(0.05);
  });

  // The convention the renderer relies on (sunDirection: clockwise from
  // north): the sun rises in the east (azimuth < 180) and sets in the west.
  it('rises in the east and sets in the west', () => {
    const day = { year: 2026, month: 9, day: 23 };
    const dawn = timeAtElevation(day, COLOGNE.lat, COLOGNE.lng, 2, 'rising');
    const dusk = timeAtElevation(day, COLOGNE.lat, COLOGNE.lng, 2, 'setting');
    expect(dawn).not.toBeNull();
    expect(dusk).not.toBeNull();
    expect(mine(dawn!, COLOGNE.lat, COLOGNE.lng).azimuth).toBeLessThan(180);
    expect(mine(dusk!, COLOGNE.lat, COLOGNE.lng).azimuth).toBeGreaterThan(180);
  });
});

describe('solarPosition against astronomy-engine', () => {
  // NOAA/Meeus vs VSOP87 was measured ≤ 0.019° over 1800-2100 in the plan
  // review; the bound 0.05° leaves 2.6× headroom. Swept over two centuries,
  // polar to equatorial latitudes, every longitude and hour.
  it('agrees within 0.05° of angular separation, 1900-2100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2100, 11, 31) }),
        fc.double({ min: -89.9, max: 89.9, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (ms, lat, lng) => {
          const sep = separationDeg(
            mine(ms, lat, lng),
            reference(ms, lat, lng)
          );
          expect(sep).toBeLessThan(0.05);
        }
      ),
      { numRuns: 400 }
    );
  });
});

describe('solar day events', () => {
  // Event times against astronomy-engine's own altitude search (a separate
  // root-finder on a separate model), within one minute. The events used by
  // the sun clock: civil dusk and dawn (−6°) and the 3.5° golden hour.
  it.each([
    [COLOGNE.lat, COLOGNE.lng, 2026, 9, 23],
    [COLOGNE.lat, COLOGNE.lng, 2026, 12, 21],
    [22.28, 114.16, 2026, 6, 21],
    [-22.95, -43.21, 2026, 12, 21],
  ])(
    'matches astronomy-engine at %s, %s on %s-%s-%s',
    (lat, lng, year, month, day) => {
      const date: SolarDate = { year, month, day };
      const observer = new Astronomy.Observer(lat, lng, 0);
      const midnight = solarMidnight(date, lng);
      for (const [elevation, limb] of [
        [-6, 'rising'],
        [-6, 'setting'],
        [3.5, 'setting'],
      ] as const) {
        const t = timeAtElevation(date, lat, lng, elevation, limb);
        expect(t).not.toBeNull();
        const found = Astronomy.SearchAltitude(
          Astronomy.Body.Sun,
          observer,
          limb === 'rising' ? +1 : -1,
          new Date(midnight),
          1.1,
          elevation
        );
        expect(found).not.toBeNull();
        expect(Math.abs(t! - found!.date.getTime())).toBeLessThan(60_000);
      }
    }
  );

  // Midnight sun: 78° N in June never drops to −6°, so there is no civil
  // dusk; polar night: in December its highest sun is ~−11°, so it never
  // rises to −6° (no civil dawn). Both answer null rather than invent.
  it('answers null where the sun never crosses the elevation', () => {
    const svalbard = { lat: 78.22, lng: 15.65 };
    expect(
      timeAtElevation(
        { year: 2026, month: 6, day: 21 },
        svalbard.lat,
        svalbard.lng,
        -6,
        'setting'
      )
    ).toBeNull();
    expect(
      timeAtElevation(
        { year: 2026, month: 12, day: 21 },
        svalbard.lat,
        svalbard.lng,
        -6,
        'rising'
      )
    ).toBeNull();
  });

  // White nights (60-64° N in June): a sunset but NO civil dusk; the plan
  // review named this case (Helsinki's minimum is −6.39°, Trondheim's
  // −3.13° on 21 Jun).
  it('knows Trondheim has a sunset but no civil dusk at midsummer', () => {
    const trondheim = { lat: 63.43, lng: 10.4 };
    const day = { year: 2026, month: 6, day: 21 };
    expect(
      timeAtElevation(day, trondheim.lat, trondheim.lng, 0, 'setting')
    ).not.toBeNull();
    expect(
      timeAtElevation(day, trondheim.lat, trondheim.lng, -6, 'setting')
    ).toBeNull();
  });

  // Ordering within one solar day, wherever everything exists.
  it('orders civil dawn < noon < golden hour < civil dusk', () => {
    // Counted, so a mutant that makes a limb always null cannot pass this
    // vacuously (latitudes within ±55° always have all three events).
    let checked = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.double({ min: -55, max: 55, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (dayOfYear, lat, lng) => {
          const d = new Date(Date.UTC(2026, 0, 1 + dayOfYear));
          const date = {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
          };
          const dawn = timeAtElevation(date, lat, lng, -6, 'rising');
          const golden = timeAtElevation(date, lat, lng, 3.5, 'setting');
          const dusk = timeAtElevation(date, lat, lng, -6, 'setting');
          const noon = solarNoon(date, lng);
          if (dawn === null || golden === null || dusk === null) return;
          checked += 1;
          expect(dawn).toBeLessThan(noon);
          expect(noon).toBeLessThan(golden);
          expect(golden).toBeLessThan(dusk);
        }
      ),
      { numRuns: 200 }
    );
    expect(checked).toBe(200);
  });
});

describe('apparentSolarTimeHours', () => {
  // 12:00 at solar noon, by definition, anywhere.
  it('reads 12:00 at solar noon', () => {
    for (const lng of [-120, 0, 6.96, 114.16]) {
      const noon = solarNoon({ year: 2026, month: 9, day: 23 }, lng);
      expect(apparentSolarTimeHours(noon, lng)).toBeCloseTo(12, 3);
    }
  });

  it('stays within [0, 24)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1950, 0, 1), max: Date.UTC(2050, 0, 1) }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (ms, lng) => {
          const h = apparentSolarTimeHours(ms, lng);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(24);
        }
      )
    );
  });
});

describe('validation', () => {
  it('rejects non-finite input and latitudes outside ±90°', () => {
    expect(() => solarPosition(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => solarPosition(0, 91, 0)).toThrow(RangeError);
    expect(() => solarPosition(0, 0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError
    );
  });
});

describe('solar dates (M1 review, findings 1 and 4)', () => {
  // THE SOLAR DATE OF AN INSTANT, which the sun clock needs to know "today"
  // at the anchor: it changes exactly where apparent solar time wraps, at
  // the solarMidnight that starts each date, so consecutive days TILE (the
  // first version's noon − 12 h left seams of up to 30 s, where an instant
  // near midnight could belong to two solar days or to none).
  it('tiles the days: each date starts where the previous one ends', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3650 }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (offset, lng) => {
          const d = new Date(Date.UTC(2020, 0, 1 + offset));
          const date = {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
          };
          const n = new Date(Date.UTC(2020, 0, 2 + offset));
          const next = {
            year: n.getUTCFullYear(),
            month: n.getUTCMonth() + 1,
            day: n.getUTCDate(),
          };
          const start = solarMidnight(date, lng);
          expect(solarDateAt(start, lng)).toEqual(date);
          expect(solarDateAt(start - 1, lng)).not.toEqual(date);
          expect(solarDateAt(solarNoon(date, lng), lng)).toEqual(date);
          const nextStart = solarMidnight(next, lng);
          expect(solarDateAt(nextStart - 1, lng)).toEqual(date);
          expect(solarDateAt(nextStart, lng)).toEqual(next);
          expect(
            apparentSolarTimeHours(start, lng) < 0.001 ||
              apparentSolarTimeHours(start, lng) > 23.999
          ).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('rejects dates that do not exist, and years it cannot represent', () => {
    expect(() => solarNoon({ year: 2026, month: 2, day: 31 }, 0)).toThrow(
      RangeError
    );
    expect(() => solarNoon({ year: 2026, month: 13, day: 1 }, 0)).toThrow(
      RangeError
    );
    expect(() => solarNoon({ year: 2026.5, month: 1, day: 1 }, 0)).toThrow(
      RangeError
    );
    expect(() => solarNoon({ year: 300000, month: 1, day: 1 }, 0)).toThrow(
      RangeError
    );
    // Years 0-99 are real years, not 1900-1999 (a Date.UTC trap).
    const early = solarNoon({ year: 50, month: 6, day: 1 }, 0);
    expect(new Date(early).getUTCFullYear()).toBe(50);
  });
});

describe('high-latitude winter (plan review, finding 3)', () => {
  // 67° N on 21 Dec: the sun never rises (geometric centre, highest ~−0.4°)
  // but civil dawn and dusk exist; the sun clock must still find a day.
  it('has civil twilight but no geometric sunrise at 67° N in December', () => {
    const day = { year: 2026, month: 12, day: 21 };
    expect(timeAtElevation(day, 67, 25, -6, 'rising')).not.toBeNull();
    expect(timeAtElevation(day, 67, 25, -6, 'setting')).not.toBeNull();
    expect(timeAtElevation(day, 67, 25, 0, 'rising')).toBeNull();
  });
});

describe('instantAtApparentSolarTime (M2: the ?time= pin and the clock)', () => {
  // The inverse of apparentSolarTimeHours on a solar date: the instant the
  // local apparent solar clock reads `hours`. Round trip, anywhere.
  it('inverts apparentSolarTimeHours within a millisecond', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3650 }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 23.999, noNaN: true }),
        (offset, lng, hours) => {
          const d = new Date(Date.UTC(2020, 0, 1 + offset));
          const date = {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
          };
          const ms = instantAtApparentSolarTime(date, lng, hours);
          expect(apparentSolarTimeHours(ms, lng)).toBeCloseTo(hours, 5);
          expect(solarDateAt(ms, lng)).toEqual(date);
        }
      ),
      { numRuns: 300 }
    );
  });

  // Found by the property above (seed 1437293481, counterexample: day 263
  // of 2020, longitude 0, 00:00): the clock and the date were computed by
  // two formulas that disagree by ~1 ns at a date boundary, so the day's
  // first instant read 23:59:59.999... of the PREVIOUS day, and a `?time=`
  // pin of 00:00 would boot a day early. Every day of a year, at several
  // longitudes, deterministically.
  it('reads the first instant of every solar date as 00:00 of that date', () => {
    const wrong: string[] = [];
    for (const lng of [0, 6.9445, -122.4, 139.77, 180, -180]) {
      for (let k = 0; k < 366; k++) {
        const d = new Date(Date.UTC(2020, 0, 1 + k));
        const date = {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
        };
        const midnight = solarMidnight(date, lng);
        const hours = apparentSolarTimeHours(midnight, lng);
        if (
          !(hours < 1e-6) ||
          JSON.stringify(solarDateAt(midnight, lng)) !== JSON.stringify(date)
        )
          wrong.push(`${lng} ${d.toISOString().slice(0, 10)}: ${hours}`);
        const atZero = instantAtApparentSolarTime(date, lng, 0);
        if (!(apparentSolarTimeHours(atZero, lng) < 1e-6))
          wrong.push(
            `${lng} ${d.toISOString().slice(0, 10)} pin: ${apparentSolarTimeHours(atZero, lng)}`
          );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rejects hours outside [0, 24)', () => {
    const date = { year: 2026, month: 9, day: 23 };
    expect(() => instantAtApparentSolarTime(date, 0, 24)).toThrow(RangeError);
    expect(() => instantAtApparentSolarTime(date, 0, -1)).toThrow(RangeError);
    expect(() => instantAtApparentSolarTime(date, 0, Number.NaN)).toThrow(
      RangeError
    );
  });
});

describe('atmospheric refraction (the APPARENT sun, for an AR overlay)', () => {
  // The owner's use case: a virtual sun icon over the REAL sun in an AR
  // view. The air lifts the sun near the horizon by up to ~0.57°, more than
  // its own diameter, so the geometric position (right for the sky model)
  // would draw the icon visibly below the real disc at sunset.
  //
  // Saemundsson's formula (Meeus ch. 16: the true-to-apparent direction;
  // Bennett's is its inverse) at standard conditions, 1010 hPa and 10 °C.

  // THE TEXTBOOK ANCHOR, independent of any library: the sun's centre looks
  // exactly on the horizon when it is geometrically ~0.57° below it (the
  // 0.567° in the standard −0.833° sunrise, the rest being the radius).
  it('puts an apparent altitude of 0 at a geometric −0.57°', () => {
    const r = atmosphericRefractionDeg(-0.57);
    expect(Math.abs(-0.57 + r)).toBeLessThan(0.02);
  });

  // About 1 arc-minute at 45° (Meeus), and nothing at the zenith.
  it('is ~1′ at 45° and vanishes at the zenith', () => {
    expect(atmosphericRefractionDeg(45)).toBeGreaterThan(0.014);
    expect(atmosphericRefractionDeg(45)).toBeLessThan(0.02);
    expect(atmosphericRefractionDeg(90)).toBeLessThan(0.001);
  });

  // The published reference implementation (astronomy-engine's 'normal'
  // mode: Saemundsson with JPL Horizons' clamp at −1° and a taper to the
  // nadir), over the whole range of altitudes.
  it('matches astronomy-engine for every altitude', () => {
    for (let h = -89; h <= 90; h += 0.25) {
      expect(
        Math.abs(
          atmosphericRefractionDeg(h) - Astronomy.Refraction('normal', h)
        )
      ).toBeLessThan(1e-9);
    }
  });

  it('shrinks as the sun rises', () => {
    for (let h = -1; h < 89; h += 0.5) {
      expect(atmosphericRefractionDeg(h + 0.5)).toBeLessThan(
        atmosphericRefractionDeg(h)
      );
    }
  });

  // Meeus 16.4: proportional to pressure, inversely to absolute temperature.
  it('scales with pressure and temperature', () => {
    const standard = atmosphericRefractionDeg(2);
    expect(atmosphericRefractionDeg(2, { pressureHPa: 505 })).toBeCloseTo(
      standard / 2,
      12
    );
    const cold = atmosphericRefractionDeg(2, { temperatureC: -20 });
    expect(cold / standard).toBeCloseTo(283 / 253, 12);
  });

  // Off unless asked for: the sky model is geometric.
  it('leaves solarPosition geometric unless refraction is asked for', () => {
    const t = timeAtElevation(
      { year: 2026, month: 9, day: 23 },
      COLOGNE.lat,
      COLOGNE.lng,
      0.5,
      'setting'
    )!;
    const geometric = solarPosition(t, COLOGNE.lat, COLOGNE.lng);
    const apparent = solarPosition(t, COLOGNE.lat, COLOGNE.lng, {
      refraction: true,
    });
    const lift =
      (apparent.elevationRad - geometric.elevationRad) * (180 / Math.PI);
    expect(lift).toBeCloseTo(atmosphericRefractionDeg(0.5), 6);
    expect(apparent.azimuthRad).toBe(geometric.azimuthRad);
  });

  it('rejects impossible conditions', () => {
    expect(() => atmosphericRefractionDeg(Number.NaN)).toThrow(RangeError);
    expect(() => atmosphericRefractionDeg(10, { pressureHPa: -1 })).toThrow(
      RangeError
    );
    expect(() => atmosphericRefractionDeg(10, { temperatureC: -300 })).toThrow(
      RangeError
    );
    // M2 review finding 8: the formula divides by (273 + T), so between
    // -273.15 and -273 °C it returned a NEGATIVE or unbounded refraction
    // while a check at absolute zero (-273.15) let the value through. The
    // bound is the formula's own zero.
    expect(() =>
      atmosphericRefractionDeg(10, { temperatureC: -273.1 })
    ).toThrow(RangeError);
    expect(() => atmosphericRefractionDeg(10, { temperatureC: -273 })).toThrow(
      RangeError
    );
    expect(
      atmosphericRefractionDeg(10, { temperatureC: -272 })
    ).toBeGreaterThan(0);
  });
});
