import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRollingWindow } from "./rolling-window";

/**
 * Why this property matters (visitor walk W4 build plan M3): the readout's
 * mean and worst must be exactly those of the samples inside the window,
 * whatever the rate and the gaps; a naive filter over every sample is the
 * oracle.
 */

describe("createRollingWindow - properties", () => {
  it("matches a naive filter over every sample (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gap: fc.integer({ min: 0, max: 400 }),
            value: fc.double({ min: 0, max: 200, noNaN: true }),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        fc.integer({ min: 0, max: 3000 }),
        (samples, after) => {
          const w = createRollingWindow(2000, 4096);
          let at = 0;
          const all: { at: number; value: number }[] = [];
          for (const s of samples) {
            at += s.gap;
            w.push(at, s.value);
            all.push({ at, value: s.value });
          }
          const now = at + after;
          const inside = all.filter((s) => now - s.at <= 2000);
          const summary = w.summary(now);
          const expected =
            inside.length === 0
              ? null
              : {
                  count: inside.length,
                  worst: Math.max(...inside.map((s) => s.value)),
                  mean:
                    inside.reduce((sum, s) => sum + s.value, 0) / inside.length,
                };
          expect(summary === null).toBe(expected === null);
          expect(summary?.count).toBe(expected?.count);
          expect(summary?.worst).toBe(expected?.worst);
          expect(
            Math.abs((summary?.mean ?? 0) - (expected?.mean ?? 0)),
          ).toBeLessThan(1e-6);
        },
      ),
    );
  });
});
