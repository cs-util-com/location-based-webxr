/**
 * The terrain debug ramp — the part of W24 provable without a GPU.
 *
 * WHY THESE TESTS MATTER. This layer exists to answer one question instantly:
 * "is the terrain actually loaded, or is Cologne just flat?" DEC-R2-1 keeps the
 * primary look nearly flat on purpose, which leaves `terrain ±N m` in the status
 * line as the only signal distinguishing genuinely-flat ground from a DEM that
 * never arrived — and a number carrying a diagnostic job that a picture does
 * better.
 *
 * So the ramp is only useful if it is normalised over the field's ACTUAL range.
 * `geo-three`'s `HeightDebugProvider` is the cautionary version: it divides by
 * `1667721.6`, the theoretical maximum of the height encoding, so real 0–8000 m
 * terrain lands in a razor-thin slice at the bottom of the ramp and the output is
 * effectively monochrome. That failure looks exactly like "the terrain is flat",
 * i.e. it produces the very answer the layer was added to rule out.
 */

import { describe, expect, it } from "vitest";

import {
  NO_DATA_RGB,
  heightRampColours,
  rampColour,
  rampRange,
} from "./height-ramp.js";

/** Decimal places both sides are rounded to before comparison. */
const PLACES = 6;

/**
 * One RGB triple out of the packed buffer, rounded.
 *
 * The buffer is a `Float32Array` because that is what a three.js
 * `BufferAttribute` takes, so every value has been through single precision and
 * 0.05 comes back as 0.05000000074505806. Comparing that against a double literal
 * is a test that fails on arithmetic which is entirely correct. Rounding BOTH
 * sides keeps the assertion a plain array equality, so the whole triple is
 * compared at once and a failure prints all three channels.
 */
function tripleAt(colours: Float32Array, index: number): number[] {
  return [0, 1, 2].map((channel) =>
    Number((colours[index * 3 + channel] ?? Number.NaN).toFixed(PLACES)),
  );
}

/** The expected triple, rounded the same way. */
function rounded(triple: readonly [number, number, number]): number[] {
  return triple.map((value) => Number(value.toFixed(PLACES)));
}

describe("rampRange", () => {
  it("uses the data's own min and max, not a theoretical range", () => {
    // THE POINT OF THE WHOLE MODULE. Cologne's relief is a few tens of metres on
    // top of a ~53 m datum; against any fixed range that is a flat wash.
    expect(rampRange([50, 55, 60])).toEqual({ min: 50, max: 60 });
  });

  it("ignores non-finite samples when computing the range", () => {
    // A single NaN would otherwise make min and max NaN, and every comparison
    // against NaN is false — so the entire ramp would silently collapse to one
    // colour, which is indistinguishable from flat ground.
    expect(rampRange([50, Number.NaN, 60, Number.POSITIVE_INFINITY])).toEqual({
      min: 50,
      max: 60,
    });
  });

  it("reports an empty range when there is no finite data at all", () => {
    // Not a throw: a DEM outage is a normal state this demo has to render, and
    // `undefined` is the honest answer that the caller can turn into "no data"
    // rather than into a plausible-looking flat surface.
    expect(rampRange([])).toBeUndefined();
    expect(rampRange([Number.NaN])).toBeUndefined();
  });

  it("survives a field of 100k posts without spreading it onto the stack", () => {
    // `Math.max(...heights)` throws RangeError above ~100–125k arguments, and the
    // ground plane is 129x129 = 16 641 today but W23 removes the cap that keeps it
    // there. This repo has already had to fix that exact call once.
    const many = new Float32Array(100_000);
    for (let i = 0; i < many.length; i += 1) many[i] = i;
    expect(rampRange(many)).toEqual({ min: 0, max: 99_999 });
  });
});

describe("rampColour", () => {
  it("is a real ramp: the ends differ, and strongly", () => {
    const low = rampColour(0);
    const high = rampColour(1);
    // Not merely "different" — far apart, or the layer cannot be read at a glance.
    const distance = Math.hypot(
      low[0] - high[0],
      low[1] - high[1],
      low[2] - high[2],
    );
    expect(distance).toBeGreaterThan(0.8);
  });

  it("rises monotonically in luminance, so higher always reads as higher", () => {
    // A ramp that dips in the middle makes two different heights the same
    // apparent brightness, and a reader cannot tell which way the slope runs.
    const luma = (t: number): number => {
      const [r, g, b] = rampColour(t);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (let i = 1; i <= 40; i += 1) {
      expect(luma(i / 40)).toBeGreaterThan(luma((i - 1) / 40));
    }
  });

  it("stays inside the unit cube across and beyond its domain", () => {
    // Values outside 0..1 are clamped rather than extrapolated: an out-of-range
    // channel wraps in the shader instead of saturating, so a slightly-high
    // sample would render as a hole of the opposite colour.
    for (const t of [-1, -0.001, 0, 0.5, 1, 1.001, 2]) {
      for (const channel of rampColour(t)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("heightRampColours", () => {
  it("emits one RGB triple per height", () => {
    expect(heightRampColours([0, 1, 2])).toHaveLength(9);
  });

  it("spans the full ramp across the field's range", () => {
    const colours = heightRampColours([10, 20]);
    expect(tripleAt(colours, 0)).toEqual(rounded(rampColour(0)));
    expect(tripleAt(colours, 1)).toEqual(rounded(rampColour(1)));
  });

  it("renders a genuinely flat field as the ramp's floor, not as a divide by zero", () => {
    // min === max, so the normalisation denominator is 0. Left alone this is
    // `0/0 = NaN` in every channel, and a NaN vertex colour renders as black or
    // as garbage depending on the driver — a rendering artefact that reads as a
    // bug in the terrain rather than as "this ground is flat".
    const colours = heightRampColours([42, 42, 42]);
    for (const index of [0, 1, 2]) {
      expect(tripleAt(colours, index)).toEqual(rounded(rampColour(0)));
    }
  });

  it("marks a post with no data distinctly instead of guessing a height", () => {
    // The whole reason this layer exists is to tell "loaded and flat" from "not
    // loaded". Colouring a missing post with a plausible ramp value would defeat
    // that at exactly the moment it matters.
    const colours = heightRampColours([10, Number.NaN, 20]);
    expect(tripleAt(colours, 1)).toEqual(rounded(NO_DATA_RGB));
    // And the missing post does not drag the range: 10 and 20 still span it.
    expect(tripleAt(colours, 0)).toEqual(rounded(rampColour(0)));
    expect(tripleAt(colours, 2)).toEqual(rounded(rampColour(1)));
  });

  it("renders an all-missing field entirely as no-data", () => {
    const colours = heightRampColours([Number.NaN, Number.NaN]);
    expect(tripleAt(colours, 0)).toEqual(rounded(NO_DATA_RGB));
    expect(tripleAt(colours, 1)).toEqual(rounded(NO_DATA_RGB));
  });
});
