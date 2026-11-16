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
  HAZE_START_RATIO,
  HAZE_VISIBILITY_KM,
  NATURAL_LIGHT_ADAPTATION,
  NATURAL_LIGHT_COMPENSATION_EV,
  NOON_SURFACE_GAIN,
  surfaceGainAt,
} from "./atmosphere-rig.js";
import { HAZE_VEIL_TINT } from "./haze-veil.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  LIGHT_SETTING_RANGES,
  describeLightSettings,
  gainOf,
  lightDefaultsFor,
  parseLightSettings,
  rebaseLightSettings,
  serializeLightSettings,
  veilOf,
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
      hazeVisibilityKm: HAZE_VISIBILITY_KM,
      hazeStartRatio: HAZE_START_RATIO,
      hazeVeilLightness: 0,
      hazeVeilTint: HAZE_VEIL_TINT,
    });
    // No veil: the haze takes the sky's colour, as it always has.
    expect(veilOf(DEFAULT_LIGHT_SETTINGS)).toBeNull();
    // Today's haze: 45 km, its boundary fade from 0.66 of the draw distance.
    expect(HAZE_VISIBILITY_KM).toBe(45);
    expect(HAZE_START_RATIO).toBe(0.66);
    for (const f of FIELDS) {
      const r = LIGHT_SETTING_RANGES[f];
      expect(DEFAULT_LIGHT_SETTINGS[f]).toBeGreaterThanOrEqual(r.min);
      expect(DEFAULT_LIGHT_SETTINGS[f]).toBeLessThanOrEqual(r.max);
    }
  });

  // WHY (r1158): the dialog is for finding a better look from the shipped
  // one, so every slider must reach past its default in BOTH directions. The
  // sky light on buildings was raised to its old slider end (1.4 -> 3, to
  // carry the linear-light building colours), which would have left the
  // owner no way to brighten the buildings further.
  // The veil's lightness is the exception: its default is OFF (0, the
  // sky's colour), which sits at the slider's start by design.
  it("leaves every slider room on both sides of its default", () => {
    expect(DEFAULT_LIGHT_SETTINGS.hazeVeilLightness).toBe(
      LIGHT_SETTING_RANGES.hazeVeilLightness.min,
    );
    for (const f of FIELDS.filter((x) => x !== "hazeVeilLightness")) {
      const r = LIGHT_SETTING_RANGES[f];
      expect(DEFAULT_LIGHT_SETTINGS[f], f).toBeGreaterThan(r.min);
      expect(DEFAULT_LIGHT_SETTINGS[f], f).toBeLessThan(r.max);
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

  // WHY (#905 review): r1158 raised the sky light on buildings 1.4 -> 3. A
  // link keeps what it STATES, so one that set the old default keeps it; one
  // that left `sky` out follows today's default (the sidecar's "Old links"
  // says why that is the honest reading: the linear building colours changed
  // what 1.4 renders).
  it("keeps a stated sky light, and gives today's default to a link without one", () => {
    expect(parseLightSettings("?light=v1:sky=1.4").buildingSkyLight).toBe(1.4);
    expect(parseLightSettings("?light=v1:gain=1.8").buildingSkyLight).toBe(
      BUILDING_SKY_LIGHT,
    );
    expect(BUILDING_SKY_LIGHT).toBe(3);
  });

  it("writes only the fields that differ from the defaults", () => {
    expect(
      serializeLightSettings({ ...DEFAULT_LIGHT_SETTINGS, gainMax: 2 }),
    ).toBe("v1:gain=2");
  });

  // WHY (city look, haze inside the city): the haze is tuned by two keys,
  // `vis` (the visibility, km) and `haze` (where the boundary fade starts, as
  // a share of the draw distance). A link without them must keep today's
  // haze, and one that states them must get exactly those values, inside the
  // sliders' bounds only.
  it("reads and writes the haze keys, inside their bounds", () => {
    const d = DEFAULT_LIGHT_SETTINGS;
    expect(parseLightSettings("?light=v1:vis=15,haze=0.2")).toEqual({
      ...d,
      hazeVisibilityKm: 15,
      hazeStartRatio: 0.2,
    });
    expect(
      serializeLightSettings({ ...d, hazeVisibilityKm: 9, hazeStartRatio: 0 }),
    ).toBe("v1:vis=9,haze=0");
    expect(parseLightSettings("?light=v1:gain=1.8")).toEqual({
      ...d,
      gainMax: 1.8,
    });
    // Out of range or not a number: today's haze, per field.
    for (const bad of ["vis=8", "vis=61", "vis=0", "haze=-0.1", "haze=0.91"]) {
      expect(parseLightSettings(`?light=v1:${bad}`), bad).toEqual(d);
    }
    expect(parseLightSettings("?light=v1:vis=x,haze=0.3")).toEqual({
      ...d,
      hazeStartRatio: 0.3,
    });
    const v = LIGHT_SETTING_RANGES.hazeVisibilityKm;
    const h = LIGHT_SETTING_RANGES.hazeStartRatio;
    expect([v.min, v.max]).toEqual([9, 60]);
    expect([h.min, h.max]).toEqual([0, 0.9]);
  });

  // WHY: a haze tried in the dialog and shared must come back exactly, and
  // must not drag any other field away from today's look with it.
  it("round-trips any haze alone, writing only the haze keys", () => {
    const grid = (f: "hazeVisibilityKm" | "hazeStartRatio") => {
      const r = LIGHT_SETTING_RANGES[f];
      return fc
        .integer({ min: 0, max: Math.round((r.max - r.min) / r.step) })
        .map((k) => Number((r.min + k * r.step).toFixed(3)));
    };
    fc.assert(
      fc.property(
        grid("hazeVisibilityKm"),
        grid("hazeStartRatio"),
        (vis, start) => {
          const s = {
            ...DEFAULT_LIGHT_SETTINGS,
            hazeVisibilityKm: vis,
            hazeStartRatio: start,
          };
          const value = serializeLightSettings(s);
          const keys = (value ?? "v1:")
            .slice(3)
            .split(",")
            .filter((p) => p !== "")
            .map((p) => p.split("=")[0]);
          expect(keys.every((k) => k === "vis" || k === "haze")).toBe(true);
          const back = parseLightSettings(
            value === null ? "" : `?light=${encodeURIComponent(value)}`,
          );
          expect(back).toEqual(s);
        },
      ),
      { numRuns: 200, seed: 20261115 },
    );
  });
});

describe("the haze veil keys", () => {
  // WHY (city look, a bright bluish veil): the veil is tuned by two keys,
  // `veil` (its lightness on screen, L*; 0 is off) and `tint` (its b*). A
  // link without them must keep the sky-derived haze; one that states them
  // must get exactly those values, inside the sliders' bounds only.
  it("reads and writes them, inside their bounds", () => {
    const d = DEFAULT_LIGHT_SETTINGS;
    const s = parseLightSettings("?light=v1:veil=80,tint=-6.5");
    expect(s).toEqual({ ...d, hazeVeilLightness: 80, hazeVeilTint: -6.5 });
    expect(veilOf(s)).toEqual({ lightness: 80, tint: -6.5 });
    expect(serializeLightSettings({ ...d, hazeVeilLightness: 72 })).toBe(
      "v1:veil=72",
    );
    for (const bad of [
      "veil=-1",
      "veil=81",
      "tint=-12.5",
      "tint=4.5",
      "veil=x",
    ]) {
      expect(parseLightSettings(`?light=v1:${bad}`), bad).toEqual(d);
    }
    const v = LIGHT_SETTING_RANGES.hazeVeilLightness;
    const t = LIGHT_SETTING_RANGES.hazeVeilTint;
    expect([v.min, v.max, v.step]).toEqual([0, 80, 1]);
    expect([t.min, t.max, t.step]).toEqual([-12, 4, 0.5]);
  });

  // WHY: a tint on its own is not a veil; the haze keeps the sky's colour
  // until a lightness is set.
  it("is off at lightness 0, whatever the tint", () => {
    expect(veilOf({ ...DEFAULT_LIGHT_SETTINGS, hazeVeilTint: -10 })).toBeNull();
  });

  // WHY: a veil tried in the dialog and shared must come back exactly, and
  // must not drag any other field away from today's look with it.
  it("round-trips any veil alone, writing only the veil keys", () => {
    const grid = (f: "hazeVeilLightness" | "hazeVeilTint") => {
      const r = LIGHT_SETTING_RANGES[f];
      return fc
        .integer({ min: 0, max: Math.round((r.max - r.min) / r.step) })
        .map((k) => Number((r.min + k * r.step).toFixed(3)));
    };
    fc.assert(
      fc.property(grid("hazeVeilLightness"), grid("hazeVeilTint"), (l, t) => {
        const s = {
          ...DEFAULT_LIGHT_SETTINGS,
          hazeVeilLightness: l,
          hazeVeilTint: t,
        };
        const value = serializeLightSettings(s);
        const keys = (value ?? "v1:")
          .slice(3)
          .split(",")
          .filter((p) => p !== "")
          .map((p) => p.split("=")[0]);
        expect(keys.every((k) => k === "veil" || k === "tint")).toBe(true);
        const back = parseLightSettings(
          value === null ? "" : `?light=${encodeURIComponent(value)}`,
        );
        expect(back).toEqual(s);
      }),
      { numRuns: 200, seed: 20261115 },
    );
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
      hazeVisibilityKm: 15,
      hazeStartRatio: 0.2,
      hazeVeilLightness: 0,
      hazeVeilTint: -4,
    });
    expect(line).toBe(
      "light: gain 1.8 (20° to 45°), sky light 1.3, adaptation 0.6, EV -2.5, " +
        "haze 15 km from 0.2 of the draw distance",
    );
  });

  // WHY: a veil changes the look as much as the haze it colours, so the
  // pasted line must carry it; without one the line stays as it was.
  it("names the veil when one is set", () => {
    const line = describeLightSettings({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVeilLightness: 78,
      hazeVeilTint: -5,
    });
    expect(line.endsWith(", veil L* 78 b* -5")).toBe(true);
  });
});

