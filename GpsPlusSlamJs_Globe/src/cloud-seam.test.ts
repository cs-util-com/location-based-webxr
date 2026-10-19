/**
 * Why this test matters: NASA's cloud map does not wrap (round-3 plan
 * 2026-10-08-2345 §16): its left and right edge columns were never made to
 * match, so the globe drew a hard line down the date line. The fetch script
 * eases both edges to their per-row average before it cuts the map into
 * pieces (§18). These tests pin what that blend must do: close the wrap
 * exactly, leave everything outside its band untouched, never add a jump
 * of its own anywhere in the band, and refuse sizes it cannot blend; and
 * they pin the measure the committed-pieces test judges the seam by.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { blendWrapSeam, columnJump, typicalColumnJump } from "./cloud-seam.js";

/** A map from a function of (column, row). */
function mapOf(
  width: number,
  height: number,
  at: (x: number, y: number) => number,
): Uint8Array {
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grey[y * width + x] = at(x, y);
  }
  return grey;
}

describe("blendWrapSeam", () => {
  it("makes the two edge columns equal, at their per-row average", () => {
    // Left edge 200, right edge 100 in row 0; 0 and 50 in row 1.
    const grey = mapOf(8, 2, (x, y) =>
      x === 0 ? (y === 0 ? 200 : 0) : x === 7 ? (y === 0 ? 100 : 50) : 120,
    );
    const out = blendWrapSeam(grey, 8, 2, 2);
    expect(out[0]).toBe(150);
    expect(out[7]).toBe(150);
    expect(out[8]).toBe(25);
    expect(out[15]).toBe(25);
    // The input is not changed.
    expect(grey[0]).toBe(200);
  });

  it("shifts each row's band by an eased share of its edge's offset, nothing outside it", () => {
    // West half 40, east half 200: the wrap pair is 40 against 200.
    const width = 64;
    const columns = 8;
    const grey = mapOf(width, 3, (x) => (x < width / 2 ? 40 : 200));
    const out = blendWrapSeam(grey, width, 3, columns);
    for (let y = 0; y < 3; y++) {
      const row = Array.from(out.subarray(y * width, (y + 1) * width));
      // Outside the band: untouched (the jump in the middle stays).
      for (let x = columns; x < width - columns; x++) {
        expect(row[x]).toBe(x < width / 2 ? 40 : 200);
      }
      // Inside: from the average (120) at the edge back to the source,
      // strictly, on both sides.
      expect(row[0]).toBe(120);
      expect(row[width - 1]).toBe(120);
      for (let k = 1; k < columns; k++) {
        expect(row[k]!).toBeLessThan(row[k - 1]!);
        expect(row[k]!).toBeGreaterThan(40);
        expect(row[width - 1 - k]!).toBeGreaterThan(row[width - k]!);
        expect(row[width - 1 - k]!).toBeLessThan(200);
      }
    }
  });

  // A Uint8Array wraps rather than clamps: 250 lifted by 127.5 would read
  // as 121, a dark hole in a bright cloud next to the date line.
  it("clamps to the grey levels instead of wrapping", () => {
    const grey = mapOf(8, 1, (x) => (x === 0 ? 0 : x === 7 ? 255 : 250));
    const out = blendWrapSeam(grey, 8, 1, 3);
    expect(out[1]).toBe(255);
    const dark = mapOf(8, 1, (x) => (x === 0 ? 255 : x === 7 ? 0 : 5));
    expect(blendWrapSeam(dark, 8, 1, 3)[1]).toBe(0);
  });

  it("refuses a band it cannot fit, a size that does not match, or a bad width", () => {
    const grey = new Uint8Array(16);
    expect(() => blendWrapSeam(grey, 8, 2, 0)).toThrow(RangeError);
    expect(() => blendWrapSeam(grey, 8, 2, 5)).toThrow(RangeError);
    expect(() => blendWrapSeam(grey, 8, 2, 1.5)).toThrow(RangeError);
    expect(() => blendWrapSeam(grey, 8, 3, 2)).toThrow(RangeError);
    expect(() => blendWrapSeam(grey, 0, 2, 2)).toThrow(RangeError);
  });

  // Why: the blend moves a row's band by a smooth ramp, so no neighbouring
  // pair inside it may jump by more than it did before plus the ramp's own
  // steepest step (the edge offset times the ramp's largest slope, pi / 2
  // over the band for the cosine ease, plus one grey level of rounding);
  // and the wrap pair always ends equal.
  it("never adds a jump steeper than its ramp anywhere, and always closes the wrap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 4 }),
        fc.uint8Array({ minLength: 64 * 4, maxLength: 64 * 4 }),
        (columns, height, raw) => {
          const width = 64;
          const grey = raw.subarray(0, width * height);
          const out = blendWrapSeam(grey, width, height, columns);
          for (let y = 0; y < height; y++) {
            const i = y * width;
            expect(out[i]).toBe(out[i + width - 1]);
            const offset = Math.abs(grey[i]! - grey[i + width - 1]!) / 2;
            const step = (offset * Math.PI) / (2 * columns) + 1;
            for (let x = 0; x < width - 1; x++) {
              const before = Math.abs(grey[i + x + 1]! - grey[i + x]!);
              const after = Math.abs(out[i + x + 1]! - out[i + x]!);
              expect(after).toBeLessThanOrEqual(before + 2 * step);
            }
          }
        },
      ),
    );
  });
});

describe("the seam's measure", () => {
  it("reads a pair's mean and largest jump over the rows, wrapping at the right edge", () => {
    const grey = mapOf(4, 2, (x, y) => [10, 20, 40, 0][x]! + y * 2);
    expect(columnJump(grey, 4, 2, 0)).toEqual({ mean: 10, max: 10 });
    expect(columnJump(grey, 4, 2, 2)).toEqual({ mean: 40, max: 40 });
    // The wrap pair: column 3 against column 0.
    expect(columnJump(grey, 4, 2, 3)).toEqual({ mean: 10, max: 10 });
    expect(() => columnJump(grey, 4, 2, 4)).toThrow(RangeError);
  });

  it("takes the median over interior pairs, away from the seam", () => {
    // Every interior pair jumps by 1 (a ramp); the seam pair by 199, and
    // the band next to it (16 columns each side) is left out of the median.
    const grey = mapOf(200, 3, (x) => (x < 4 ? 0 : x));
    const typical = typicalColumnJump(grey, 200, 3, 16);
    expect(typical.mean).toBe(1);
    expect(typical.max).toBe(1);
    expect(() => typicalColumnJump(grey, 200, 3, 100)).toThrow(RangeError);
  });

  it("takes any quantile, interpolated between pairs", () => {
    // Pair x jumps by x (x = 0 to 9): the 0.9 quantile of 0..9 is 8.1.
    const values = [0];
    for (let x = 1; x < 11; x++) values.push(values[x - 1]! + x - 1);
    const grey = mapOf(11, 1, (x) => values[x]!);
    expect(typicalColumnJump(grey, 11, 1, 0, 0.9).mean).toBeCloseTo(8.1, 9);
    expect(typicalColumnJump(grey, 11, 1, 0, 0).max).toBe(0);
    expect(typicalColumnJump(grey, 11, 1, 0, 1).max).toBe(9);
    expect(() => typicalColumnJump(grey, 11, 1, 0, 1.5)).toThrow(RangeError);
  });
});
