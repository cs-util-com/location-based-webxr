/**
 * Why this test matters: everything on the globe that moves with time (the
 * sun, the cloud drift, and later the stars and the dive's hand-over, which
 * passes "the globe's time" on) reads ONE clock, so a test link with
 * `#time=` must give exactly the same scene however long the page has been
 * open, and a running clock must advance at exactly its scale. A clock that
 * crept while pinned would move the sun under a pixel probe; one that read a
 * malformed hash as a time would put the scene at 1970.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_CLOCK_SCALE,
  readGlobeClockSetting,
  sameGlobeClockSetting,
  startGlobeClock,
} from "./globe-clock.js";

const hash = (text: string) => new URLSearchParams(text);
const EQUINOX = Date.parse("2026-03-20T12:00:00Z");

describe("readGlobeClockSetting", () => {
  it("reads a pinned instant and a scale", () => {
    expect(
      readGlobeClockSetting(hash("time=2026-03-20T12:00:00Z&timeScale=600")),
    ).toEqual({ startMs: EQUINOX, scale: 600 });
  });

  it("treats an absent, empty or malformed time as now, and keeps a hand-typed offset's '+'", () => {
    for (const text of ["", "time=", "time=noon", "time=2026-13-45"]) {
      expect(readGlobeClockSetting(hash(text)).startMs, text).toBeNull();
    }
    // Form decoding turns a typed "+02:00" into " 02:00".
    expect(
      readGlobeClockSetting(hash("time=2026-03-20T14:00:00+02:00")).startMs,
    ).toBe(EQUINOX);
  });

  it("treats an absent, empty, malformed or out-of-range scale as the default", () => {
    for (const text of [
      "",
      "timeScale=",
      "timeScale= ",
      "timeScale=fast",
      "timeScale=-1",
      `timeScale=${GLOBE_CLOCK_SCALE.max + 1}`,
      "timeScale=Infinity",
    ]) {
      expect(readGlobeClockSetting(hash(text)).scale, text).toBeNull();
    }
    expect(readGlobeClockSetting(hash("timeScale=0")).scale).toBe(0);
    expect(
      readGlobeClockSetting(hash(`timeScale=${GLOBE_CLOCK_SCALE.max}`)).scale,
    ).toBe(GLOBE_CLOCK_SCALE.max);
  });
});

describe("startGlobeClock", () => {
  const wall = { epochMs: Date.parse("2026-09-27T05:00:00Z"), monoMs: 1234.5 };

  it("pinned by default: a pinned instant stands still however long the page runs", () => {
    const clock = startGlobeClock({ startMs: EQUINOX, scale: null }, wall);
    expect(clock.scale).toBe(0);
    expect(clock.timeAt(wall.monoMs)).toBe(EQUINOX);
    expect(clock.timeAt(wall.monoMs + 3_600_000)).toBe(EQUINOX);
  });

  it("running by default from now: it reads the wall clock", () => {
    const clock = startGlobeClock({ startMs: null, scale: null }, wall);
    expect(clock.scale).toBe(1);
    expect(clock.timeAt(wall.monoMs)).toBe(wall.epochMs);
    expect(clock.timeAt(wall.monoMs + 1500)).toBe(wall.epochMs + 1500);
  });

  it("a pinned start with a scale runs from the pin at that scale", () => {
    const clock = startGlobeClock({ startMs: EQUINOX, scale: 600 }, wall);
    expect(clock.timeAt(wall.monoMs + 1000)).toBe(EQUINOX + 600_000);
  });

  it("advances exactly at its scale, from its start, for any reading", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -4e12, max: 4e12 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: GLOBE_CLOCK_SCALE.max }), {
          nil: null,
        }),
        fc.integer({ min: 0, max: 1e9 }),
        (startMs, scale, elapsed) => {
          const clock = startGlobeClock({ startMs, scale }, wall);
          const expected =
            (startMs ?? wall.epochMs) +
            elapsed * (scale ?? (startMs === null ? 1 : 0));
          expect(clock.timeAt(wall.monoMs + elapsed)).toBe(expected);
        },
      ),
    );
  });

  it("refuses a non-finite wall reading or an out-of-range setting", () => {
    const ok = { startMs: null, scale: null };
    expect(() =>
      startGlobeClock(ok, { epochMs: Number.NaN, monoMs: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      startGlobeClock(ok, { epochMs: 0, monoMs: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() =>
      startGlobeClock({ startMs: Number.NaN, scale: null }, wall),
    ).toThrow(RangeError);
    expect(() => startGlobeClock({ startMs: null, scale: -1 }, wall)).toThrow(
      RangeError,
    );
  });
});

describe("sameGlobeClockSetting", () => {
  it("is true only for the same start and the same scale", () => {
    const a = { startMs: EQUINOX, scale: null };
    expect(sameGlobeClockSetting(a, { ...a })).toBe(true);
    expect(sameGlobeClockSetting(a, { ...a, scale: 1 })).toBe(false);
    expect(sameGlobeClockSetting(a, { startMs: null, scale: null })).toBe(
      false,
    );
  });
});
