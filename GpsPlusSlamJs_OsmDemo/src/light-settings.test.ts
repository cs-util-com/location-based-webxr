/**
 * Tests for the light settings the owner tunes in the light dialog (plan
 * 2026-09-24-2140-osm-demo-light-settings-dialog-plan).
 *
 * Why this file matters: the dialog exists so the owner can find a better
 * noon and paste it back. That only works if (1) the defaults ARE the shipped
 * look, so an untouched dialog changes nothing; (2) a shared link reproduces
 * the setting exactly; and (3) a typo in a link still opens the page, falling
 * back per field rather than throwing.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BUILDING_SKY_LIGHT,
  NATURAL_LIGHT_ADAPTATION,
  NATURAL_LIGHT_COMPENSATION_EV,
  NOON_SURFACE_GAIN,
  surfaceGainAt,
} from "./atmosphere-rig.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  LIGHT_SETTING_RANGES,
  describeLightSettings,
  gainOf,
  parseLightSettings,
  serializeLightSettings,
  type LightSettings,
} from "./light-settings.js";

const FIELDS = Object.keys(LIGHT_SETTING_RANGES) as (keyof LightSettings)[];

describe("DEFAULT_LIGHT_SETTINGS", () => {
  // WHY: an untouched dialog must be the shipped look, value for value.
  it("is the shipped look", () => {
    expect(DEFAULT_LIGHT_SETTINGS).toEqual({
      gainMax: NOON_SURFACE_GAIN.max,
      gainFromDeg: NOON_SURFACE_GAIN.fromDeg,
      gainFullDeg: NOON_SURFACE_GAIN.fullDeg,
      buildingSkyLight: BUILDING_SKY_LIGHT,
      exposureAdaptation: NATURAL_LIGHT_ADAPTATION,
      exposureEv: NATURAL_LIGHT_COMPENSATION_EV,
    });
    for (const f of FIELDS) {
      const r = LIGHT_SETTING_RANGES[f];
      expect(DEFAULT_LIGHT_SETTINGS[f]).toBeGreaterThanOrEqual(r.min);
      expect(DEFAULT_LIGHT_SETTINGS[f]).toBeLessThanOrEqual(r.max);
    }
  });

  // WHY: the ramp at the defaults must be today's ramp at every sun.
  it("gives today's surface gain", () => {
    const gain = gainOf(DEFAULT_LIGHT_SETTINGS);
    for (let deg = -10; deg <= 90; deg += 0.5) {
      const rad = (deg * Math.PI) / 180;
      expect(surfaceGainAt(rad, gain)).toBe(surfaceGainAt(rad));
    }
  });
});

describe("surfaceGainAt with settings", () => {
  it("follows a changed ramp, and refuses one that does not rise", () => {
    const gain = { max: 2, fromDeg: 10, fullDeg: 30 };
    const at = (deg: number) => surfaceGainAt((deg * Math.PI) / 180, gain);
    expect(at(10)).toBe(1);
    expect(at(20)).toBeCloseTo(1.5, 12);
    expect(at(30)).toBeCloseTo(2, 12);
    expect(at(70)).toBeCloseTo(2, 12);
    expect(() =>
      surfaceGainAt(0.5, { max: 2, fromDeg: 30, fullDeg: 30 }),
    ).toThrow(RangeError);
  });
});

describe("parseLightSettings and serializeLightSettings", () => {
  const settings = fc.record(
    Object.fromEntries(
      FIELDS.map((f) => {
        const r = LIGHT_SETTING_RANGES[f];
        const steps = Math.round((r.max - r.min) / r.step);
        return [
          f,
          fc
            .integer({ min: 0, max: steps })
            .map((k) => Number((r.min + k * r.step).toFixed(3))),
        ];
      }),
    ) as { [K in keyof LightSettings]: fc.Arbitrary<number> },
  );

  // WHY: a link the owner copies must reproduce the setting exactly.
  it("round-trips any valid setting through the URL", () => {
    fc.assert(
      fc.property(settings, (s) => {
        fc.pre(s.gainFromDeg < s.gainFullDeg);
        const value = serializeLightSettings(s);
        const back = parseLightSettings(
          value === null ? "" : `?light=${encodeURIComponent(value)}`,
        );
        // Keyed and versioned: a link names what it sets.
        expect(value === null || value.startsWith("v1:")).toBe(true);
        expect(back).toEqual(s);
      }),
      { numRuns: 300, seed: 20260924 },
    );
  });

  it("writes nothing for the defaults and reads the defaults from nothing", () => {
    expect(serializeLightSettings(DEFAULT_LIGHT_SETTINGS)).toBeNull();
    expect(parseLightSettings("")).toEqual(DEFAULT_LIGHT_SETTINGS);
    expect(parseLightSettings("?date=2026-06-21&time=12:00")).toEqual(
      DEFAULT_LIGHT_SETTINGS,
    );
  });

  // WHY: a shared link with a typo must still open the page, falling back
  // per field, never throwing and never taking an out-of-range value. Keys,
  // not positions (plan §7): a link that sets only the gain keeps meaning
  // exactly that after a new field or new defaults.
  it("falls back per field on bad values, and on a ramp that does not rise", () => {
    const d = DEFAULT_LIGHT_SETTINGS;
    expect(
      parseLightSettings("?light=v1:gain=1.8,sky=x,adapt=0.2,ev=-2.5,bogus=3"),
    ).toEqual({ ...d, gainMax: 1.8, exposureEv: -2.5 });
    expect(parseLightSettings("?light=v1:gain=1.8")).toEqual({
      ...d,
      gainMax: 1.8,
    });
    expect(parseLightSettings("?light=v1:gain=1.8,from=40,full=30")).toEqual({
      ...d,
      gainMax: 1.8,
    });
    expect(parseLightSettings("?light=v1:gain=NaN,ev=Infinity")).toEqual(d);
    // An unknown version or a bare list is ignored as a whole.
    expect(parseLightSettings("?light=v2:gain=1.8")).toEqual(d);
    expect(parseLightSettings("?light=1.8,20,45,1,0.75,-2.5")).toEqual(d);
  });

  it("writes only the fields that differ from the defaults", () => {
    expect(
      serializeLightSettings({ ...DEFAULT_LIGHT_SETTINGS, gainMax: 2 }),
    ).toBe("v1:gain=2");
  });
});

describe("describeLightSettings", () => {
  // WHY: the Copy line is what the owner pastes back; every value must be
  // in it, readable.
  it("names every value", () => {
    const line = describeLightSettings({
      gainMax: 1.8,
      gainFromDeg: 20,
      gainFullDeg: 45,
      buildingSkyLight: 1.3,
      exposureAdaptation: 0.6,
      exposureEv: -2.5,
    });
    expect(line).toBe(
      "light: gain 1.8 (20° to 45°), sky light 1.3, adaptation 0.6, EV -2.5",
    );
  });
});
