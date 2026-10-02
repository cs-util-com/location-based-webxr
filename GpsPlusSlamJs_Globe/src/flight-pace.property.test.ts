/**
 * Why these tests matter: the flight clock's promises have to hold for ANY
 * network, not only for the three timelines the unit tests draw. A random
 * progress history (rising in steps at random times, sometimes never
 * arriving, sometimes falling back), random frame steps (a 4 ms frame, a
 * 2 s stall of a hidden tab) and random parameters inside their ranges must
 * all keep the round-5 plan's pacing contract (§3.6, DEC-GL5-6):
 * - monotone and bounded: s never decreases and stays in [0, 1];
 * - it always ends, by the cap;
 * - it never ends before the warm minimum;
 * - velocity-continuous: one frame moves the rate by at most
 *   (warm - cold) x (1 - e^(-dt / smoothing)), so a tile landing never
 *   jerks the camera;
 * - frame-rate independent: two frame rates over the same progress history
 *   agree on where the camera is;
 * - once the data is done, the rest of the path is flown at about the warm
 *   pace (within one smoothing time).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  startPace,
  stepPace,
  type FlightPaceParams,
  type FlightPaceState,
} from "./flight-pace.js";

const params = fc
  .record({
    minMs: fc.integer({ min: 2_000, max: 15_000 }),
    extraMs: fc.integer({ min: 1_000, max: 40_000 }),
    smoothingMs: fc.integer({ min: 50, max: 3_000 }),
  })
  .map(({ minMs, extraMs, smoothingMs }): FlightPaceParams => ({
    minMs,
    capMs: minMs + extraMs,
    smoothingMs,
  }));

/** A progress history: steps (time, value), values may fall; never NaN-free. */
const history = fc.array(
  fc.record({
    atMs: fc.integer({ min: 0, max: 60_000 }),
    value: fc.oneof(
      fc.double({ min: -0.5, max: 1.5, noNaN: true }),
      fc.constant(Number.NaN),
    ),
  }),
  { maxLength: 6 },
);

const frames = fc.array(fc.integer({ min: 4, max: 2_000 }), {
  minLength: 1,
  maxLength: 8,
});

function progressAt(
  steps: readonly { atMs: number; value: number }[],
  t: number,
): number {
  let value = 0;
  for (const step of [...steps].sort((a, b) => a.atMs - b.atMs)) {
    if (step.atMs <= t) value = step.value;
  }
  return value;
}

/** Runs to the end, cycling the frame steps; returns every state. */
function run(
  p: FlightPaceParams,
  steps: readonly { atMs: number; value: number }[],
  frameSteps: readonly number[],
): FlightPaceState[] {
  const states = [startPace(p)];
  let t = 0;
  for (let i = 0; i < 1_000_000; i++) {
    t += frameSteps[i % frameSteps.length] ?? 16;
    const next = stepPace(states.at(-1)!, progressAt(steps, t), t, p);
    states.push(next);
    if (next.done) break;
  }
  return states;
}

describe("the flight clock, over random networks and frame rates", () => {
  it("is monotone, bounded and always ends by the cap", () => {
    fc.assert(
      fc.property(params, history, frames, (p, steps, frameSteps) => {
        const states = run(p, steps, frameSteps);
        const last = states.at(-1)!;
        expect(last.done).toBe(true);
        expect(last.s).toBe(1);
        // Ends on the first frame at or after the cap at the latest.
        const longestFrame = Math.max(...frameSteps);
        expect(last.elapsedMs).toBeLessThan(p.capMs + longestFrame);
        for (let i = 1; i < states.length; i++) {
          const a = states[i - 1]!;
          const b = states[i]!;
          expect(b.s).toBeGreaterThanOrEqual(a.s);
          expect(b.s).toBeGreaterThanOrEqual(0);
          expect(b.s).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never ends before the warm minimum", () => {
    fc.assert(
      fc.property(params, history, frames, (p, steps, frameSteps) => {
        const last = run(p, steps, frameSteps).at(-1)!;
        expect(last.elapsedMs).toBeGreaterThanOrEqual(p.minMs);
      }),
      { numRuns: 300 },
    );
  });

  it("keeps the rate between cold and warm and moves it smoothly per frame", () => {
    fc.assert(
      fc.property(params, history, frames, (p, steps, frameSteps) => {
        const states = run(p, steps, frameSteps);
        const cold = 1 / p.capMs;
        const warm = 1 / p.minMs;
        const eps = 1e-15;
        for (let i = 1; i < states.length; i++) {
          const a = states[i - 1]!;
          const b = states[i]!;
          expect(b.rate).toBeGreaterThanOrEqual(cold - eps);
          expect(b.rate).toBeLessThanOrEqual(warm + eps);
          if (b.done) continue;
          const dt = b.elapsedMs - a.elapsedMs;
          const bound = (warm - cold) * (1 - Math.exp(-dt / p.smoothingMs));
          expect(Math.abs(b.rate - a.rate)).toBeLessThanOrEqual(bound + eps);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("agrees across frame rates on where the camera is", () => {
    fc.assert(
      fc.property(
        params,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 4 }),
        (p, values) => {
          // Progress steps on multiples of 48 ms, which both frame rates hit.
          const steps = values.map((value, i) => ({
            atMs: 48 * (40 * (i + 1)),
            value,
          }));
          const fine = run(p, steps, [16]);
          const coarse = run(p, steps, [48]);
          const byTime = new Map(fine.map((s) => [s.elapsedMs, s.s]));
          for (const state of coarse) {
            if (state.done) break;
            const other = byTime.get(state.elapsedMs);
            if (other === undefined) continue;
            expect(Math.abs(other - state.s)).toBeLessThan(1e-9);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("stays within one coarse frame of a finer clock when signals land between frames", () => {
    // A signal acts from the frame after the one that reports it, so a
    // coarser frame delays each rise of the target by at most one coarse
    // frame. The ratcheted target rises by at most (warm - cold) in all, so
    // the two clocks can differ in s by at most (warm - cold) x 48 ms.
    fc.assert(
      fc.property(
        params,
        fc.array(
          fc.record({
            atMs: fc.integer({ min: 1, max: 40_000 }),
            value: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { maxLength: 5 },
        ),
        (p, steps) => {
          const fine = run(p, steps, [16]);
          const coarse = run(p, steps, [48]);
          const byTime = new Map(fine.map((s) => [s.elapsedMs, s.s]));
          const bound = (1 / p.minMs - 1 / p.capMs) * 48 + 1e-9;
          for (const state of coarse) {
            const other = byTime.get(state.elapsedMs);
            if (other === undefined) continue;
            expect(Math.abs(other - state.s)).toBeLessThanOrEqual(bound);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flies the rest at about the warm pace once the data is done", () => {
    fc.assert(
      fc.property(
        params,
        fc.integer({ min: 0, max: 40_000 }),
        (p, landedMs) => {
          const frame = 16;
          const states = run(p, [{ atMs: landedMs, value: 1 }], [frame]);
          const last = states.at(-1)!;
          const atLanding = states.find((s) => s.elapsedMs >= landedMs);
          if (atLanding === undefined || atLanding.done) return;
          const promise =
            atLanding.elapsedMs +
            (1 - atLanding.s) * p.minMs +
            p.smoothingMs +
            frame;
          expect(last.elapsedMs).toBeLessThanOrEqual(
            Math.min(promise, p.capMs + frame),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
