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
import { describe, expect, it } from "vitest";

import { TONE_MAPPING_EXPOSURE } from "./atmosphere-rig.js";
import {
  neutralToneMap,
  veilDisplayLinear,
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
});

describe("veilSceneColour", () => {
  // WHY: the slider says what the screen shows. For EVERY value the two
  // sliders can produce, the scene colour, tone mapped at the renderer's
  // exposure, must show that L* and b* (and a* 0) to within the 8-bit
  // rounding of one colour. Exhaustive, so no slider value sits above the
  // tone curve's knee where the inverse would not hold. Below L* 3 one 8-bit
  // step is worth about 2 of b*, so a near-black veil cannot show its tint
  // that closely; it still maps exactly (the property below), and a
  // daytime veil never sits there.
  it("shows the chosen L* and b* on screen at every slider value", () => {
    const lightnesses = steps(LIGHT_SETTING_RANGES.hazeVeilLightness).filter(
      (l) => l >= 3,
    );
    const tints = steps(LIGHT_SETTING_RANGES.hazeVeilTint);
    let worst = 0;
    for (const lightness of lightnesses) {
      for (const tint of tints) {
        const scene = veilSceneColour(
          { lightness, tint },
          TONE_MAPPING_EXPOSURE,
        );
        const lab = shown(neutralToneMap(scene, TONE_MAPPING_EXPOSURE));
        worst = Math.max(
          worst,
          Math.abs(lab.l - lightness),
          Math.abs(lab.a),
          Math.abs(lab.b - tint),
        );
      }
    }
    expect(worst).toBeLessThan(0.8);
  });

  // WHY: the veil is display-referred, so it holds at any renderer exposure
  // the inverse is given; the sky's EV does not enter it at all.
  it("holds at any renderer exposure", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: -24, max: 8 }).map((k) => k / 2),
        fc.double({ min: 0.25, max: 2, noNaN: true }),
        (lightness, tint, exposure) => {
          const veil: HazeVeil = { lightness, tint };
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
  });

  it("refuses a veil it cannot show, or a bad exposure", () => {
    const e = TONE_MAPPING_EXPOSURE;
    for (const bad of [
      { lightness: 0, tint: -4 },
      { lightness: Number.NaN, tint: -4 },
      { lightness: 80, tint: Number.POSITIVE_INFINITY },
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
