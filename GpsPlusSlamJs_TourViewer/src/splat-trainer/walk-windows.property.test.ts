import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Vector3 } from "gps-plus-slam-app-framework/core";

import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
import { planWindows, type WalkFrame } from "./walk-windows.js";

/**
 * Why these properties matter: the trainer trusts the plan blindly. A
 * frame in two cores would be scored twice, a hold-out in a training set
 * would make the score a lie, a window across a jump would tear its
 * splat, and a window past its frame limit would not fit in memory. They
 * must hold for any walk and any settings the sweep may pick, not only
 * for the defaults.
 */

/** A walk of random steps (0 to 3 m, 0.3 to 1.5 s apart), some of them
 *  jumps (tens of metres at once), some frames untimed. */
const walkArb = fc
  .array(
    fc.record({
      step: fc.double({ min: 0, max: 3, noNaN: true }),
      dtMs: fc.integer({ min: 300, max: 1500 }),
      jump: fc.boolean(),
      untimed: fc.integer({ min: 0, max: 30 }).map((n) => n === 0),
      heading: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    }),
    { minLength: 0, maxLength: 160 },
  )
  .map((steps) => {
    let x = 0;
    let z = 0;
    let t = 0;
    return steps.map((s, i): WalkFrame => {
      const length = s.jump && i % 17 === 0 ? 60 : s.step;
      x += length * Math.cos(s.heading);
      z += length * Math.sin(s.heading);
      t += s.dtMs;
      return {
        position: [x, 1.5, z] as Vector3,
        capturedAt: s.untimed ? null : t,
      };
    });
  });

const settingsArb = fc
  .record({
    windowM: fc.constantFrom(5, 15, 30, 60),
    minFrames: fc.integer({ min: 1, max: 12 }),
    extra: fc.integer({ min: 0, max: 40 }),
    holdoutEvery: fc.constantFrom(2, 4, 8, 16),
    minHoldouts: fc.integer({ min: 1, max: 8 }),
    overlapFraction: fc.constantFrom(0, 0.15, 0.25, 0.4),
    jumpSpeedMPerS: fc.constantFrom(2, 3, 5),
  })
  .map(({ extra, ...s }): TrainerSettings => ({
    ...TRAINER_DEFAULTS,
    ...s,
    maxFrames: 2 * s.minFrames + extra,
  }));

const RUNS = { numRuns: 200 };

describe("planWindows (property)", () => {
  it("puts every frame in exactly one window core", () => {
    fc.assert(
      fc.property(walkArb, settingsArb, (walk, settings) => {
        const plan = planWindows(walk, settings);
        const seen = plan.windows.flatMap((w) => w.core).sort((a, b) => a - b);
        expect(seen).toEqual([...walk.keys()]);
      }),
      RUNS,
    );
  });

  it("never trains on a hold-out, overlap included", () => {
    fc.assert(
      fc.property(walkArb, settingsArb, (walk, settings) => {
        const plan = planWindows(walk, settings);
        const held = new Set(plan.holdouts);
        for (const w of plan.windows) {
          expect(w.train.filter((i) => held.has(i))).toEqual([]);
          expect(w.holdouts.every((i) => held.has(i))).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("keeps every window, its overlap and its borrowed hold-outs inside one segment", () => {
    fc.assert(
      fc.property(walkArb, settingsArb, (walk, settings) => {
        const plan = planWindows(walk, settings);
        for (const w of plan.windows) {
          const segment = new Set(plan.segments[w.segment]);
          for (const i of [...w.core, ...w.train, ...w.holdouts]) {
            expect(segment.has(i)).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it("keeps each core's training count within the frame limits", () => {
    // Below the minimum only when the whole segment is that short.
    fc.assert(
      fc.property(walkArb, settingsArb, (walk, settings) => {
        const plan = planWindows(walk, settings);
        const held = new Set(plan.holdouts);
        for (const w of plan.windows) {
          const count = w.core.filter((i) => !held.has(i)).length;
          expect(count).toBeLessThanOrEqual(settings.maxFrames);
          const segmentCount = (plan.segments[w.segment] ?? []).filter(
            (i) => !held.has(i),
          ).length;
          // Under the minimum only for a segment that short as a whole.
          expect(w.tooFewFrames).toBe(count < settings.minFrames);
          expect(
            count >= settings.minFrames || segmentCount < settings.minFrames,
          ).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("borrows hold-outs only while short, and flags a shortfall exactly", () => {
    fc.assert(
      fc.property(walkArb, settingsArb, (walk, settings) => {
        const plan = planWindows(walk, settings);
        const held = new Set(plan.holdouts);
        for (const w of plan.windows) {
          const own = w.core.filter((i) => held.has(i));
          const segmentHeld = (plan.segments[w.segment] ?? []).filter((i) =>
            held.has(i),
          ).length;
          // Its own when enough, else borrowed up to the minimum or until
          // the segment has no more.
          expect(w.holdouts.length).toBe(
            own.length >= settings.minHoldouts
              ? own.length
              : Math.min(settings.minHoldouts, segmentHeld),
          );
          expect(own.every((i) => w.holdouts.includes(i))).toBe(true);
          expect(w.tooFewHoldouts).toBe(
            w.holdouts.length < settings.minHoldouts,
          );
        }
      }),
      RUNS,
    );
  });
});
