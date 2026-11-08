/**
 * The narration circle's radius and margin, swept over position noise.
 * A circle too small, or an edge with too little margin, closes the player
 * on a visitor who stands still listening, or opens it on one standing
 * beside it.
 *
 * What the code measures (`spot.ts`): the distance, in the scene's x/z,
 * between the tracked camera and the circle's centre. Both live in the
 * same scene frame, so the GPS alignment's offset moves the circle and the
 * visitor together and cancels out of that distance; what is left is the
 * tracking's own wobble and drift between the camera and the scene.
 *
 * Model (stated, not measured on a phone): each horizontal axis of the
 * camera carries a first-order Gauss-Markov error (sigma, correlation time
 * tau) plus white jitter, sampled at 1 Hz for 3 minutes, 400 seeded runs
 * per cell, on top of a shared alignment offset that moves the circle as
 * well. Three tracking models, from steady to poor. A listener stands
 * still at a uniform spot within half the radius; a neighbour stands 2 m
 * beyond the radius plus margin.
 */
import { describe, expect, it } from "vitest";

import {
  circleInside,
  NARRATION_DEFAULT_RADIUS_M,
  NARRATION_MARGIN_M,
} from "./sound-reach.js";

interface Noise {
  readonly name: string;
  readonly sigmaM: number;
  readonly tauS: number;
  readonly whiteM: number;
}

const MODELS: readonly Noise[] = [
  { name: "tracking-steady", sigmaM: 0.15, tauS: 30, whiteM: 0.03 },
  { name: "tracking-drifting", sigmaM: 0.5, tauS: 120, whiteM: 0.05 },
  { name: "tracking-poor", sigmaM: 1, tauS: 60, whiteM: 0.15 },
];
const RADII = [3, 4, 5, 6, 7, 8];
const MARGINS = [0.5, 1, 1.5, 2];
const RUNS = 400;
const SECONDS = 180;
/** How far the GPS alignment may put the whole scene off (m). */
const ALIGNMENT_SIGMA_M = 5;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Whether one still visitor at `at` (relative to the circle) sees the
 *  circle's state change against `expectInside` at least once after the
 *  first second. `offset` is the alignment's shift, applied to the circle
 *  and the camera alike, as the scene frame does. */
function disturbed(
  rand: () => number,
  noise: Noise,
  at: readonly [number, number],
  offset: readonly [number, number],
  radiusM: number,
  marginM: number,
  expectInside: boolean,
): boolean {
  const a = Math.exp(-1 / noise.tauS);
  const b = Math.sqrt(1 - a * a) * noise.sigmaM;
  let ex = gaussian(rand) * noise.sigmaM;
  let ez = gaussian(rand) * noise.sigmaM;
  let inside = expectInside;
  const centre = offset;
  for (let t = 0; t < SECONDS; t += 1) {
    ex = a * ex + b * gaussian(rand);
    ez = a * ez + b * gaussian(rand);
    const x = offset[0] + at[0] + ex + gaussian(rand) * noise.whiteM;
    const z = offset[1] + at[1] + ez + gaussian(rand) * noise.whiteM;
    const d = Math.hypot(x - centre[0], z - centre[1]);
    inside = circleInside(d, radiusM, marginM, inside);
    if (inside !== expectInside) return true;
  }
  return false;
}

function rate(
  noise: Noise,
  radiusM: number,
  marginM: number,
  listener: boolean,
  alignment = true,
): number {
  const rand = mulberry32(
    Math.round(radiusM * 1000 + marginM * 100 + noise.sigmaM * 7919),
  );
  let hits = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const angle = 2 * Math.PI * rand();
    const d = listener
      ? (radiusM / 2) * Math.sqrt(rand())
      : radiusM + marginM + 2;
    const at = [d * Math.cos(angle), d * Math.sin(angle)] as const;
    const ox = gaussian(rand) * ALIGNMENT_SIGMA_M;
    const oz = gaussian(rand) * ALIGNMENT_SIGMA_M;
    const offset = alignment ? ([ox, oz] as const) : ([0, 0] as const);
    if (disturbed(rand, noise, at, offset, radiusM, marginM, listener)) {
      hits += 1;
    }
  }
  return hits / RUNS;
}

/** The whole sweep, once: interrupted listeners and disturbed neighbours
 *  per model, radius and margin. */
const SWEEP = MODELS.map((noise) => ({
  noise,
  cells: RADII.flatMap((r) =>
    MARGINS.map((m) => ({
      r,
      m,
      interrupted: rate(noise, r, m, true),
      opened: rate(noise, r, m, false),
    })),
  ),
}));

/** An interruption in 3 minutes for at most 1 listener in 20. */
const HOLDS = 0.05;

describe("the narration circle under tracking noise (sweep)", () => {
  it("prints the table: interrupted listeners and disturbed neighbours", () => {
    // Why: the radius default rests on this table; the verdict is read
    // across the range, so the whole table is kept in the test's output.
    for (const { noise, cells } of SWEEP) {
      const rows = cells.map(
        (c) =>
          `r ${String(c.r)} m, margin ${c.m.toFixed(1)} m: interrupted ${(100 * c.interrupted).toFixed(1)} %, neighbour opened ${(100 * c.opened).toFixed(1)} %`,
      );
      console.info(`${noise.name}\n  ${rows.join("\n  ")}`);
    }
    expect(SWEEP).toHaveLength(MODELS.length);
  });

  it("the alignment's offset changes nothing: it moves the circle and the visitor together", () => {
    // Why: the circle and the camera share the scene frame, so a GPS
    // alignment that is metres off shifts both; only the tracking's own
    // noise reaches the distance the circle reads. Same seed with and
    // without the offset gives the same verdict.
    for (const noise of MODELS) {
      for (const listener of [true, false]) {
        expect(rate(noise, 6, 1.5, listener, true)).toBe(
          rate(noise, 6, 1.5, listener, false),
        );
      }
    }
  });

  it("holds every swept circle under steady or drifting tracking, and from 4 m with a 1 m margin under poor", () => {
    // Why: the measured verdict across the range, kept as a test so a
    // change to the edge rule or the model is seen. Only poor tracking
    // (1 m of slow error, 0.15 m of jitter) reaches the small circles and
    // the thinnest margin; nothing here is a GPS limit, since the
    // alignment cancels out of the distance.
    const holds = (c: { interrupted: number; opened: number }) =>
      c.interrupted <= HOLDS && c.opened <= HOLDS;
    const [steady, drifting, poor] = SWEEP.map((s) => s.cells);
    for (const c of [...(steady ?? []), ...(drifting ?? [])]) {
      expect(holds(c)).toBe(true);
    }
    for (const c of poor ?? []) {
      expect(holds(c)).toBe(c.r >= 4 ? c.m >= 1 : c.m >= 1.5);
    }
  });

  it("the default circle holds under every tracking model swept", () => {
    // Why: the default (`NARRATION_DEFAULT_RADIUS_M`, 6 m, margin
    // `NARRATION_MARGIN_M`, 1.5 m) is what a tour gets when its block names
    // no radius; a field walk found it stable, and it must hold from
    // steady tracking to poor.
    for (const { cells } of SWEEP) {
      const c = cells.find(
        (c) => c.r === NARRATION_DEFAULT_RADIUS_M && c.m === NARRATION_MARGIN_M,
      );
      expect(c?.interrupted).toBeLessThanOrEqual(HOLDS);
      expect(c?.opened).toBeLessThanOrEqual(HOLDS);
    }
  });
});
