import { describe, expect, it } from "vitest";

import {
  isStill,
  readingsLost,
  STILL_CONFIG,
  stillProgress,
  stillStart,
  stillStep,
  type MotionSample,
  type StillConfig,
  type StillState,
} from "./still-detector";

/** 60 readings a second, as Chrome on Android fires `devicemotion`. */
const DT = 1000 / 60;

/** A seeded generator, so every trace is the same on every run. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** `ms` of readings from `t0` with each axis drawn by `axis`. */
function trace(t0: number, ms: number, axis: () => number): MotionSample[] {
  const out: MotionSample[] = [];
  for (let t = t0; t < t0 + ms; t += DT) {
    out.push({ t, rate: { alpha: axis(), beta: axis(), gamma: axis() } });
  }
  return out;
}

/** Noise of up to `amp` degrees per second on each axis. */
const noise = (amp: number, seed = 7): (() => number) => {
  const r = rng(seed);
  return () => (r() * 2 - 1) * amp;
};

/** The time of the first reading at which the detector says still, or null. */
function firstStill(
  samples: readonly MotionSample[],
  needMove = false,
  cfg: StillConfig = STILL_CONFIG,
  t0 = samples[0]?.t ?? 0,
): number | null {
  let st: StillState = stillStart(t0, needMove);
  for (const s of samples) {
    st = stillStep(st, s, cfg);
    if (isStill(st, cfg)) {
      return s.t;
    }
  }
  return null;
}

const run = (
  samples: readonly MotionSample[],
  needMove = false,
  t0 = 0,
): StillState =>
  samples.reduce((st, s) => stillStep(st, s), stillStart(t0, needMove));

// A phone on a stand, a phone held still in the hand, a phone carried.
const STAND = (seed = 7) => noise(0.5, seed);
const HAND = (seed = 7) => noise(1.5, seed);
const WALK = (seed = 7) => {
  const r = rng(seed);
  return () => 40 + r() * 80;
};

