/**
 * Why this test matters: the speed dust (round-3 plan 2026-10-08-2345, D1)
 * replaces a world-fixed dust that clumped over the city when the owner
 * zoomed back out and gave no sense of speed. Its promises are exact and
 * cheap to hold here: a field that can never clump (a torus moved by
 * translation alone), nothing at all when the camera stops, streaks along
 * the motion that grow with the speed on a log scale, frame-rate
 * independence, and no spike when the camera teleports.
 */
import { describe, expect, it } from "vitest";

import {
  GLOBE_SPEED_DUST,
  advanceField,
  createSpeedField,
  speedDustOpacity,
  speedShare,
  startVelocity,
  stepVelocity,
  streaks,
  driftRate,
} from "./globe-speed-dust.js";

const KM = 1_000;

describe("speedShare", () => {
  it("is 0 up to lo, 1 from hi, log-linear and monotone between", () => {
    const { loMps, hiMps } = GLOBE_SPEED_DUST;
    expect(speedShare(0)).toBe(0);
    expect(speedShare(loMps)).toBe(0);
    expect(speedShare(hiMps)).toBe(1);
    expect(speedShare(hiMps * 10)).toBe(1);
    expect(speedShare(Math.sqrt(loMps * hiMps))).toBeCloseTo(0.5, 9);
    expect(speedShare(Number.NaN)).toBe(0);
    let last = -1;
    for (let v = loMps / 2; v < hiMps * 2; v *= 1.3) {
      expect(speedShare(v)).toBeGreaterThanOrEqual(last);
      last = speedShare(v);
    }
  });
});

describe("the velocity", () => {
  const along = (mps: number, tMs: number): [number, number, number] => [
    7_000 * KM + (mps * tMs) / 1000,
    0,
    0,
  ];

  // The smoothing's time constant is in milliseconds, not frames: a camera
  // moving steadily reads the same velocity after a second at any rate.
  it("reads the same after a second of steady motion at 5, 10, 30 and 60 Hz", () => {
    const readings = [5, 10, 30, 60].map((hz) => {
      let state = startVelocity();
      for (let i = 0; i <= hz; i++) {
        const t = (i * 1000) / hz;
        state = stepVelocity(state, along(50_000, t), t, 1_000 * KM);
      }
      return state.velocity[0];
    });
    // Exponential smoothing of a constant input: 1 - exp(-1 s / tau) of it
    // after a second, whatever the steps.
    const expected = 50_000 * (1 - Math.exp(-1000 / GLOBE_SPEED_DUST.tauMs));
    for (const v of readings) expect(v / expected).toBeCloseTo(1, 9);
  });

  // A teleport (a link, a held view, the flight's first placement) moved the
  // camera by more than its altitude in one frame: no speed spike.
  it("resets instead of spiking when the camera jumps", () => {
    let state = startVelocity();
    state = stepVelocity(state, along(0, 0), 0, 1_000 * KM);
    state = stepVelocity(state, along(0, 16), 16, 1_000 * KM);
    const jumped: [number, number, number] = [7_000 * KM + 20_000 * KM, 0, 0];
    state = stepVelocity(state, jumped, 32, 1_000 * KM);
    expect(Math.hypot(...state.velocity)).toBe(0);
    // The guard catches only gross jumps, a step of the altitude or more:
    // the lab resets the speed itself where it places the camera (a view,
    // a link's start), and a wheel zoom or a slow frame near the gate (half
    // the altitude in a frame at 1.4 frames a second) is real motion (the
    // milestone review, findings 4 and 5).
    let flight = startVelocity();
    flight = stepVelocity(flight, [0, 0, 7_000 * KM], 0, 600 * KM);
    flight = stepVelocity(flight, [0, 0, 7_000 * KM - 300 * KM], 700, 600 * KM);
    expect(Math.hypot(...flight.velocity)).toBeGreaterThan(0);
  });

  it("ignores a step that is not finite or goes back in time", () => {
    let state = startVelocity();
    state = stepVelocity(state, along(0, 0), 0, 1_000 * KM);
    const before = state;
    expect(stepVelocity(state, [Number.NaN, 0, 0], 16, 1_000 * KM)).toBe(
      before,
    );
    expect(stepVelocity(state, along(0, 0), -5, 1_000 * KM)).toBe(before);
  });
});

/** An entry of a typed array (0 past its end). */
const at = (a: Float32Array, i: number) => a[i] ?? 0;
/** x wrapped into [-1, 1). */
const wrapBox = (x: number) => x - 2 * Math.floor((x + 1) / 2);
/** The octant (0-7) of the i-th point. */
const octant = (heads: Float32Array, i: number) =>
  (at(heads, 3 * i) >= 0 ? 1 : 0) +
  (at(heads, 3 * i + 1) >= 0 ? 2 : 0) +
  (at(heads, 3 * i + 2) >= 0 ? 4 : 0);

