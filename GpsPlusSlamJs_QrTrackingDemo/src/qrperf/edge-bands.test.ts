/**
 * The `?qrperf` size bands (plan §34 R2).
 *
 * Why these tests matter: every pixel threshold in the QR pipeline is
 * absolute, and the next field round must show how the pixel signals grow
 * with the code's size on screen before any threshold becomes
 * size-relative. The band edges must be stable and the empty case explicit,
 * or a phone JSON would be misread.
 */
import { describe, expect, it } from "vitest";
import { createBandedPercentiles, edgeBand } from "./edge-bands.js";

describe("edgeBand", () => {
  it("splits at 150 and 300 px, lower edge inclusive", () => {
    expect(edgeBand(20)).toBe("small");
    expect(edgeBand(149.9)).toBe("small");
    expect(edgeBand(150)).toBe("medium");
    expect(edgeBand(299.9)).toBe("medium");
    expect(edgeBand(300)).toBe("large");
  });

  it("has no band without a finite size", () => {
    expect(edgeBand(null)).toBeNull();
    expect(edgeBand(Number.NaN)).toBeNull();
  });
});

describe("createBandedPercentiles", () => {
  it("summarises each band, null where empty", () => {
    const b = createBandedPercentiles();
    for (let i = 1; i <= 10; i++) b.add(100, i);
    b.add(400, 7);
    b.add(null, 99);
    expect(b.summary()).toEqual({
      small: { n: 10, p50: 5, p95: 10 },
      medium: { n: 0, p50: null, p95: null },
      large: { n: 1, p50: 7, p95: 7 },
    });
  });

  it("keeps only the last `window` values per band when capped", () => {
    const b = createBandedPercentiles(3);
    for (let i = 1; i <= 10; i++) b.add(100, i);
    expect(b.summary().small).toEqual({ n: 3, p50: 9, p95: 10 });
  });

  it("ignores non-finite values", () => {
    const b = createBandedPercentiles();
    b.add(100, Number.NaN);
    b.add(100, Infinity);
    expect(b.summary().small.n).toBe(0);
  });
});
