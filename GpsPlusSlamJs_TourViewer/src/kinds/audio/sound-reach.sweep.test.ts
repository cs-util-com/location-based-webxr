/**
 * The narration circle's radius and margin, swept over position noise.
 * A visitor's position in the world wobbles with GPS; a circle too small,
 * or an edge with too little margin, closes the player on a visitor who
 * stands still listening, or opens it on one standing beside it.
 *
 * Model (stated, not measured on a phone): each horizontal axis carries a
 * first-order Gauss-Markov error (sigma, correlation time tau) plus white
 * jitter, sampled at 1 Hz for 3 minutes, 400 seeded runs per cell. Three
 * models: GPS alone under open sky, GPS alone in a street canyon, and GPS
 * fused with the phone's tracking. A listener stands still at a uniform
 * spot within half the radius; a neighbour stands 2 m beyond the radius.
 */
import { describe, expect, it } from "vitest";

import { circleInside } from "./sound-reach.js";

interface Noise {
  readonly name: string;
  readonly sigmaM: number;
  readonly tauS: number;
  readonly whiteM: number;
}

const MODELS: readonly Noise[] = [
  { name: "gps-open", sigmaM: 2, tauS: 15, whiteM: 0.5 },
  { name: "gps-canyon", sigmaM: 4, tauS: 30, whiteM: 1 },
  { name: "fused", sigmaM: 0.7, tauS: 60, whiteM: 0.1 },
];
const RADII = [3, 4, 5, 6, 7, 8, 10, 12, 16];
const MARGINS = [0.5, 1, 1.5, 2, 3];
const RUNS = 400;
const SECONDS = 180;

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

/** Whether one still visitor at `[x, z]` sees the circle's state change
 *  against `expectInside` at least once after the first second. */
function disturbed(
  rand: () => number,
  noise: Noise,
  at: readonly [number, number],
  radiusM: number,
  marginM: number,
  expectInside: boolean,
): boolean {
  const a = Math.exp(-1 / noise.tauS);
  const b = Math.sqrt(1 - a * a) * noise.sigmaM;
  let ex = gaussian(rand) * noise.sigmaM;
  let ez = gaussian(rand) * noise.sigmaM;
  let inside = expectInside;
  for (let t = 0; t < SECONDS; t += 1) {
    ex = a * ex + b * gaussian(rand);
    ez = a * ez + b * gaussian(rand);
    const x = at[0] + ex + gaussian(rand) * noise.whiteM;
    const z = at[1] + ez + gaussian(rand) * noise.whiteM;
    inside = circleInside(Math.hypot(x, z), radiusM, marginM, inside);
    if (inside !== expectInside) return true;
  }
  return false;
}

function rate(
  noise: Noise,
  radiusM: number,
  marginM: number,
  listener: boolean,
): number {
  const rand = mulberry32(
    Math.round(radiusM * 1000 + marginM * 100) + noise.sigmaM * 7919,
  );
  let hits = 0;
  for (let run = 0; run < RUNS; run += 1) {
    const angle = 2 * Math.PI * rand();
    const d = listener
      ? (radiusM / 2) * Math.sqrt(rand())
      : radiusM + marginM + 2;
    const at = [d * Math.cos(angle), d * Math.sin(angle)] as const;
    if (disturbed(rand, noise, at, radiusM, marginM, listener)) hits += 1;
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

describe("the narration circle under position noise (sweep)", () => {
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

  it("under GPS alone in the open, a listener holds only from 10 m with a 1.5 m margin", () => {
    // Why: the measured verdict, kept as a test so a change to the edge
    // rule or the model is seen. It contradicts the earlier belief that
    // 6 m is enough under GPS alone: at 6 m only a 3 m margin comes near
    // (about 7 %), and no cell of 3 to 8 m with a margin to 1.5 m holds.
    const open = SWEEP[0]?.cells ?? [];
    const holds = (c: { interrupted: number }) => c.interrupted <= HOLDS;
    for (const c of open.filter((c) => c.r <= 8 && c.m <= 1.5)) {
      expect(holds(c)).toBe(false);
    }
    for (const c of open.filter((c) => c.r >= 10 && c.m >= 1.5)) {
      expect(holds(c)).toBe(true);
    }
  });

  it("in a street canyon, GPS alone holds no circle up to 16 m", () => {
    // Why: where GPS alone is all there is, a narration circle cannot be
    // relied on at any radius swept; the circle needs the phone's tracking.
    const canyon = SWEEP[1]?.cells ?? [];
    for (const c of canyon) expect(c.interrupted).toBeGreaterThan(HOLDS);
  });

  it("with tracking fused in, every circle from 3 m with a 1 m margin holds", () => {
    // Why: the visitor's AR view tracks with the phone and corrects by GPS
    // slowly; the default (`NARRATION_DEFAULT_RADIUS_M`, 6 m, margin
    // `NARRATION_MARGIN_M`, 1.5 m) sits well inside what holds here.
    const fused = SWEEP[2]?.cells ?? [];
    for (const c of fused.filter((c) => c.m >= 1)) {
      expect(c.interrupted).toBeLessThanOrEqual(HOLDS);
      expect(c.opened).toBeLessThanOrEqual(HOLDS);
    }
  });
});
