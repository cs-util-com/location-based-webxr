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
    expect(speedDustOpacity(speedShare(hiMps), 5_000 * KM)).toBe(1);
    expect(speedDustOpacity(Number.NaN, 10_000 * KM)).toBe(0);
  });

  // WHY (round-5 plan, the owner on r823: "the speed lines at the start,
  // while the Earth is still a whole sphere, are a bit too strong; make
  // them more subtle"): far out the streaks fall to `farShare`, and only
  // there. The whole globe fills a 50 degree view's height at about
  // 8,700 km, so the dust keeps its full strength below `farFromM` and
  // every look under it (the descent the owner liked) is unchanged.
  it("is subtler far out, where the whole Earth is in view, and only there", () => {
    const { farFromM, farToM, farShare } = GLOBE_SPEED_DUST;
    expect(farShare).toBeGreaterThan(0);
    expect(farShare).toBeLessThan(1);
    expect(farFromM).toBeLessThanOrEqual(8_700 * KM);
    expect(speedDustOpacity(1, farFromM)).toBe(1);
    expect(speedDustOpacity(1, farToM)).toBeCloseTo(farShare, 12);
    // The flight's start: 50,000 km from the centre.
    expect(speedDustOpacity(1, 43_600 * KM)).toBeCloseTo(farShare, 12);
    let last = 1;
    for (let km = farFromM / KM; km <= farToM / KM; km *= 1.05) {
      const o = speedDustOpacity(1, km * KM);
      expect(o).toBeLessThanOrEqual(last + 1e-12);
      expect(last - o).toBeLessThan(0.05);
      last = o;
    }
  });

  // The lab's knob (`dustFar`): 1 is the look before round 5, 0 no streaks
  // far out; a share outside 0..1 is refused rather than clamped.
  it("takes the far share as an option, refusing one outside 0..1", () => {
    expect(speedDustOpacity(1, 43_600 * KM, { farShare: 1 })).toBe(1);
    expect(speedDustOpacity(1, 43_600 * KM, { farShare: 0 })).toBe(0);
    expect(speedDustOpacity(1, 2_000 * KM, { farShare: 0 })).toBe(1);
    expect(() => speedDustOpacity(1, 1e7, { farShare: -0.1 })).toThrow(
      RangeError,
    );
    expect(() => speedDustOpacity(1, 1e7, { farShare: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("drifts faster as the speed rises, from the slow rate to the fast one", () => {
    const { driftMin, driftMax } = GLOBE_SPEED_DUST;
    expect(driftRate(0)).toBeCloseTo(driftMin, 12);
    expect(driftRate(1)).toBeCloseTo(driftMax, 12);
    expect(driftRate(0.5)).toBeGreaterThan(driftRate(0.4));
  });
});

// WHY (round-3 plan 2026-10-08-2345 D1b, DEC-R3-11: the owner tunes the
// streaks in the lab's panel): the speed range and the drift range are
// knobs. Given, they replace the defaults; without them nothing changes;
// a range that is not a positive, rising pair is refused rather than
// drawing nonsense.
describe("the streaks' tunable ranges (D1b)", () => {
  it("maps a given speed range log-linearly, the default range unchanged", () => {
    const range = { loMps: 10_000, hiMps: 1_000_000 };
    expect(speedShare(10_000, range)).toBe(0);
    expect(speedShare(100_000, range)).toBeCloseTo(0.5, 12);
    expect(speedShare(1_000_000, range)).toBe(1);
    expect(speedShare(50_000)).toBe(
      speedShare(50_000, {
        loMps: GLOBE_SPEED_DUST.loMps,
        hiMps: GLOBE_SPEED_DUST.hiMps,
      }),
    );
    for (const bad of [
      { loMps: 0, hiMps: 10 },
      { loMps: 10, hiMps: 10 },
      { loMps: 10, hiMps: Number.NaN },
    ]) {
      expect(() => speedShare(5, bad)).toThrow(RangeError);
    }
  });

  it("drifts geometrically across a given range, the default range unchanged", () => {
    const range = { driftMin: 1, driftMax: 16 };
    expect(driftRate(0, range)).toBe(1);
    expect(driftRate(0.5, range)).toBeCloseTo(4, 12);
    expect(driftRate(1, range)).toBe(16);
    expect(driftRate(0.3)).toBe(
      driftRate(0.3, {
        driftMin: GLOBE_SPEED_DUST.driftMin,
        driftMax: GLOBE_SPEED_DUST.driftMax,
      }),
    );
    expect(() => driftRate(0.5, { driftMin: 2, driftMax: 1 })).toThrow(
      RangeError,
    );
  });
});

// WHY (the owner on r812, round-4 plan DEC-R4-4 and §6 items 6-7): turning
// the globe by hand made streaks pour sideways across the screen for 5-7 s
// (the controls' spin momentum, all tangential). Under the user's controls
// only the distance to the Earth makes streaks: motion around the centre
// gives exactly nothing, motion toward it all of it, and a mostly-sideways
// motion (a tilt) nothing either. And they stop within half a second of
// the motion stopping: a release time constant of 50 ms (measured below,
// with 40, 60 and 120 ms either side).
describe("the streaks by the distance only, with a short tail (DEC-R4-4)", () => {
  const R = 6_371_000;
  const at = (
    lat: number,
    lng: number,
    r: number,
  ): [number, number, number] => [
    r * Math.cos(lat) * Math.cos(lng),
    r * Math.cos(lat) * Math.sin(lng),
    r * Math.sin(lat),
  ];
  const run = (
    path: (t: number) => [number, number, number],
    ms: number,
    radialOnly: boolean,
    releaseMs?: number,
  ) => {
    let s = startVelocity();
    for (let t = 0; t <= ms; t += 16) {
      const p = path(t);
      s = stepVelocity(s, p, t, Math.hypot(...p) - R, {
        radialOnly,
        releaseMs,
      });
    }
    return Math.hypot(...s.velocity);
  };

  it("gives nothing for motion around the centre, at any speed", () => {
    for (const r of [R + 8_000_000, R + 30_000_000]) {
      for (const rate of [1e-4, 1e-3, 1e-2]) {
        const v = run((t) => at(0.8, rate * t, r), 1_000, true);
        expect(v).toBe(0);
        // Without the option the same spin streaks (the bug's own motion).
        expect(run((t) => at(0.8, rate * t, r), 1_000, false)).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("keeps motion toward the centre, and drops a mostly sideways one", () => {
    const toward = run(
      (t) => at(0.8, 0.3, R + 20_000_000 - 3_000 * t),
      1_000,
      true,
    );
    expect(toward).toBeGreaterThan(2_900_000 * 0.95);
    // 20 % radial, 80 % around: a tilt, not a zoom.
    const tilt = run(
      (t) => at(0.8, 0.3 + 1.5e-4 * t, R + 20_000_000 - 1_000 * t),
      1_000,
      true,
    );
    expect(tilt).toBe(0);
  });

  // Gone means the speed back near the range's low end: from its top that
  // is ln(5,000), about 8.5 time constants, so half a second needs a
  // release of at most about 55 ms (60 ms measured 22 % opacity left).
  it("stops within half a second of the motion stopping at the 50 ms release", () => {
    const zoomThenStop = (t: number) =>
      at(0.8, 0.3, R + 20_000_000 - (5_000_000 * Math.min(t, 1_000)) / 1_000);
    const opacityAfter = (releaseMs: number, afterMs: number) => {
      const v = run(zoomThenStop, 1_000 + afterMs, true, releaseMs);
      return speedDustOpacity(speedShare(v), 15_000_000);
    };
    expect(opacityAfter(50, 500)).toBeLessThan(0.01);
    expect(opacityAfter(40, 500)).toBeLessThan(0.01);
    // 60 and 120 ms keep them past half a second (the threshold, measured).
    expect(opacityAfter(60, 500)).toBeGreaterThan(0.01);
    expect(opacityAfter(120, 500)).toBeGreaterThan(0.01);
    expect(GLOBE_SPEED_DUST.releaseMs).toBe(50);
  });

  it("still speeds up at the attack's pace, not the release's", () => {
    const v100 = run(
      (t) => at(0.8, 0.3, R + 20_000_000 - 3_000 * t),
      100,
      true,
    );
    // 200 ms attack: after 100 ms about 1 - e^-0.5 = 39 % of 3,000 km/s.
    expect(v100 / 3_000_000).toBeGreaterThan(0.3);
    expect(v100 / 3_000_000).toBeLessThan(0.5);
  });
});
