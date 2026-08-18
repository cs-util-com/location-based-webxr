/**
 * Deterministic synthetic tick-stream generators for the elevation-offset
 * estimator's named scenarios.
 *
 * Scenarios are synthesised AT THE SAMPLE LEVEL — the estimator is pure
 * over (t, sample, confidence, position) streams, so a tower dwell is a
 * generated series, not a synthetic 3D scene. All generators are seeded
 * (mulberry32 PRNG) and fully deterministic; tests never touch
 * Math.random.
 *
 * Encoding convention: `sampleM` is the BASELINE-FREE quantity
 * (AR floor height minus terrain height). A hillside walk therefore
 * encodes as a CONSTANT sampleM with a moving position — the AR floor and
 * the terrain rise together, their difference does not. Only man-made
 * structure (tower, stairs, bridge) makes sampleM ramp.
 *
 * @see elevation-offset-scenarios.ts.md for detailed documentation
 */

import type {
  ElevationOffsetSample,
  ElevationOffsetTick,
} from '../ar/elevation-offset-estimator';

export interface ElevationScenario {
  readonly name: string;
  readonly ticks: readonly ElevationOffsetTick[];
  /** The generator's ground-truth steady-state sampleM (metres). */
  readonly baseSampleM: number;
}

/** One tick per second — the estimator's intended ~1 Hz cadence. */
export const SCENARIO_TICK_MS = 1000;
const WALK_SPEED_MPS = 1.4;
const SAMPLES_PER_TICK = 6;
const DEFAULT_SIGMA_M = 0.3;
const DEFAULT_CONFIDENCE = 0.8;
/** Horizontal scatter of a tick's hits around the camera (± metres). */
const SAMPLE_SCATTER_M = 2;