describe("the field", () => {
  // A torus moved by translation alone: the heads are exactly the seeds
  // minus the offset, wrapped, whatever the walk (stops, reversals, jumps):
  // so it stays as even as it started, and can never clump.
  it("keeps every head at its seed minus the offset, in the box, after any walk", () => {
    const seeds = createSpeedField(500, 3);
    let offset: [number, number, number] = [0, 0, 0];
    let rnd = 7;
    const next = () =>
      ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    for (let step = 0; step < 300; step++) {
      const dir = [next(), next(), next()] as const;
      const l = Math.hypot(...dir) || 1;
      offset = advanceField(
        offset,
        [dir[0] / l, dir[1] / l, dir[2] / l],
        next() * 20,
        0.05,
      );
    }
    const out = streaks(seeds, offset, [1, 0, 0], 0, 0.033, 1);
    for (let j = 0; j < 1500; j++) {
      const head = at(out.heads, j);
      expect(head).toBeGreaterThanOrEqual(-1);
      expect(head).toBeLessThan(1);
      expect(head).toBeCloseTo(wrapBox(at(seeds, j) - offset[j % 3]!), 6);
    }
    // Even: each of the 8 octants holds its share within 25 %.
    const counts = new Array<number>(8).fill(0);
    for (let i = 0; i < 500; i++) counts[octant(out.heads, i)]! += 1;
    for (const c of counts) {
      expect(c).toBeGreaterThan((500 / 8) * 0.75);
      expect(c).toBeLessThan((500 / 8) * 1.25);
    }
  });

  // Drift over a second is the same at any frame rate, and a single frame
  // never moves the field more than the cap (no aliasing at the wrap).
  it("drifts the same over a second at any frame rate, a frame never more than the cap", () => {
    const at = (hz: number) => {
      let offset: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < hz; i++)
        offset = advanceField(offset, [0, 0, 1], 0.5, 1 / hz);
      return offset[2];
    };
    for (const hz of [5, 10, 30, 60]) expect(at(hz)).toBeCloseTo(0.5, 9);
    const one = advanceField([0, 0, 0], [0, 0, 1], 100, 1);
    expect(Math.abs(one[2])).toBeLessThanOrEqual(
      2 * GLOBE_SPEED_DUST.maxStepShare + 1e-12,
    );
  });

  // The streaks point back along the motion: a particle streams past the
  // camera against the velocity, its trail where it was.
  it("draws each streak from the head back along the motion, longer when faster", () => {
    const seeds = createSpeedField(50, 1);
    const slow = streaks(seeds, [0, 0, 0], [0, 0, 1], 1, 0.033, 1);
    const fast = streaks(seeds, [0, 0, 0], [0, 0, 1], 5, 0.033, 1);
    for (let i = 0; i < 50; i++) {
      const dz = (fast.tails[3 * i + 2] ?? 0) - (fast.heads[3 * i + 2] ?? 0);
      expect(dz).toBeGreaterThan(0);
      expect(fast.tails[3 * i] ?? 0).toBeCloseTo(fast.heads[3 * i] ?? 0, 12);
      expect(dz).toBeGreaterThan(
        (slow.tails[3 * i + 2] ?? 0) - (slow.heads[3 * i + 2] ?? 0),
      );
    }
  });

  // Faded at the box's rim (so its corners and wraps never show) and right
  // at the camera (so a pass through it is no giant streak).
  it("fades the streaks at the box's rim and at the camera", () => {
    const seeds = new Float32Array([0, 0, 0.5, 0.97, 0, 0, 0.01, 0, 0]);
    const out = streaks(seeds, [0, 0, 0], [0, 0, 1], 1, 0.033, 1);
    expect(out.alpha[0]).toBe(1);
    expect(out.alpha[1]).toBe(0);
    expect(out.alpha[2]).toBe(0);
  });

  it("rejects a count that is not a positive integer", () => {
    expect(() => createSpeedField(0)).toThrow(RangeError);
    expect(() => createSpeedField(2.5)).toThrow(RangeError);
  });
});

describe("the dust's opacity", () => {
  // A stopped camera draws exactly nothing; full speed high up, full
  // opacity; gone below the sky's altitude.
  it("is nothing when stopped, full fast and high, gone low", () => {
    const { fullM, goneM, hiMps } = GLOBE_SPEED_DUST;
    expect(speedDustOpacity(0, 10_000 * KM)).toBe(0);
    expect(speedDustOpacity(1, fullM)).toBe(1);
    expect(speedDustOpacity(1, goneM)).toBe(0);
    expect(speedDustOpacity(speedShare(hiMps), 65_000 * KM)).toBe(1);
    expect(speedDustOpacity(Number.NaN, 10_000 * KM)).toBe(0);
  });

  it("drifts faster as the speed rises, from the slow rate to the fast one", () => {
    const { driftMin, driftMax } = GLOBE_SPEED_DUST;
    expect(driftRate(0)).toBeCloseTo(driftMin, 12);
    expect(driftRate(1)).toBeCloseTo(driftMax, 12);
    expect(driftRate(0.5)).toBeGreaterThan(driftRate(0.4));
  });
});
