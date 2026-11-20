import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
import {
  iterationBudget,
  liveEta,
  memoryBudgetBytes,
  photoScale,
} from "./training-budget.js";

/**
 * Why these properties matter: a budget over the adapter's limits is a
 * failed allocation on the creator's device, maybe after minutes of
 * reading photos; an estimate that grows while the work shrinks is one
 * nobody trusts. Both must hold for any device and any window.
 */

const RUNS = { numRuns: 300 };
const MB = 1024 * 1024;

const settingsArb = fc
  .record({
    targetMemoryBytes: fc.integer({ min: 16 * MB, max: 2048 * MB }),
    bytesPerPixel: fc.integer({ min: 4, max: 32 }),
    minShortSidePx: fc.constantFrom(64, 128, 256),
    itersPerFrame: fc.constantFrom(90, 150, 300),
    minIterations: fc.integer({ min: 0, max: 8000 }),
    span: fc.integer({ min: 0, max: 40000 }),
    etaMinIterations: fc.integer({ min: 1, max: 500 }),
  })
  .map(({ span, ...s }): TrainerSettings => ({
    ...TRAINER_DEFAULTS,
    ...s,
    maxIterations: s.minIterations + span,
  }));

describe("training budget (property)", () => {
  it("never budgets more memory than the target, half the binding or the largest buffer", () => {
    fc.assert(
      fc.property(
        settingsArb,
        fc.integer({ min: 1, max: 8192 * MB }),
        fc.integer({ min: 1, max: 8192 * MB }),
        (settings, binding, buffer) => {
          const budget = memoryBudgetBytes(
            { maxStorageBufferBindingSize: binding, maxBufferSize: buffer },
            settings,
          );
          expect(budget).toBeLessThanOrEqual(settings.targetMemoryBytes);
          expect(budget).toBeLessThanOrEqual(binding / 2);
          expect(budget).toBeLessThanOrEqual(buffer);
        },
      ),
      RUNS,
    );
  });

  it("never sizes photos over the budget, never upscales, and keeps their shape", () => {
    fc.assert(
      fc.property(
        settingsArb,
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 2048 * MB }),
        (settings, frames, width, height, budget) => {
          const scale = photoScale(frames, width, height, budget, settings);
          // Too large only when even the shortest side would not fit.
          expect(scale.kind === "fits" || scale.neededBytes > budget).toBe(
            true,
          );
          if (scale.kind === "too-large") return;
          expect(scale.bytes).toBeLessThanOrEqual(budget);
          expect(scale.bytes).toBe(
            frames * scale.width * scale.height * settings.bytesPerPixel,
          );
          expect(scale.width).toBeLessThanOrEqual(width);
          expect(scale.height).toBeLessThanOrEqual(height);
          expect(Math.min(scale.width, scale.height)).toBeGreaterThanOrEqual(
            Math.min(settings.minShortSidePx, width, height),
          );
          // Shape kept to within the one pixel each side loses to rounding.
          expect(
            Math.abs(scale.width * height - scale.height * width),
          ).toBeLessThanOrEqual(width + height);
        },
      ),
      RUNS,
    );
  });

  it("keeps the step count within its limits", () => {
    fc.assert(
      fc.property(settingsArb, fc.nat(10000), (settings, frames) => {
        const steps = iterationBudget(frames, settings);
        expect(steps).toBeGreaterThanOrEqual(settings.minIterations);
        expect(steps).toBeLessThanOrEqual(settings.maxIterations);
      }),
      RUNS,
    );
  });

  it("estimates no more time for fewer remaining steps at the same rate", () => {
    fc.assert(
      fc.property(
        settingsArb,
        fc.integer({ min: 1, max: 100000 }),
        fc.nat(100000),
        fc.nat(100000),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        (settings, done, extraA, extraB, elapsedMs) => {
          const [less, more] =
            extraA <= extraB ? [extraA, extraB] : [extraB, extraA];
          const a = liveEta({ done, total: done + less, elapsedMs }, settings);
          const b = liveEta({ done, total: done + more, elapsedMs }, settings);
          expect(a === null).toBe(b === null);
          expect(a === null).toBe(done < settings.etaMinIterations);
          expect(a === null || b === null || a <= b).toBe(true);
        },
      ),
      RUNS,
    );
  });
});