/** mulberry32 — small, seeded, deterministic PRNG (never Math.random). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller (guarded against log(0)). */
export function gaussOf(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

interface TickSpec {
  readonly baseM: number;
  readonly sigmaM: number;
  readonly confidence: number;
}

function spec(
  baseM: number,
  sigmaM = DEFAULT_SIGMA_M,
  confidence = DEFAULT_CONFIDENCE
): TickSpec {
  return { baseM, sigmaM, confidence };
}

function level(n: number, baseM: number, sigmaM?: number): TickSpec[] {
  return Array.from({ length: n }, () => spec(baseM, sigmaM));
}

/** Ramp from fromM (exclusive) to toM (inclusive) in stepM increments. */
function ramp(
  fromM: number,
  toM: number,
  stepM: number,
  sigmaM?: number
): TickSpec[] {
  const out: TickSpec[] = [];
  const dir = toM >= fromM ? 1 : -1;
  for (let v = fromM + dir * stepM; (toM - v) * dir > 0; v += dir * stepM) {
    out.push(spec(v, sigmaM));
  }
  out.push(spec(toM, sigmaM));
  return out;
}

interface ScenarioOpts {
  readonly name: string;
  readonly seed: number;
  readonly specs: readonly TickSpec[];
  /** Walking at WALK_SPEED_MPS (east) vs standing at the origin. */
  readonly moving: boolean;
  /** Gaussian camera-position jitter (σ, metres). */
  readonly positionJitterM: number;
  readonly baseSampleM: number;
}

function buildScenario(opts: ScenarioOpts): ElevationScenario {
  const rng = mulberry32(opts.seed);
  const ticks: ElevationOffsetTick[] = [];
  for (let i = 0; i < opts.specs.length; i++) {
    const s = opts.specs[i];
    if (s == null) {
      continue;
    }
    const tMs = i * SCENARIO_TICK_MS;
    const walkE = opts.moving
      ? i * WALK_SPEED_MPS * (SCENARIO_TICK_MS / 1000)
      : 0;
    const posE = walkE + gaussOf(rng) * opts.positionJitterM;
    const posN = gaussOf(rng) * opts.positionJitterM;
    const samples: ElevationOffsetSample[] = [];
    for (let k = 0; k < SAMPLES_PER_TICK; k++) {
      samples.push({
        sampleM: s.baseM + gaussOf(rng) * s.sigmaM,
        confidence: clamp01(s.confidence + gaussOf(rng) * 0.05),
        posE: posE + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
        posN: posN + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
      });
    }
    // cameraYar tracks the climb the way the raw AR frame would; the
    // estimator only validates it, so any plausible finite value works.
    ticks.push({ tMs, posE, posN, cameraYar: 1.6 + s.baseM, samples });
  }
  return { name: opts.name, ticks, baseSampleM: opts.baseSampleM };
}

/** Flat village walk: constant delta, moving position, good confidence. */
export function flatWalk(seed: number): ElevationScenario {
  return buildScenario({
    name: 'flatWalk',
    seed,
    specs: level(120, -2),
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: -2,
  });
}

/**
 * Hillside walk — the field case that must NEVER freeze: the AR floor and
 * the terrain both rise, so the baseline-free delta stays constant
 * (+ noise) while the position moves at full walking speed.
 */
export function hillsideWalk(seed: number): ElevationScenario {
  return buildScenario({
    name: 'hillsideWalk',
    seed,
    specs: level(240, 1),
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: 1,
  });
}

/**
 * Tower dwell: nearly static position; sampleM ramps ~2 m/tick to +20 m
 * and HOLDS for minutes (the canonical "climbed the tower to look at the
 * city" dwell no timer-based unfreeze survives), then returns to ground.
 * Ramp up is ticks 40..49, the dwell 50..199, ramp down 200..209.
 */
export function towerDwell(seed: number): ElevationScenario {
  return buildScenario({
    name: 'towerDwell',
    seed,
    specs: [
      ...level(40, 0),
      ...ramp(0, 20, 2),
      ...level(150, 20),
      ...ramp(20, 0, 2),
      ...level(40, 0),
    ],
    moving: false,
    positionJitterM: 0.2,
    baseSampleM: 0,
  });
}

/**
 * Stairwell / second floor: climbed ON THE SPOT with a deliberately GENTLE
 * ramp (0.8 m/tick, low noise) sized so the halved (small-extent) CUSUM
 * threshold triggers one tick EARLIER than the full threshold would — the
 * strengthened path is then observable behaviorally, by comparing against
 * an estimator configured with the strengthening disabled.
 * Ramp up is ticks 40..47, the hold 48..77, ramp down 78..85.
 */
export function stairwellClimb(seed: number): ElevationScenario {
  return buildScenario({
    name: 'stairwellClimb',
    seed,
    specs: [
      ...level(40, 0, 0.05),
      ...ramp(0, 6, 0.8, 0.05),
      ...level(30, 6, 0.05),
      ...ramp(6, 0, 0.8, 0.05),
      ...level(40, 0, 0.05),
    ],
    moving: false,
    positionJitterM: 0.2,
    baseSampleM: 0,
  });
}

/**
 * Bridge / elevated walkway: position moves at FULL walking speed the
 * whole time (extent must never veto), sampleM ramps to +8 m, holds,
 * ramps back. Ramp up is ticks 40..49, hold 50..89, ramp down 90..99.
 */
export function bridgeCrossing(seed: number): ElevationScenario {
  return buildScenario({
    name: 'bridgeCrossing',
    seed,
    specs: [
      ...level(40, 0),
      ...ramp(0, 8, 0.8),
      ...level(40, 8),
      ...ramp(8, 0, 0.8),
      ...level(40, 0),
    ],
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: 0,
  });
}

/**
 * Gradient ramp walk — the DEM-error-gradient field case (a hillside whose
 * terrain model is offset proportionally to distance walked, ~0.3 m per
 * metre): sampleM ramps slowly (0.4 m/tick at walk speed) for 60 ticks
 * while the camera walks. A slow coherent ramp is DATA, not man-made
 * structure — the estimator must keep tracking (never freeze) and follow
 * within the slew bound. Ramp is ticks 40..99 (0 → +24 m), then 40 level.
 */
export function rampWalk(seed: number): ElevationScenario {
  return buildScenario({
    name: 'rampWalk',
    seed,
    specs: [...level(40, 0), ...ramp(0, 24, 0.4), ...level(40, 24)],
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: 24,
  });
}

/**
 * Underpass / sunken walkway — the negative twin of bridgeCrossing: full
 * walking speed throughout, sampleM ramps DOWN to −8 m, holds, ramps back.
 * A downward ramp can only trigger the NEGATIVE CUSUM branch, so this is
 * the branch's dedicated coverage. Ramp down is ticks 40..49, the hold
 * 50..89, ramp up 90..99.
 */
export function underpassWalk(seed: number): ElevationScenario {
  return buildScenario({
    name: 'underpassWalk',
    seed,
    specs: [
      ...level(40, 0),
      ...ramp(0, -8, 0.8),
      ...level(40, -8),
      ...ramp(-8, 0, 0.8),
      ...level(40, 0),
    ],
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: 0,
  });
}

/** Standstill: no movement at all, constant sampleM + noise. */
export function standstill(seed: number): ElevationScenario {
  return buildScenario({
    name: 'standstill',
    seed,
    specs: level(120, -1),
    moving: false,
    positionJitterM: 0.03,
    baseSampleM: -1,
  });
}

/**
 * GPS outage on a hillside: still walking, sampleM constant but noisier as
 * the stale-fix terrain lookup degrades, and confidence decays toward
 * zero — the confidence-collapse freeze path's scenario.
 */
export function gpsOutageWalk(seed: number): ElevationScenario {
  const specs: TickSpec[] = [];
  for (let i = 0; i < 120; i++) {
    if (i < 30) {
      specs.push(spec(1));
    } else {
      const k = i - 30;
      const sigmaM = Math.min(0.5, DEFAULT_SIGMA_M + 0.005 * k);
      const confidence = Math.max(0.02, DEFAULT_CONFIDENCE * Math.pow(0.9, k));
      specs.push(spec(1, sigmaM, confidence));
    }
  }
  return buildScenario({
    name: 'gpsOutageWalk',
    seed,
    specs,
    moving: true,
    positionJitterM: 0.05,
    baseSampleM: 1,
  });
}

/**
 * Garbage-confidence walk: every tick carries 4 good hits at the base
 * delta and 2 garbage hits at +10 m whose confidence is 0 or NaN
 * (alternating). The floored-never-rejected weighting must keep the
 * garbage from dominating the estimate.
 */
export function garbageConfidenceWalk(seed: number): ElevationScenario {
  const rng = mulberry32(seed);
  const baseSampleM = -2;
  const ticks: ElevationOffsetTick[] = [];
  for (let i = 0; i < 100; i++) {
    const tMs = i * SCENARIO_TICK_MS;
    const posE = i * WALK_SPEED_MPS + gaussOf(rng) * 0.05;
    const posN = gaussOf(rng) * 0.05;
    const samples: ElevationOffsetSample[] = [];
    for (let k = 0; k < 4; k++) {
      samples.push({
        sampleM: baseSampleM + gaussOf(rng) * DEFAULT_SIGMA_M,
        confidence: clamp01(DEFAULT_CONFIDENCE + gaussOf(rng) * 0.05),
        posE: posE + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
        posN: posN + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
      });
    }
    for (let k = 0; k < 2; k++) {
      samples.push({
        sampleM: 10 + gaussOf(rng) * 0.1,
        confidence: k % 2 === 0 ? 0 : Number.NaN,
        posE: posE + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
        posN: posN + (rng() * 2 - 1) * SAMPLE_SCATTER_M,
      });
    }
    ticks.push({ tMs, posE, posN, cameraYar: 1.6, samples });
  }
  return { name: 'garbageConfidenceWalk', ticks, baseSampleM };
}
