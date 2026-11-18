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
import { describe, expect, it, vi } from "vitest";

import {
  BUILDING_SKY_LIGHT,
  HAZE_START_RATIO,
  HAZE_VISIBILITY_KM,
  NATURAL_LIGHT_ADAPTATION,
  NATURAL_LIGHT_COMPENSATION_EV,
  NOON_SURFACE_GAIN,
  surfaceGainAt,
  TONE_MAPPING_EXPOSURE,
} from "./atmosphere-rig.js";
import { rgbToLab } from "gps-plus-slam-osm";

import { skyBalanceGain } from "./sky-balance.js";

import {
  HAZE_VEIL_RISE_DEG,
  HAZE_VEIL_TINT,
  veilLightnessBounds,
  veilSceneColour,
} from "./haze-veil.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  LIGHT_SETTING_RANGES,
  describeLightSettings,
  gainOf,
  lightDefaultsFor,
  parseLightLink,
  parseLightSettings,
  rebaseLightSettings,
  serializeLightSettings,
  skyBalanceOf,
  veilOf,
  applyLightOrFallback,
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
      hazeVeilTintA: 0,
      hazeVeilRiseDeg: HAZE_VEIL_RISE_DEG,
      skyBalanceA: 0,
      skyBalanceB: 0,
    });
    // No sky balance: the sky is the model's colour, as it always was.
    expect(skyBalanceOf(DEFAULT_LIGHT_SETTINGS)).toBeNull();
    // No veil: the haze takes the sky's colour, as it always has.
    expect(veilOf(DEFAULT_LIGHT_SETTINGS)).toBeNull();
    // The veil reaches 10 degrees up the sky by default (it read better at
    // the horizon than 4).
    expect(HAZE_VEIL_RISE_DEG).toBe(10);
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