describe("still-detector", () => {
  // Why: the whole point - a phone left on its stand takes photo B by
  // itself, after the dwell and not before.
  it("says still once a phone on a stand has been still for the dwell", () => {
    const at = firstStill(trace(0, 4000, STAND()));
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(STILL_CONFIG.dwellMs);
    expect(at!).toBeLessThan(STILL_CONFIG.dwellMs + 100);
  });

  // Why: a tester who holds the phone instead of using a stand still gets
  // the photo; the threshold sits above a steady hand's tremor.
  it("says still for a phone held steady in the hand", () => {
    const at = firstStill(trace(0, 4000, HAND()));
    expect(at).not.toBeNull();
    expect(at!).toBeLessThan(STILL_CONFIG.dwellMs + 300);
  });

  // Why: a photo taken while the phone is carried measures the shake.
  it("never says still while the phone is carried", () => {
    expect(firstStill(trace(0, 6000, WALK()))).toBeNull();
  });

  // Why: the tap that took photo A shakes the phone; one jolt inside the
  // dwell starts the dwell again rather than letting a blurred B through.
  it("starts the dwell again after a jolt", () => {
    const before = trace(0, 1000, STAND());
    const jolt = trace(1000, 100, () => 60);
    const after = trace(1100, 3000, STAND(9));
    const at = firstStill([...before, ...jolt, ...after]);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(1100 + STILL_CONFIG.dwellMs);
  });

  // Why: on a pair that changes the viewpoint, B right after A would be A
  // again; the phone has to move and come to rest before B takes itself.
  it("waits for a move first when the pair needs one", () => {
    const still = trace(0, 4000, STAND());
    expect(firstStill(still, true)).toBeNull();
    // The smoothed level stays above the move level about 130 ms past a
    // jolt, so a 100 ms jolt is the short move that must not count.
    const short = trace(4000, 100, () => 60);
    const rest = trace(4100, 3000, STAND(3));
    expect(firstStill([...still, ...short, ...rest], true)).toBeNull();
    const move = trace(4000, 600, () => 60);
    const rest2 = trace(4600, 3000, STAND(3));
    const at = firstStill([...still, ...move, ...rest2], true);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(4600 + STILL_CONFIG.dwellMs);
  });

  // Why: missing readings are no evidence of stillness; a gap longer than
  // maxGapMs starts the dwell again, a short one does not.
  it("starts the dwell again after a dropout longer than the gap limit", () => {
    const a = trace(0, 1000, STAND());
    const shortGap = trace(1000 + STILL_CONFIG.maxGapMs - 100, 3000, STAND(5));
    const t1 = firstStill([...a, ...shortGap]);
    expect(t1).not.toBeNull();
    expect(t1!).toBeLessThan(STILL_CONFIG.dwellMs + 400);
    const longGap = trace(1000 + STILL_CONFIG.maxGapMs + 200, 3000, STAND(5));
    const t2 = firstStill([...a, ...longGap]);
    expect(t2).not.toBeNull();
    expect(t2!).toBeGreaterThanOrEqual(
      1000 + STILL_CONFIG.maxGapMs + 200 + STILL_CONFIG.dwellMs,
    );
  });

  // Why: like motionStep, a reading that is null or not finite counts as
  // missing, and one whose sum overflows is ignored: neither may latch the
  // level or claim stillness.
  it("ignores readings without a finite rate and an overflowing sum", () => {
    const st = run(trace(0, 1000, STAND()));
    const bad: MotionSample[] = [
      { t: 1010, rate: null },
      { t: 1020, rate: { alpha: null, beta: null, gamma: null } },
      { t: 1030, rate: { alpha: Number.NaN, beta: Infinity, gamma: null } },
      { t: 1040, rate: { alpha: 1e308, beta: 1e308, gamma: 1e308 } },
    ];
    const after = bad.reduce((s, b) => stillStep(s, b), st);
    expect(after.level).toBe(st.level);
    expect(after.lastT).toBe(st.lastT);
    expect(after.stillSince).toBe(st.stillSince);
  });

  // Why: a time that is not finite, or runs backwards, cannot be measured
  // against the dwell; such a reading changes nothing.
  it("ignores a reading with a bad or backwards time", () => {
    const st = run(trace(0, 1000, STAND()));
    const r = { alpha: 50, beta: 0, gamma: 0 };
    expect(stillStep(st, { t: Number.NaN, rate: r })).toBe(st);
    expect(stillStep(st, { t: Infinity, rate: r })).toBe(st);
    expect(stillStep(st, { t: st.lastT - 1, rate: r })).toBe(st);
  });

  // Why: a sensor that stops reporting (or never starts) must end the
  // hands-off wait, so the page can offer the tap instead.
  it("reports the readings lost after lostMs without one", () => {
    const st = stillStart(100, false);
    expect(readingsLost(st, 100 + STILL_CONFIG.lostMs)).toBe(false);
    expect(readingsLost(st, 101 + STILL_CONFIG.lostMs)).toBe(true);
    const fed = stillStep(st, {
      t: 2000,
      rate: { alpha: 1, beta: 0, gamma: 0 },
    });
    expect(readingsLost(fed, 2000 + STILL_CONFIG.lostMs)).toBe(false);
    expect(readingsLost(fed, Number.NaN)).toBe(false);
  });

  // Why: the meter ring fills with the dwell; it must stay in 0..1.
  it("gives the dwell's progress from 0 to 1", () => {
    let st = stillStart(0, false);
    expect(stillProgress(st)).toBe(0);
    for (const s of trace(0, 3000, STAND())) {
      st = stillStep(st, s);
      const p = stillProgress(st);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(stillProgress(st)).toBe(1);
  });

  // Why: the smoothing follows time, not the reading count, so a phone
  // that fires at 15 or 120 Hz rests as fast as one at 60 Hz, and a short
  // jolt at a slow rate does not pass for the move a pair needs.
  it("smooths by time, the same at 60 Hz and alike at 15 and 120 Hz", () => {
    const a = stillStep(stillStart(0, false), {
      t: 0,
      rate: { alpha: 10, beta: 0, gamma: 0 },
    });
    const b = stillStep(a, { t: DT, rate: { alpha: 0, beta: 0, gamma: 0 } });
    expect(b.level).toBeCloseTo(8, 9);
    const at = (hz: number): number | null => {
      const out: MotionSample[] = [];
      const axis = HAND(3);
      for (let t = 0; t < 4000; t += 1000 / hz) {
        out.push({ t, rate: { alpha: axis(), beta: axis(), gamma: axis() } });
      }
      return firstStill(out);
    };
    const ref = at(60)!;
    for (const hz of [15, 30, 120]) {
      expect(at(hz), String(hz)).not.toBeNull();
      expect(Math.abs(at(hz)! - ref), String(hz)).toBeLessThan(150);
    }
    const jolt: MotionSample[] = [];
    for (let t = 0; t < 3000; t += 1000 / 15) {
      const fast = t >= 1000 && t < 1150;
      const r = fast ? 120 : 0.3;
      jolt.push({ t, rate: { alpha: r, beta: r, gamma: r } });
    }
    expect(run(jolt, true).moved).toBe(false);
  });

  // Why (sweep): the verdict must not rest on one threshold and dwell.
  // Every claim here is asserted below. Swept 2 to 16 deg/s and 0.8 to
  // 2.5 s: a shaky hand (2.5 deg/s per axis) only comes to rest from 6 up
  // (a stand rests at 2 and 3 too), and no carry with 0.4 s pauses, nor a
  // slow carry without pauses, fires anywhere up to 16. The dwell is what
  // guards a pause while the phone is carried: a 1.2 s pause takes B at
  // 0.8 s, not at 1 s or from 1.5 s up. A tester who pauses longer than
  // the dwell while moving the phone would get B early.
  it("holds over a range of thresholds and dwells", () => {
    const carried = (seed: number, pause: number): MotionSample[] => {
      const out: MotionSample[] = [];
      for (let k = 0; k < 6; k += 1) {
        const t0 = k * (600 + pause);
        out.push(...trace(t0, 600, WALK(seed + k)));
        out.push(...trace(t0 + 600, pause, STAND(seed + k)));
      }
      return out;
    };
    const SHAKY = (seed: number) => noise(2.5, seed);
    for (const threshold of [6, 8, 10, 12, 16]) {
      for (const dwellMs of [1500, 2000, 2500]) {
        const cfg = { ...STILL_CONFIG, threshold, dwellMs };
        for (const seed of [1, 2, 3, 4, 5]) {
          for (const axis of [STAND(seed), HAND(seed), SHAKY(seed)]) {
            const at = firstStill(trace(0, 5000, axis), false, cfg);
            expect(at, `${threshold}/${dwellMs}/${seed}`).not.toBeNull();
            expect(at!).toBeLessThan(dwellMs + 100);
          }
          expect(firstStill(carried(seed, 400), false, cfg)).toBeNull();
          expect(firstStill(carried(seed, 1200), false, cfg)).toBeNull();
        }
      }
    }
    // Below the range the verdict turns: a shaky hand never rests at 4,
    // and a short dwell fires in a pause while carried.
    const low = { ...STILL_CONFIG, threshold: 4 };
    expect(firstStill(trace(0, 5000, SHAKY(1)), false, low)).toBeNull();
    const short = { ...STILL_CONFIG, dwellMs: 800 };
    expect(firstStill(carried(1, 1200), false, short)).not.toBeNull();
    const second = { ...STILL_CONFIG, dwellMs: 1000 };
    expect(firstStill(carried(1, 1200), false, second)).toBeNull();
    // At 2 and 3 deg/s a phone on its stand still rests, a hand does not.
    for (const threshold of [2, 3]) {
      const cfg = { ...STILL_CONFIG, threshold };
      expect(
        firstStill(trace(0, 5000, STAND(1)), false, cfg),
        `stand at ${threshold}`,
      ).not.toBeNull();
      expect(firstStill(trace(0, 5000, SHAKY(1)), false, cfg)).toBeNull();
    }
    // A slow carry (8 to 20 deg/s per axis, never a pause) never fires.
    const r = rng(9);
    const slow = trace(0, 8000, () => 8 + r() * 12);
    for (const threshold of [6, 8, 10, 12, 16]) {
      const cfg = { ...STILL_CONFIG, threshold };
      expect(firstStill(slow, false, cfg), String(threshold)).toBeNull();
    }
  });
});
