import { describe, expect, it } from "vitest";

import { TRAINER_DEFAULTS } from "./trainer-defaults.js";
import {
  iterationBudget,
  liveEta,
  memoryBudgetBytes,
  photoScale,
} from "./training-budget.js";

const MB = 1024 * 1024;
const ROOMY = {
  maxStorageBufferBindingSize: 4096 * MB,
  maxBufferSize: 4096 * MB,
};

describe("memoryBudgetBytes", () => {
  it("is the target when the adapter allows more", () => {
    expect(memoryBudgetBytes(ROOMY, TRAINER_DEFAULTS)).toBe(700e6);
  });

  it("targets what the trainer itself targets by default", () => {
    // Why: the trainer shrinks its photos at its own budget, 700e6 bytes
    // at 12 bytes a pixel (three float32 channels); a plan made with
    // 700 MiB said "native size" for windows the trainer shrinks.
    expect(TRAINER_DEFAULTS.targetMemoryBytes).toBe(700_000_000);
    expect(TRAINER_DEFAULTS.bytesPerPixel).toBe(12);
  });

  it("is half the binding limit when that is smaller", () => {
    // Why: a phone's adapter binds far less than a desktop's; the photos
    // must fit one binding with room for the trainer's own buffers.
    expect(
      memoryBudgetBytes(
        { maxStorageBufferBindingSize: 128 * MB, maxBufferSize: 4096 * MB },
        TRAINER_DEFAULTS,
      ),
    ).toBe(64 * MB);
  });

  it("is never more than the largest buffer", () => {
    expect(
      memoryBudgetBytes(
        { maxStorageBufferBindingSize: 4096 * MB, maxBufferSize: 100 * MB },
        TRAINER_DEFAULTS,
      ),
    ).toBe(100 * MB);
  });

  it("rejects limits that are not positive numbers", () => {
    expect(() =>
      memoryBudgetBytes(
        { maxStorageBufferBindingSize: Number.NaN, maxBufferSize: 1 },
        TRAINER_DEFAULTS,
      ),
    ).toThrow(RangeError);
  });
});

describe("photoScale", () => {
  it("keeps the photos' own size when they fit", () => {
    expect(photoScale(50, 640, 480, 700e6, TRAINER_DEFAULTS)).toEqual({
      kind: "fits",
      width: 640,
      height: 480,
      bytes: 50 * 640 * 480 * 12,
    });
  });

  it("scales the photos down, keeping their shape, until they fit", () => {
    // Why: a window that does not fit at full size still trains at a
    // smaller one; the shape must not change or the lens would not fit.
    const budget = 64 * MB;
    const scaled = photoScale(100, 1920, 1440, budget, TRAINER_DEFAULTS);
    if (scaled.kind !== "fits") throw new Error(scaled.kind);
    expect(scaled.bytes).toBeLessThanOrEqual(budget);
    expect(scaled.width / scaled.height).toBeCloseTo(1920 / 1440, 2);
    expect(scaled.width).toBeLessThan(1920);
  });

  it("refuses when the photos would have to shrink below the shortest side", () => {
    expect(photoScale(1000, 1920, 1440, MB, TRAINER_DEFAULTS)).toEqual({
      kind: "too-large",
      neededBytes: 1000 * 128 * Math.floor((128 * 1920) / 1440) * 12,
      budgetBytes: MB,
    });
  });

  it("rejects a cost per pixel that is not positive", () => {
    // Why: at 0 bytes a pixel every window "fits" at full size in 0
    // bytes, and the trainer then runs out of memory on the device.
    for (const bytesPerPixel of [0, -1, Number.NaN]) {
      expect(() =>
        photoScale(10, 640, 480, MB, { ...TRAINER_DEFAULTS, bytesPerPixel }),
      ).toThrow(RangeError);
    }
  });

  it("rejects a size that is not a positive integer", () => {
    expect(() => photoScale(0, 640, 480, MB, TRAINER_DEFAULTS)).toThrow(
      RangeError,
    );
    expect(() => photoScale(1, 640.5, 480, MB, TRAINER_DEFAULTS)).toThrow(
      RangeError,
    );
  });
});

describe("iterationBudget", () => {
  it("is steps per frame, clamped to the limits", () => {
    expect(iterationBudget(100, TRAINER_DEFAULTS)).toBe(15000);
    expect(iterationBudget(1, TRAINER_DEFAULTS)).toBe(4000);
    expect(iterationBudget(1000, TRAINER_DEFAULTS)).toBe(30000);
  });

  it("rejects step limits that cannot both hold", () => {
    // Why: with the maximum under the minimum, the clamp returns the
    // maximum, under the minimum the settings promise.
    expect(() =>
      iterationBudget(10, {
        ...TRAINER_DEFAULTS,
        minIterations: 5000,
        maxIterations: 4000,
      }),
    ).toThrow(RangeError);
  });

  it("rejects a negative or fractional frame count", () => {
    expect(() => iterationBudget(-1, TRAINER_DEFAULTS)).toThrow(RangeError);
    expect(() => iterationBudget(1.5, TRAINER_DEFAULTS)).toThrow(RangeError);
  });
});

describe("liveEta", () => {
  it("shows nothing before enough steps were measured", () => {
    // Why: the first steps carry shader compilation; an estimate from
    // them would promise hours and then jump.
    expect(
      liveEta({ done: 199, total: 1000, elapsedMs: 5000 }, TRAINER_DEFAULTS),
    ).toBeNull();
  });

  it("is the remaining steps at the measured rate", () => {
    expect(
      liveEta({ done: 200, total: 1000, elapsedMs: 4000 }, TRAINER_DEFAULTS),
    ).toBe(16000);
    expect(
      liveEta({ done: 1000, total: 1000, elapsedMs: 4000 }, TRAINER_DEFAULTS),
    ).toBe(0);
  });

  it("shows nothing for a measurement that makes no sense", () => {
    expect(
      liveEta(
        { done: 300, total: 1000, elapsedMs: Number.NaN },
        TRAINER_DEFAULTS,
      ),
    ).toBeNull();
    expect(
      liveEta({ done: 300, total: 1000, elapsedMs: -1 }, TRAINER_DEFAULTS),
    ).toBeNull();
    expect(
      liveEta({ done: 1200, total: 1000, elapsedMs: 10 }, TRAINER_DEFAULTS),
    ).toBeNull();
  });

  it("shows nothing before any step, even when no minimum is asked for", () => {
    // Why: no step measured is no rate; dividing by it gave NaN or
    // Infinity as the time left.
    const settings = { ...TRAINER_DEFAULTS, etaMinIterations: 0 };
    expect(liveEta({ done: 0, total: 0, elapsedMs: 0 }, settings)).toBeNull();
    expect(
      liveEta({ done: 0, total: 100, elapsedMs: 50 }, settings),
    ).toBeNull();
  });
});