describe("parseLightLink: the fields a link states", () => {
  // WHY: a stated value can equal the scheme's default, and only the key
  // list can tell it from an unstated one; a scheme switch keeps stated
  // fields (light-dialog's rebase).
  it("names each key it accepted, and the settings are parseLightSettings'", () => {
    const search = "?light=v1:veil=0,gain=2,ev=nope,tint=999";
    const link = parseLightLink(search, DEFAULT_LIGHT_SETTINGS);
    expect([...link.stated].sort()).toEqual(["gainMax", "hazeVeilLightness"]);
    expect(link.settings).toEqual(
      parseLightSettings(search, DEFAULT_LIGHT_SETTINGS),
    );
  });

  it("states the three veil colour fields of a vcol, and nothing for no link", () => {
    expect(
      [
        ...parseLightLink("?light=v1:vcol=fec", DEFAULT_LIGHT_SETTINGS).stated,
      ].sort(),
    ).toEqual(["hazeVeilLightness", "hazeVeilTint", "hazeVeilTintA"]);
    expect(parseLightLink("", DEFAULT_LIGHT_SETTINGS).stated.size).toBe(0);
    expect(parseLightLink("?light=v9:veil=3").stated.size).toBe(0);
  });

  it("drops the ramp's ends when a crossed ramp falls back", () => {
    const link = parseLightLink("?light=v1:from=30,full=10,veil=5");
    expect([...link.stated]).toEqual(["hazeVeilLightness"]);
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
    const s = parseLightSettings("?light=v1:veil=80,tint=-6.5,tinta=2");
    expect(s).toEqual({
      ...d,
      hazeVeilLightness: 80,
      hazeVeilTint: -6.5,
      hazeVeilTintA: 2,
    });
    expect(veilOf(s)).toEqual({
      lightness: 80,
      tint: -6.5,
      tintA: 2,
      riseDeg: HAZE_VEIL_RISE_DEG,
    });
    // An old link without `tinta` keeps a* 0, its colour unchanged.
    expect(parseLightSettings("?light=v1:veil=72,tint=-6").hazeVeilTintA).toBe(
      0,
    );
    expect(
      serializeLightSettings({
        ...d,
        hazeVeilLightness: 72,
        hazeVeilTintA: -3,
      }),
    ).toBe("v1:veil=72,tinta=-3");
    // The rise travels as `rise`, and reaches the veil the sky draws.
    expect(
      veilOf(parseLightSettings("?light=v1:veil=80,rise=8"))?.riseDeg,
    ).toBe(8);
    expect(serializeLightSettings({ ...d, hazeVeilLightness: 72 })).toBe(
      "v1:veil=72",
    );
    for (const bad of [
      "veil=-1",
      "veil=91",
      "tint=-24.5",
      "tint=40.5",
      "tinta=-10.5",
      "tinta=10.5",
      "tinta=x",
      "veil=x",
      "rise=-0.5",
      "rise=20.5",
    ]) {
      expect(parseLightSettings(`?light=v1:${bad}`), bad).toEqual(d);
    }
    const v = LIGHT_SETTING_RANGES.hazeVeilLightness;
    const t = LIGHT_SETTING_RANGES.hazeVeilTint;
    const a = LIGHT_SETTING_RANGES.hazeVeilTintA;
    expect([v.min, v.max, v.step]).toEqual([0, 90, 1]);
    expect([t.min, t.max, t.step]).toEqual([-24, 40, 0.5]);
    expect([a.min, a.max, a.step]).toEqual([-10, 10, 0.5]);
    const r = LIGHT_SETTING_RANGES.hazeVeilRiseDeg;
    expect([r.min, r.max, r.step]).toEqual([0, 20, 0.5]);
  });

  // WHY: a tint on its own is not a veil; the haze keeps the sky's colour
  // until a lightness is set.
  it("is off at lightness 0, whatever the tint", () => {
    expect(
      veilOf({
        ...DEFAULT_LIGHT_SETTINGS,
        hazeVeilTint: -10,
        hazeVeilTintA: 4,
      }),
    ).toBeNull();
  });

  // WHY: a link may ask for a lightness its colour cannot show below the
  // tone curve's knee (a strong yellow at L* 90). The settings keep what the
  // link states, so it round-trips, and the veil the view draws is held at
  // that colour's bound: never a colour other than the one named.
  it("holds the drawn veil at the colour's lightness bound, keeping the stated value", () => {
    const s = parseLightSettings("?light=v1:veil=90,tint=40");
    expect(s.hazeVeilLightness).toBe(90);
    const veil = veilOf(s)!;
    const max = veilLightnessBounds(0, 40)!.max;
    expect(veil.lightness).toBe(max);
    expect(max).toBeLessThan(90);
    expect(veilOf({ ...s, hazeVeilLightness: 60 })!.lightness).toBe(60);
  });

  // WHY: a colour picked elsewhere is a hex code; `vcol` reads one as L*, a*
  // and b* (each snapped to its slider and held in its range), the explicit
  // keys win over it, a bad hex is ignored, and it is never written back
  // (the three keys are).
  it("reads a hex veil colour as L*, a* and b*", () => {
    const d = DEFAULT_LIGHT_SETTINGS;
    const s = parseLightSettings("?light=v1:vcol=f2e6c8");
    const lab = rgbToLab(0xf2e6c8);
    const snap = (v: number) => Math.round(v * 2) / 2 + 0;
    // Its L* of 91.5 is past the slider's 90, so it is held there.
    expect(lab.l).toBeGreaterThan(90);
    expect(s).toEqual({
      ...d,
      hazeVeilLightness: 90,
      hazeVeilTintA: snap(lab.a),
      hazeVeilTint: snap(lab.b),
    });
    expect(serializeLightSettings(s)).not.toContain("vcol");
    expect(
      parseLightSettings("?light=v1:vcol=f2e6c8,tint=-4").hazeVeilTint,
    ).toBe(-4);
    // Pure yellow's b* (about 93) is held at the slider's end.
    expect(parseLightSettings("?light=v1:vcol=FFFF00").hazeVeilTint).toBe(40);
    // The 3-digit form doubles each digit, as in CSS: fec is ffeecc.
    expect(parseLightSettings("?light=v1:vcol=fec")).toEqual(
      parseLightSettings("?light=v1:vcol=ffeecc"),
    );
    expect(parseLightSettings("?light=v1:vcol=fec")).not.toEqual(d);
    // A hex brighter than its colour can show is read as asked and held
    // where it is drawn: the settings keep L*, the drawn veil its bound.
    const bright = parseLightSettings("?light=v1:vcol=fec");
    expect(veilOf(bright)!.lightness).toBe(
      veilLightnessBounds(bright.hazeVeilTintA, bright.hazeVeilTint)!.max,
    );
    expect(veilOf(bright)!.lightness).toBeLessThan(bright.hazeVeilLightness);
    for (const bad of [
      "vcol=f2e6c",
      "vcol=zzzzzz",
      "vcol=",
      "vcol=#f2e6c8",
      "vcol=fe",
      "vcol=f2e6c8a",
    ]) {
      expect(parseLightSettings(`?light=v1:${bad}`), bad).toEqual(d);
    }
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
      hazeVeilTintA: 0,
      hazeVeilRiseDeg: 4,
      skyBalanceA: 0,
      skyBalanceB: 0,
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
    expect(
      line.endsWith(`, veil L* 78 b* -5 up to ${HAZE_VEIL_RISE_DEG}° of sky`),
    ).toBe(true);
    // a* only when set; a held lightness names what is shown.
    const held = describeLightSettings({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVeilLightness: 90,
      hazeVeilTint: 40,
      hazeVeilTintA: 2,
    });
    const max = veilLightnessBounds(2, 40)!.max;
    expect(held).toContain(`, veil L* 90 (shown at ${max}) a* 2 b* 40 up to`);
  });
});

