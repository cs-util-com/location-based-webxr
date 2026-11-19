import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { formatMs, summarize } from "./bench-stats";

// Why these tests matter: the benchmark's whole output is a median and a
// p90 per method and size; a wrong rank rule or an empty sample read as 0 ms
// would make a slow method look fast in the log a tester pastes.
describe("summarize", () => {
  it("gives the interpolating median and the nearest-rank p90", () => {
    const s = summarize([10, 1, 4, 3, 2, 5, 6, 7, 8, 9]);
    expect(s).toEqual({ n: 10, median: 5.5, p90: 9, min: 1, max: 10 });
  });

  it("reads one sample as its own median and p90", () => {
    expect(summarize([7])).toEqual({ n: 1, median: 7, p90: 7, min: 7, max: 7 });
  });

  it("marks an empty sample as NaN, never as 0 ms", () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.median).toBeNaN();
    expect(s.p90).toBeNaN();
  });

  it("refuses a non-finite sample (a timing bug, not a measurement)", () => {
    expect(() => summarize([1, Number.NaN])).toThrow(RangeError);
    expect(() => summarize([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it("keeps min <= median <= p90 <= max for any sample (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), {
          minLength: 1,
          maxLength: 60,
        }),
        (xs) => {
          const s = summarize(xs);
          expect(s.min).toBeLessThanOrEqual(s.median);
          expect(s.median).toBeLessThanOrEqual(s.p90);
          expect(s.p90).toBeLessThanOrEqual(s.max);
          expect(s.n).toBe(xs.length);
        },
      ),
    );
  });
});

describe("formatMs", () => {
  it("prints one decimal below 100 ms and none above", () => {
    expect(formatMs(3.14159)).toBe("3.1");
    expect(formatMs(123.6)).toBe("124");
  });

  it("prints a dash for a missing value", () => {
    expect(formatMs(Number.NaN)).toBe("-");
  });
});
