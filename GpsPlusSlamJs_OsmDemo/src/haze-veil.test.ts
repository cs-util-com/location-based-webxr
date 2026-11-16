/**
 * Tests for the haze veil's colour (city look, a bright bluish veil).
 *
 * Why this file matters: the veil is tuned as the colour a fully hazed
 * distance SHOWS on screen (L* and b*), but the haze blends in scene-linear
 * light before tone mapping. If the inverse of the tone mapping were wrong,
 * the number on the slider would not be the colour on the screen, and every
 * measured comparison against the reference would rest on a mislabelled
 * value. The tone mapping is a mirror of three's GLSL, so its known values
 * are pinned first.
 */
import fc from "fast-check";
import { linearToSrgb, rgbToLab } from "gps-plus-slam-osm";
import { ShaderChunk } from "three";
import { describe, expect, it } from "vitest";

import { TONE_MAPPING_EXPOSURE } from "./atmosphere-rig.js";
import {
  clampHazeVeil,
  neutralToneMap,
  VEIL_DELTA_E_TOLERANCE,
  veilDisplayLinear,
  veilLightnessBounds,
  veilSceneColour,
  type HazeVeil,
} from "./haze-veil.js";
import { LIGHT_SETTING_RANGES } from "./light-settings.js";

type Rgb = readonly [number, number, number];

/** The L*a*b* a display-linear colour shows, through 8-bit sRGB. */
function shown(display: Rgb) {
  const byte = (v: number) => Math.round(linearToSrgb(v) * 255);
  return rgbToLab(
    (byte(display[0]) << 16) | (byte(display[1]) << 8) | byte(display[2]),
  );
}

/** Every value a slider can produce. */
function steps(r: { min: number; max: number; step: number }): number[] {
  const n = Math.round((r.max - r.min) / r.step);
  return Array.from({ length: n + 1 }, (_, k) =>
    Number((r.min + k * r.step).toFixed(3)),
  );
}

describe("neutralToneMap (three's Khronos Neutral, mirrored)", () => {
  // WHY: the inverse is only as right as this mirror; these are the curve's
  // three regions worked by hand from three's GLSL.
  it("subtracts the 0.04 offset, uses the toe below 0.08, compresses above 0.76", () => {
    const grey = (v: number, exposure = 1) =>
      neutralToneMap([v, v, v], exposure)[0];
    expect(grey(0.18)).toBeCloseTo(0.14, 12);
    expect(grey(0.36, 0.5)).toBeCloseTo(0.14, 12);
    // The toe: x - (x - 6.25 x^2) = 6.25 x^2.
    expect(grey(0.05)).toBeCloseTo(6.25 * 0.05 * 0.05, 12);
    // Compression: peak 0.96, d = 0.24, new peak 1 - 0.0576 / 0.44.
    expect(grey(1)).toBeCloseTo(1 - 0.0576 / 0.44, 12);
    // A colour keeps its offset per channel below the knee.
    const c = neutralToneMap([0.3, 0.4, 0.5], 1);
    expect(c[0]).toBeCloseTo(0.26, 12);
    expect(c[2]).toBeCloseTo(0.46, 12);
  });

  // WHY: the mirror is a copy of three's GLSL, and an upgrade of three that
  // changed the curve would leave it silently wrong. The constants it mirrors
  // must still be the ones in three's shader source.
  it("mirrors the constants of the three in use", () => {
    const glsl = ShaderChunk.tonemapping_pars_fragment;
    expect(glsl).toContain("const float StartCompression = 0.8 - 0.04;");
    expect(glsl).toContain("const float Desaturation = 0.15;");
    expect(glsl).toContain(
      "float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;",
    );
  });

  it("desaturates a colour above the knee", () => {
    // Worked by hand: offset 0.04 gives (0.96, 0.56, 0.16), peak 0.96, new
    // peak 1 - 0.0576 / 0.44, each channel scaled to it and mixed toward it
    // by g = 1 - 1 / (0.15 (peak - newPeak) + 1).
    const out = neutralToneMap([1, 0.6, 0.2], 1);
    expect(out[0]).toBeCloseTo(0.8690909090909091, 12);
    expect(out[1]).toBeCloseTo(0.5118412827829869, 12);
    expect(out[2]).toBeCloseTo(0.1545916564750646, 12);
  });
});

