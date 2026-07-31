/**
 * WHY THESE TESTS MATTER. The sky's arithmetic fails in ways that look
 * deliberate: a gradient upside down reads as a stylistic choice, a sun in the
 * wrong row reads as a different time of day, and a smeared disc reads as
 * "clouds, sort of". None of it throws, and the e2e pixel assertions are
 * satisfied by any non-background colour. So the ramp, the sun's position and
 * the rotation that places it are all asserted here, where they are provable
 * without a GPU.
 *
 * W14 widened this from ONE pixel to a real image, and that is the point rather
 * than a refactor: a single-column equirectangular map has no azimuth, so it was
 * physically incapable of holding the sun the notes asked for.
 */

import { describe, expect, it } from "vitest";

import {
  HORIZON_RGB,
  SKY_GRADIENT_COLUMNS,
  SKY_GRADIENT_ROWS,
  SUN_DISC_RGB,
  SUN_GLOW_RGB,
  ZENITH_RGB,
  skyGradientPixels,
  skyRotationForSun,
} from "./sky-gradient.js";

const ELEVATION = Math.PI / 6;

function pixel(
  data: Uint8Array,
  row: number,
  column: number,
  columns = SKY_GRADIENT_COLUMNS,
): [number, number, number] {
  const i = (row * columns + column) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

/** Perceived brightness, enough to rank pixels. */
const luma = ([r, g, b]: [number, number, number]): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("skyGradientPixels", () => {
  const sky = skyGradientPixels({ sunElevationRad: ELEVATION });

  it("fills every pixel, opaque", () => {
    expect(sky.length).toBe(SKY_GRADIENT_ROWS * SKY_GRADIENT_COLUMNS * 4);
    for (let i = 3; i < sky.length; i += 4) expect(sky[i]).toBe(255);
  });

  it("runs zenith at the TOP to horizon at the BOTTOM", () => {
    // Backwards, this is a sky that is bright overhead and dark at the horizon —
    // which looks like a choice rather than a bug. Sampled away from the sun so
    // the glow does not confuse the ramp.
    const away = 0;
    expect(pixel(sky, 0, away)).toEqual([...ZENITH_RGB]);
    expect(pixel(sky, SKY_GRADIENT_ROWS - 1, away)).toEqual([...HORIZON_RGB]);
  });

  it("is monotonic down a column, away from the sun", () => {
    let previous = -1;
    for (let row = 0; row < SKY_GRADIENT_ROWS; row++) {
      const value = luma(pixel(sky, row, 0));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("puts a sun disc at the baked azimuth", () => {
    // THE ASSERTION W14 EXISTS FOR. "No sun" was the complaint, and a
    // single-column texture could not have had one.
    const centre = Math.round((SKY_GRADIENT_COLUMNS - 1) / 2);
    const sunRow = Math.round(
      (1 - (ELEVATION / Math.PI + 0.5)) * (SKY_GRADIENT_ROWS - 1),
    );
    expect(pixel(sky, sunRow, centre)).toEqual([...SUN_DISC_RGB]);
  });

  it("puts the sun at the sun's ELEVATION, not in the middle of the image", () => {
    // A sun at a fixed row would disagree with the light the moment
    // SUN_ELEVATION_RAD changed — the two-sources-of-truth defect, in the one
    // place it would look merely atmospheric.
    const centre = Math.round((SKY_GRADIENT_COLUMNS - 1) / 2);
    const high = skyGradientPixels({ sunElevationRad: Math.PI / 2.2 });
    const low = skyGradientPixels({ sunElevationRad: 0.05 });
    const brightestRow = (data: Uint8Array): number => {
      let best = 0;
      let bestLuma = -1;
      for (let row = 0; row < SKY_GRADIENT_ROWS; row++) {
        const value = luma(pixel(data, row, centre));
        if (value > bestLuma) {
          bestLuma = value;
          best = row;
        }
      }
      return best;
    };
    // Higher sun, higher in the image (row 0 is the top).
    expect(brightestRow(high)).toBeLessThan(brightestRow(low));
  });

  it("is symmetric about the sun's column, so the disc is round", () => {
    // The sun sits at column (columns - 1) / 2 = 127.5 for an even width, so
    // the mirror pair is (127 - k, 128 + k) rather than (c - k, c + k). Getting
    // that wrong is what a half-pixel asymmetry looks like, and it would show as
    // a disc that is subtly lopsided rather than as anything obviously broken.
    const sunRow = Math.round(
      (1 - (ELEVATION / Math.PI + 0.5)) * (SKY_GRADIENT_ROWS - 1),
    );
    const left = Math.floor((SKY_GRADIENT_COLUMNS - 1) / 2);
    const right = Math.ceil((SKY_GRADIENT_COLUMNS - 1) / 2);
    for (const offset of [0, 2, 5, 12, 30]) {
      expect(pixel(sky, sunRow, left - offset)).toEqual(
        pixel(sky, sunRow, right + offset),
      );
    }
  });

  it("warms the sky around the sun and leaves it cool far away", () => {
    // The other half of "sehr rudimentär": a uniformly cool sky is what made it
    // read as a blue sphere.
    const centre = Math.round((SKY_GRADIENT_COLUMNS - 1) / 2);
    const sunRow = Math.round(
      (1 - (ELEVATION / Math.PI + 0.5)) * (SKY_GRADIENT_ROWS - 1),
    );
    // Close enough that the quadratic falloff still has real weight: the glow
    // reaches ~0.55 rad and a column is 2π/256, so +15 columns is already most
    // of the way out and reads as sky again.
    const near = pixel(sky, sunRow, centre + 6);
    const far = pixel(sky, sunRow, 0);
    // Warm means red exceeds blue; the base sky is the opposite.
    expect(near[0]).toBeGreaterThan(near[2]);
    expect(far[0]).toBeLessThan(far[2]);
    // And the glow tends TOWARDS the declared colour rather than to some other
    // warm — a blend that drifted would still satisfy "red beats blue".
    const justOutsideTheDisc = pixel(sky, sunRow, centre + 3);
    for (let channel = 0; channel < 3; channel++) {
      const target = SUN_GLOW_RGB[channel] ?? 0;
      const base = pixel(sky, sunRow, 0)[channel] ?? 0;
      const value = justOutsideTheDisc[channel] ?? 0;
      // Between the base sky and the glow colour, inclusive, on every channel.
      expect(value).toBeGreaterThanOrEqual(Math.min(base, target) - 1);
      expect(value).toBeLessThanOrEqual(Math.max(base, target) + 1);
    }
  });

  it("rejects a degenerate size rather than producing a broken sky", () => {
    expect(() => skyGradientPixels({ rows: 1, sunElevationRad: 0 })).toThrow(
      RangeError,
    );
    expect(() => skyGradientPixels({ columns: 1, sunElevationRad: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("skyRotationForSun", () => {
  it("turns the sky by exactly as much as the sun turns", () => {
    // The relationship is what keeps the painted disc and the DirectionalLight
    // in agreement; a rotation that lagged or led would show as a sun that
    // drifts away from its own highlights as the camera orbits.
    const a = skyRotationForSun(0);
    const b = skyRotationForSun(1);
    expect(b - a).toBeCloseTo(1, 12);
  });

  it("puts the baked column at the sun's azimuth, per three's equirect mapping", () => {
    // The derivation, encoded. three samples `equirectUv(Rᵀ · d)` with
    // `u = atan2(d.z, d.x)/2π + 0.5`, and for a rotation about y by θ that gives
    // `u = (π/2 − (A − θ))/2π + 0.5`. This recomputes it and asserts the sun
    // lands on the baked column — which is the one part of W14 that is arithmetic
    // rather than taste, and the part a screenshot would not tell you was wrong.
    for (const azimuth of [-2, -0.5, 0, 0.7, 2.5]) {
      const theta = skyRotationForSun(azimuth);
      const h = Math.cos(Math.PI / 6);
      const s = { x: h * Math.sin(azimuth), z: h * Math.cos(azimuth) };
      // Rᵀ · s for a Y rotation by theta.
      const x = Math.cos(theta) * s.x - Math.sin(theta) * s.z;
      const z = Math.sin(theta) * s.x + Math.cos(theta) * s.z;
      const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
      expect(u).toBeCloseTo(0.5, 10);
    }
  });
});
