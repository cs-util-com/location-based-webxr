/**
 * Why these tests matter: the fly-in's clock is paced by the OSM prefetch
 * (round-5 plan 2026-10-01-0945 §3.6, DEC-GL5-6). The owner's words: slow
 * while the data loads, quick when it is already stored, and never longer
 * than the 30 s cap. Every failure here is one the owner would SEE: a speed
 * jump the moment a tile lands, a flight that never ends on a dead network,
 * a "warm" flight that still crawls. These are the worked examples; the
 * invariants over random inputs are in `flight-pace.property.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  FLIGHT_PACE_DEFAULTS,
  paceTargetRate,
  startPace,
  stepPace,
  type FlightPaceParams,
  type FlightPaceState,
} from "./flight-pace.js";

const P: FlightPaceParams = { minMs: 8_000, capMs: 30_000, smoothingMs: 800 };

/** Runs the clock at a fixed frame step until it ends or `limitMs` passes. */
function fly(
  params: FlightPaceParams,
  progressAt: (elapsedMs: number) => number,
  frameMs = 16,
  limitMs = 120_000,
): { state: FlightPaceState; endedAtMs: number | undefined } {
  let state = startPace(params);
  for (let t = frameMs; t <= limitMs; t += frameMs) {
    state = stepPace(state, progressAt(t), t, params);
    if (state.done) return { state, endedAtMs: t };
  }
  return { state, endedAtMs: undefined };
}

describe("the defaults", () => {
  it("cap the flight at 30 s (DEC-GL5-6)", () => {
    expect(FLIGHT_PACE_DEFAULTS.capMs).toBe(30_000);
  });

  it("are a valid parameter set (min below cap, positive smoothing)", () => {
    expect(FLIGHT_PACE_DEFAULTS.minMs).toBeGreaterThan(0);
    expect(FLIGHT_PACE_DEFAULTS.minMs).toBeLessThan(FLIGHT_PACE_DEFAULTS.capMs);
    expect(FLIGHT_PACE_DEFAULTS.smoothingMs).toBeGreaterThan(0);
  });
});

describe("before the first signal", () => {
  it("flies at the cold pace: the whole path over the cap", () => {
    const state = startPace(P);
    expect(state.s).toBe(0);
    expect(state.rate).toBeCloseTo(1 / P.capMs, 12);
    expect(state.done).toBe(false);
  });

  it("treats a NaN or missing progress as no signal, not as an error", () => {
    const after = stepPace(startPace(P), Number.NaN, 1_000, P);
    expect(after.rate).toBeCloseTo(1 / P.capMs, 12);
    expect(after.s).toBeCloseTo(1_000 / P.capMs, 9);
  });
});

describe("the target rate", () => {
  it("is the cold rate at progress 0 and the warm rate at progress 1", () => {
    expect(paceTargetRate(0, P)).toBeCloseTo(1 / P.capMs, 12);
    expect(paceTargetRate(1, P)).toBeCloseTo(1 / P.minMs, 12);
  });

  it("clamps progress outside [0, 1]", () => {
    expect(paceTargetRate(-3, P)).toBe(paceTargetRate(0, P));
    expect(paceTargetRate(7, P)).toBe(paceTargetRate(1, P));
  });
});

describe("whole flights", () => {
  it("a cold flight on a dead network ends exactly at the cap", () => {
    const { endedAtMs, state } = fly(P, () => 0);
    expect(state.s).toBe(1);
    // The frame on which it ends is the first at or after the cap.
    expect(endedAtMs).toBeGreaterThanOrEqual(P.capMs - 16);
    expect(endedAtMs).toBeLessThanOrEqual(P.capMs + 16);
  });

  it("a warm flight takes at least the minimum and at most min + smoothing", () => {
    const { endedAtMs } = fly(P, () => 1);
    expect(endedAtMs).toBeGreaterThanOrEqual(P.minMs);
    expect(endedAtMs).toBeLessThanOrEqual(P.minMs + P.smoothingMs + 16);
  });

  it("data that lands at 10 s finishes the rest at about the warm pace", () => {
    const landed = 10_000;
    const { endedAtMs } = fly(P, (t) => (t >= landed ? 1 : 0));
    // s at 10 s is 1/3 (cold), the remaining 2/3 at the warm pace is
    // 2/3 x 8 s = 5.3 s, plus at most one smoothing time.
    const sAtLanding = landed / P.capMs;
    const bound = landed + (1 - sAtLanding) * P.minMs + P.smoothingMs;
    expect(endedAtMs).toBeGreaterThan(landed + (1 - sAtLanding) * P.minMs);
    expect(endedAtMs).toBeLessThanOrEqual(bound + 16);
  });

  it("the speed does not jump when progress steps from 0 to 1", () => {
    let state = startPace(P);
    let maxJump = 0;
    for (let t = 16; t <= 20_000; t += 16) {
      const next = stepPace(state, t >= 5_000 ? 1 : 0, t, P);
      maxJump = Math.max(maxJump, Math.abs(next.rate - state.rate));
      state = next;
    }
    const span = 1 / P.minMs - 1 / P.capMs;
    // A raw step would be the whole span in one frame; smoothed, one frame
    // moves at most span x (1 - e^(-16/800)), about 2 % of it.
    expect(maxJump).toBeLessThanOrEqual(
      span * (1 - Math.exp(-16 / P.smoothingMs)) + 1e-15,
    );
  });

  it("never slows down when progress falls (it is ratcheted)", () => {
    let state = startPace(P);
    state = stepPace(state, 0.8, 5_000, P);
    const held = stepPace(stepPace(state, 0.8, 6_000, P), 0.8, 7_000, P);
    const fell = stepPace(stepPace(state, 0.1, 6_000, P), 0.1, 7_000, P);
    expect(fell.rate).toBe(held.rate);
    expect(fell.s).toBe(held.s);
  });

  it("a signal moves the camera only AFTER the frame it arrives in", () => {
    // Causal, and what makes the clock independent of the frame rate: the
    // frame that reports the signal was flown before anyone knew it.
    const a = stepPace(startPace(P), 1, 1_000, P);
    expect(a.rate).toBeCloseTo(1 / P.capMs, 12);
    expect(stepPace(a, 1, 2_000, P).rate).toBeGreaterThan(a.rate);
  });

  it("holds still when time does not advance or goes back", () => {
    const state = stepPace(startPace(P), 0.5, 4_000, P);
    expect(stepPace(state, 0.5, 4_000, P).s).toBe(state.s);
    expect(stepPace(state, 0.5, 1_000, P).s).toBe(state.s);
  });

  it("a frame of 10 s (a hidden tab) still lands within the cap", () => {
    let state = startPace(P);
    state = stepPace(state, 0, 10_000, P);
    state = stepPace(state, 0, 20_000, P);
    state = stepPace(state, 0, 31_000, P);
    expect(state.done).toBe(true);
    expect(state.s).toBe(1);
  });
});

describe("parameter validation", () => {
  it.each([
    [{ minMs: 0, capMs: 30_000, smoothingMs: 800 }],
    [{ minMs: 8_000, capMs: 8_000, smoothingMs: 800 }],
    [{ minMs: 8_000, capMs: 30_000, smoothingMs: 0 }],
    [{ minMs: Number.NaN, capMs: 30_000, smoothingMs: 800 }],
    [{ minMs: 8_000, capMs: Number.POSITIVE_INFINITY, smoothingMs: 800 }],
  ])("refuses %o with a RangeError", (params) => {
    expect(() => startPace(params)).toThrow(RangeError);
  });
});