describe("the sky balance keys", () => {
  // Why this test matters: the sky balance is the lever that moves the
  // model's mauve twilight toward a slate-blue one; a tuned look must travel
  // in a link like every other light value, and a look without one must
  // write nothing new.
  it("reads and writes skya and skyb, inside their bounds", () => {
    const s = parseLightSettings("?light=v1:skya=-12,skyb=-8.5");
    expect(s).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      skyBalanceA: -12,
      skyBalanceB: -8.5,
    });
    expect(serializeLightSettings(s)).toBe("v1:skya=-12,skyb=-8.5");
    const r = LIGHT_SETTING_RANGES;
    const out = parseLightSettings(
      `?light=v1:skya=${r.skyBalanceA.max + 1},skyb=${r.skyBalanceB.min - 1}`,
    );
    expect(out.skyBalanceA).toBe(0);
    expect(out.skyBalanceB).toBe(0);
  });

  it("gives the framework the gain of the stated cast, or null without one", () => {
    expect(skyBalanceOf(DEFAULT_LIGHT_SETTINGS)).toBeNull();
    expect(
      skyBalanceOf({
        ...DEFAULT_LIGHT_SETTINGS,
        skyBalanceA: -12,
        skyBalanceB: -8,
      }),
    ).toEqual(skyBalanceGain(-12, -8));
  });

  // WHY: every value the sliders reach must be a gain the framework draws
  // (finite, at least 0), or a link could break the page.
  it("gives a drawable gain at every corner of the sliders", () => {
    const r = LIGHT_SETTING_RANGES;
    for (const a of [r.skyBalanceA.min, r.skyBalanceA.max]) {
      for (const b of [r.skyBalanceB.min, r.skyBalanceB.max]) {
        const g = skyBalanceOf({
          ...DEFAULT_LIGHT_SETTINGS,
          skyBalanceA: a,
          skyBalanceB: b,
        })!;
        for (const c of g) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("is named in the Copy line only when set", () => {
    expect(describeLightSettings(DEFAULT_LIGHT_SETTINGS)).not.toContain(
      "sky balance",
    );
    expect(
      describeLightSettings({
        ...DEFAULT_LIGHT_SETTINGS,
        skyBalanceA: -12,
        skyBalanceB: -8,
      }).endsWith(", sky balance a* -12 b* -8"),
    ).toBe(true);
  });

  // Why this test matters: the Copy line is a display; whether it names the
  // balance must not hang on computing the balance's gain, which throws on a
  // non-finite value. One axis set is enough to name it, and a value the
  // link parser never produces still gives a line rather than a throw.
  it("names one set axis, and never throws to decide", () => {
    expect(
      describeLightSettings({ ...DEFAULT_LIGHT_SETTINGS, skyBalanceB: 5 }),
    ).toContain(", sky balance a* 0 b* 5");
    expect(
      describeLightSettings({ ...DEFAULT_LIGHT_SETTINGS, skyBalanceA: -0 }),
    ).not.toContain("sky balance");
    expect(() =>
      describeLightSettings({
        ...DEFAULT_LIGHT_SETTINGS,
        skyBalanceA: Number.NaN,
      }),
    ).not.toThrow();
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
    expect(veilOf(URBAN)).toEqual({
      lightness: 72,
      tint: HAZE_VEIL_TINT,
      tintA: 0,
      riseDeg: HAZE_VEIL_RISE_DEG,
    });
    for (const name of ["today", "architect", "night", "no-such-scheme"]) {
      expect(lightDefaultsFor(name)).toBe(DEFAULT_LIGHT_SETTINGS);
    }
  });

  // Why this test matters: the low-sun looks are tuned WITH their light
  // against a dusk reference (sky band L* 63, a* -3, b* -16 over a warm
  // horizon band). After sunset the model's sky reads mauve, so dusk and
  // blue hour carry a green-blue sky balance and a warm veil; golden hour
  // carries none, because a cool balance on a sunlit sky turns it olive.
  it("gives the low-sun looks their measured light, inside the sliders' ranges", () => {
    expect(lightDefaultsFor("golden")).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      exposureEv: -3,
      hazeVisibilityKm: 60,
    });
    expect(skyBalanceOf(lightDefaultsFor("golden"))).toBeNull();
    expect(lightDefaultsFor("dusk")).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      exposureEv: -1.5,
      skyBalanceA: -12,
      skyBalanceB: -8,
      hazeVeilLightness: 65,
      hazeVeilTintA: 5,
      hazeVeilTint: 22,
      hazeVeilRiseDeg: 6,
    });
    expect(lightDefaultsFor("bluehour")).toEqual({
      ...DEFAULT_LIGHT_SETTINGS,
      exposureEv: -1.5,
      skyBalanceA: -16,
      skyBalanceB: -12,
      hazeVeilLightness: 62,
      hazeVeilTintA: 8,
      hazeVeilTint: 24,
      hazeVeilRiseDeg: 5,
    });
    for (const name of ["golden", "dusk", "bluehour"]) {
      const light = lightDefaultsFor(name);
      for (const field of FIELDS) {
        const r = LIGHT_SETTING_RANGES[field];
        expect(light[field], `${name} ${field}`).toBeGreaterThanOrEqual(r.min);
        expect(light[field], `${name} ${field}`).toBeLessThanOrEqual(r.max);
      }
    }
    // The veils are drawn as stated (no lightness bound held them back).
    for (const name of ["dusk", "bluehour"]) {
      const light = lightDefaultsFor(name);
      expect(veilOf(light)!.lightness).toBe(light.hazeVeilLightness);
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
    // ... but there 0 IS the default, so the value alone does not say it was
    // set, and the way back to urban would bring the veil again ...
    expect(rebaseLightSettings(away, DEFAULT_LIGHT_SETTINGS, URBAN)).toEqual(
      URBAN,
    );
    // ... unless the caller names the fields the viewer touched.
    expect(
      rebaseLightSettings(
        away,
        DEFAULT_LIGHT_SETTINGS,
        URBAN,
        new Set(["hazeVeilLightness"]),
      ),
    ).toEqual(off);
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
        // A valid setting (its ramp rises), as every writer produces.
        fc.pre(s.gainFullDeg > s.gainFromDeg);
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

  // WHY: the parser and the dialog both keep the gain ramp rising; a rebase
  // must too. A set ramp start kept against an end that follows the new
  // scheme can cross it, and `surfaceGainAt` refuses such a ramp. The kept
  // (set) end wins and the followed end moves, as in the dialog.
  it("keeps the gain ramp rising across a rebase", () => {
    const from = {
      ...DEFAULT_LIGHT_SETTINGS,
      gainFromDeg: 18,
      gainFullDeg: 40,
    };
    const to = { ...DEFAULT_LIGHT_SETTINGS, gainFromDeg: 5, gainFullDeg: 20 };
    const keptStart = rebaseLightSettings(
      { ...from, gainFromDeg: 30 },
      from,
      to,
    );
    expect([keptStart.gainFromDeg, keptStart.gainFullDeg]).toEqual([30, 31]);
    const lowEnd = { ...from, gainFromDeg: 5, gainFullDeg: 35 };
    const keptEnd = rebaseLightSettings(
      { ...lowEnd, gainFullDeg: 10 },
      lowEnd,
      { ...to, gainFromDeg: 25, gainFullDeg: 50 },
    );
    expect([keptEnd.gainFromDeg, keptEnd.gainFullDeg]).toEqual([9, 10]);
    // Any rebase of a rising ramp rises (fixed seed).
    const deg = fc.integer({ min: 0, max: 60 });
    fc.assert(
      fc.property(deg, deg, deg, deg, deg, deg, (a, b, c, d, e, f) => {
        fc.pre(a < b + 1 && c < d + 1 && e < f + 1);
        const ramp = (lo: number, hi: number) => ({
          ...DEFAULT_LIGHT_SETTINGS,
          gainFromDeg: lo,
          gainFullDeg: hi + 1,
        });
        const out = rebaseLightSettings(ramp(a, b), ramp(c, d), ramp(e, f));
        expect(out.gainFullDeg).toBeGreaterThan(out.gainFromDeg);
        expect(out.gainFromDeg).toBeGreaterThanOrEqual(0);
        expect(out.gainFullDeg).toBeLessThanOrEqual(90);
      }),
      { seed: 20261116, numRuns: 500 },
    );
  });
});

describe("a hand-written veil lightness off the slider's grid", () => {
  // WHY: the boot reads `?light=` and hands `veilOf` to the rig, which
  // derives the scene colour with `veilSceneColour`; a value the parser
  // accepts must never make that throw. L* 28.22 at a* -10 b* -21 sits off
  // the 0.1 grid near the bottom of that colour's run, where the 8-bit
  // rounding missed and the boot threw; 2.55 is near the bottom of the
  // default tint's run. The stated value is kept as written (it
  // round-trips); only the drawn veil moves, to the nearest grid point.
  it("draws an off-grid veil a link states, keeping the stated value", () => {
    for (const [defaults, search, stated] of [
      [
        DEFAULT_LIGHT_SETTINGS,
        "?light=v1:veil=28.22,tint=-21,tinta=-10",
        28.22,
      ],
      [
        lightDefaultsFor("urban"),
        "?light=v1:veil=28.22,tint=-21,tinta=-10",
        28.22,
      ],
      [DEFAULT_LIGHT_SETTINGS, "?light=v1:veil=2.55", 2.55],
      [lightDefaultsFor("urban"), "?light=v1:veil=2.55", 2.55],
    ] as const) {
      const s = parseLightSettings(search, defaults);
      expect(s.hazeVeilLightness).toBe(stated);
      expect(() =>
        veilSceneColour(veilOf(s)!, TONE_MAPPING_EXPOSURE),
      ).not.toThrow();
    }
  });
});

describe("applyLightOrFallback", () => {
  // WHY: the boot applies the link's settings with nothing around it, so a
  // value the view refuses would stop the whole page. It must open the
  // scheme's light instead, say so, and overwrite whatever the refused
  // settings had already applied.
  it("applies the settings, or warns and applies the fallback when they throw", () => {
    const urban = lightDefaultsFor("urban");
    const stated = { ...urban, hazeVisibilityKm: 15 };
    const applied: LightSettings[] = [];
    const warn = vi.fn();
    expect(
      applyLightOrFallback(stated, urban, (s) => applied.push(s), warn),
    ).toBe(stated);
    expect(applied).toEqual([stated]);
    expect(warn).not.toHaveBeenCalled();

    applied.length = 0;
    const refusing = (s: LightSettings) => {
      applied.push(s);
      if (s === stated) throw new RangeError("veil refused");
    };
    expect(applyLightOrFallback(stated, urban, refusing, warn)).toBe(urban);
    expect(applied).toEqual([stated, urban]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("veil refused");
  });
});