describe("veilSceneColour", () => {
  /** CIE76 Delta E between what the screen shows and what was asked. */
  const deltaE = (veil: HazeVeil) => {
    const lab = shown(
      neutralToneMap(
        veilSceneColour(veil, TONE_MAPPING_EXPOSURE),
        TONE_MAPPING_EXPOSURE,
      ),
    );
    return Math.hypot(
      lab.l - veil.lightness,
      lab.a - (veil.tintA ?? 0),
      lab.b - veil.tint,
    );
  };
  const everySecond = (r: { min: number; max: number; step: number }) =>
    steps(r).filter((v) => v % 2 === 0);

  // WHY: the sliders say what the screen shows. For every colour the three
  // sliders can ask for, the veil is either shown as asked (within the 8-bit
  // rounding of one colour) or its lightness is held at the stated rule's
  // bound for that colour, and the held colour is then shown as stated. The
  // a* and b* grid is every second unit here, exhaustive over the lightness
  // slider; the property below covers the half steps. Below L* 3 one 8-bit
  // step is worth about 2 of b*, so a near-black veil cannot show its tint
  // that closely; it still maps exactly (the round trip below), and a
  // daytime veil never sits there.
  it("shows every slider colour as asked, or holds its lightness at the colour's bound", () => {
    const lightnesses = steps(LIGHT_SETTING_RANGES.hazeVeilLightness).filter(
      (l) => l >= 3,
    );
    let worst = 0;
    for (const tintA of everySecond(LIGHT_SETTING_RANGES.hazeVeilTintA)) {
      for (const tint of everySecond(LIGHT_SETTING_RANGES.hazeVeilTint)) {
        const bounds = veilLightnessBounds(tintA, tint)!;
        for (const lightness of lightnesses) {
          const held = clampHazeVeil({ lightness, tint, tintA });
          expect(held.lightness).toBe(
            Math.min(Math.max(lightness, bounds.min), bounds.max),
          );
          expect([held.tint, held.tintA]).toEqual([tint, tintA]);
          worst = Math.max(worst, deltaE(held));
        }
      }
    }
    expect(worst).toBeLessThan(VEIL_DELTA_E_TOLERANCE);
  }, 60_000);

  // WHY: the same claim over the whole half-step grid of a* and b* and every
  // lightness, sampled with a fixed seed, so no half step escapes the rule.
  it("holds the rule over the whole a*, b* and L* range (property)", () => {
    const grid = (r: { min: number; max: number; step: number }) =>
      fc
        .integer({ min: 0, max: Math.round((r.max - r.min) / r.step) })
        .map((k) => Number((r.min + k * r.step).toFixed(3)));
    fc.assert(
      fc.property(
        grid(LIGHT_SETTING_RANGES.hazeVeilLightness).filter((l) => l >= 3),
        grid(LIGHT_SETTING_RANGES.hazeVeilTintA),
        grid(LIGHT_SETTING_RANGES.hazeVeilTint),
        (lightness, tintA, tint) => {
          const { min, max } = veilLightnessBounds(tintA, tint)!;
          const held = clampHazeVeil({ lightness, tint, tintA });
          const want =
            lightness < min ? min : lightness > max ? max : lightness;
          expect(held.lightness).toBe(want);
          expect(deltaE(held)).toBeLessThan(VEIL_DELTA_E_TOLERANCE);
        },
      ),
      { numRuns: 500, seed: 20261116 },
    );
  }, 60_000);

  // WHY: the bounds ARE the rule the dialog states. Every slider colour must
  // have a lightness it can show, the lightnesses it can show must be one
  // unbroken run (so holding at a bound never skips a showable value), and
  // one step past the upper bound must be refused (the knee, or out of the
  // screen's colours).
  it("gives every slider colour one unbroken run of showable lightnesses", () => {
    // Collected rather than asserted one by one: tens of thousands of
    // expect calls cost more than the colour maths.
    const wrong: string[] = [];
    const shows = (veil: HazeVeil) => {
      try {
        veilSceneColour(veil, 1);
        return true;
      } catch {
        return false;
      }
    };
    for (const tintA of everySecond(LIGHT_SETTING_RANGES.hazeVeilTintA)) {
      for (const tint of everySecond(LIGHT_SETTING_RANGES.hazeVeilTint)) {
        const bounds = veilLightnessBounds(tintA, tint);
        if (bounds === null) {
          wrong.push(`${tintA} ${tint}: no bounds`);
          continue;
        }
        const { min, max } = bounds;
        for (let tenth = Math.round(min * 10); tenth <= max * 10; tenth += 5) {
          if (!shows({ lightness: tenth / 10, tint, tintA })) {
            wrong.push(`${tintA} ${tint}: L* ${tenth / 10} refused`);
          }
        }
        const above = Number((max + 0.1).toFixed(1));
        if (shows({ lightness: above, tint, tintA })) {
          wrong.push(`${tintA} ${tint}: L* ${above} above the bound shown`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // Neutral reaches the knee near L* 90; a strong yellow or blue far lower.
    expect(veilLightnessBounds(0, 0)!.max).toBeGreaterThan(89);
    expect(veilLightnessBounds(0, 40)!.max).toBeLessThan(82);
    expect(veilLightnessBounds(0, -24)!.max).toBeLessThan(75);
    // A strong yellow cannot be dark: below about L* 30 it leaves the gamut.
    expect(veilLightnessBounds(0, 40)!.min).toBeGreaterThan(30);
  }, 60_000);

  it("refuses a colour no lightness can show", () => {
    expect(veilLightnessBounds(90, -90)).toBeNull();
    expect(() =>
      clampHazeVeil({ lightness: 50, tint: -90, tintA: 90 }),
    ).toThrow(RangeError);
  });

  // WHY: the veil is display-referred, so it holds at any renderer exposure
  // the inverse is given; the sky's EV does not enter it at all.
  it("holds at any renderer exposure", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: -24, max: 8 }).map((k) => k / 2),
        fc.integer({ min: -8, max: 8 }).map((k) => k / 2),
        fc.double({ min: 0.25, max: 2, noNaN: true }),
        (lightness, tint, tintA, exposure) => {
          const veil: HazeVeil = { lightness, tint, tintA };
          const back = neutralToneMap(
            veilSceneColour(veil, exposure),
            exposure,
          );
          const display = veilDisplayLinear(veil);
          for (let i = 0; i < 3; i++) {
            expect(back[i]).toBeCloseTo(display[i]!, 9);
          }
        },
      ),
      { numRuns: 300, seed: 20261115 },
    );
  });

  // WHY: a brighter veil must give a brighter scene colour, and a more
  // negative tint a bluer one; otherwise the slider would run backwards.
  it("is monotone in lightness, and bluer for a lower tint", () => {
    const e = TONE_MAPPING_EXPOSURE;
    const a = veilSceneColour({ lightness: 60, tint: -4 }, e);
    const b = veilSceneColour({ lightness: 80, tint: -4 }, e);
    expect(b.every((v, i) => v > a[i]!)).toBe(true);
    const warm = veilSceneColour({ lightness: 80, tint: 2 }, e);
    const blue = veilSceneColour({ lightness: 80, tint: -10 }, e);
    expect(blue[2] - blue[0]).toBeGreaterThan(warm[2] - warm[0]);
    // a*: above 0 redder, below 0 greener.
    const red = veilSceneColour({ lightness: 70, tint: 0, tintA: 6 }, e);
    const green = veilSceneColour({ lightness: 70, tint: 0, tintA: -6 }, e);
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(green[0]).toBeLessThan(green[1]);
  });

  it("refuses a veil it cannot show, or a bad exposure", () => {
    const e = TONE_MAPPING_EXPOSURE;
    for (const bad of [
      { lightness: 0, tint: -4 },
      { lightness: Number.NaN, tint: -4 },
      { lightness: 80, tint: Number.POSITIVE_INFINITY },
      { lightness: 80, tint: -4, tintA: Number.NaN },
      // Outside the screen's colours: a strong yellow this dark is clipped.
      { lightness: 10, tint: 40 },
      // Above the tone curve's compression knee: no exact inverse there.
      { lightness: 98, tint: -4 },
    ]) {
      expect(() => veilSceneColour(bad, e), JSON.stringify(bad)).toThrow(
        RangeError,
      );
    }
    expect(() => veilSceneColour({ lightness: 80, tint: -4 }, 0)).toThrow(
      RangeError,
    );
  });
});