describe("a colour scheme's light defaults", () => {
  // Why this test matters: the urban look is tuned WITH its light (a bright
  // veil at EV -2); the defaults a link is read against follow the scheme,
  // so an urban link that states nothing opens in that light, a stated value
  // still wins, and every other scheme keeps the shipped look.
  const URBAN = lightDefaultsFor("urban");

  it("gives urban the veil at L* 72 and EV -2, and every other scheme the shipped look", () => {
    expect(URBAN).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVeilLightness: 72,
      exposureEv: -2,
    });
    expect(veilOf(URBAN)).toEqual({ lightness: 72, tint: HAZE_VEIL_TINT });
    for (const name of ["today", "architect", "night", "no-such-scheme"]) {
      expect(lightDefaultsFor(name)).toBe(DEFAULT_LIGHT_SETTINGS);
    }
  });

  it("keeps the urban defaults inside the sliders' ranges", () => {
    for (const field of FIELDS) {
      const r = LIGHT_SETTING_RANGES[field];
      expect(URBAN[field]).toBeGreaterThanOrEqual(r.min);
      expect(URBAN[field]).toBeLessThanOrEqual(r.max);
    }
  });

  it("reads an old urban link without the keys in the new default, and a stated value over it", () => {
    expect(parseLightSettings("", URBAN)).toBe(URBAN);
    expect(parseLightSettings("?light=v1:vis=15", URBAN)).toEqual({
      ...URBAN,
      hazeVisibilityKm: 15,
    });
    // veil=0 still switches the veil off; ev=-1 overrides the scheme's -2.
    const off = parseLightSettings("?light=v1:veil=0,ev=-1", URBAN);
    expect(veilOf(off)).toBeNull();
    expect(off.exposureEv).toBe(-1);
  });

  it("writes nothing for the scheme's defaults, and veil=0 when the veil is switched off", () => {
    expect(serializeLightSettings(URBAN, URBAN)).toBeNull();
    expect(
      serializeLightSettings({ ...URBAN, hazeVeilLightness: 0 }, URBAN),
    ).toBe("v1:veil=0");
    // Against the shipped defaults the urban look states its two values.
    expect(serializeLightSettings(URBAN)).toBe("v1:ev=-2,veil=72");
  });

  it("round-trips any setting against the urban defaults (fixed seed)", () => {
    const arb = fc.record(
      Object.fromEntries(
        FIELDS.map((f) => {
          const r = LIGHT_SETTING_RANGES[f];
          const steps = Math.round((r.max - r.min) / r.step);
          return [
            f,
            fc
              .integer({ min: 0, max: steps })
              .map((i) => Number((r.min + i * r.step).toFixed(3))),
          ];
        }),
      ) as { [K in keyof LightSettings]: fc.Arbitrary<number> },
    );
    fc.assert(
      fc.property(arb, (s) => {
        fc.pre(s.gainFullDeg > s.gainFromDeg);
        const text = serializeLightSettings(s, URBAN);
        const back = parseLightSettings(
          text === null ? "" : `?light=${text}`,
          URBAN,
        );
        expect(back).toEqual(s);
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });

  it("rebases onto a new scheme's defaults: untouched fields follow, changed ones stay", () => {
    const tuned = { ...URBAN, hazeVisibilityKm: 15 };
    expect(rebaseLightSettings(tuned, URBAN, DEFAULT_LIGHT_SETTINGS)).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVisibilityKm: 15,
    });
    expect(rebaseLightSettings(URBAN, URBAN, DEFAULT_LIGHT_SETTINGS)).toEqual(
      DEFAULT_LIGHT_SETTINGS,
    );
    // A veil switched off on urban stays off on the move to another scheme
    // (0 differs from urban's 72, so it was set) ...
    const off = { ...URBAN, hazeVeilLightness: 0 };
    const away = rebaseLightSettings(off, URBAN, DEFAULT_LIGHT_SETTINGS);
    expect(away).toEqual(DEFAULT_LIGHT_SETTINGS);
    // ... but there 0 IS the default, so nothing says it was set, and the way
    // back to urban brings the veil again. A known limit: the settings carry
    // values, not which of them the viewer touched.
    expect(rebaseLightSettings(away, DEFAULT_LIGHT_SETTINGS, URBAN)).toEqual(
      URBAN,
    );
  });

  it("keeps every stated field across a rebase, and moves every other (fixed seed)", () => {
    // A value the viewer set is theirs; a value they never touched is the
    // scheme's, so it follows the scheme.
    fc.assert(
      fc.property(fc.subarray(FIELDS), fc.nat(), (changed, k) => {
        const s = { ...URBAN } as Record<keyof LightSettings, number>;
        for (const f of changed) {
          const r = LIGHT_SETTING_RANGES[f];
          const steps = Math.round((r.max - r.min) / r.step);
          s[f] = Number((r.min + (k % (steps + 1)) * r.step).toFixed(3));
        }
        const moved = rebaseLightSettings(s, URBAN, DEFAULT_LIGHT_SETTINGS);
        for (const f of FIELDS) {
          expect(moved[f]).toBe(
            s[f] === URBAN[f] ? DEFAULT_LIGHT_SETTINGS[f] : s[f],
          );
        }
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });
});
