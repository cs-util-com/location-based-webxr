/**
 * The sweep behind `MOVE_PROMPT_RULE` (authoring plan 2026-09-28-0953
 * §3.6, M5b; owner rule: a verdict from one parameter value is
 * provisional). Three thresholds are chosen here (the third, the floor,
 * is the shared moved-code floor; its arm reports the choice made):
 *
 * - PERSISTENCE (`minFixes`, `minSeconds`): how long a horizontal refusal
 *   must last before the prompt asks. Too short, and an unmoved code whose
 *   immature or noisy alignment refuses for a moment is offered as moved;
 *   too long, and the author of a moved code waits.
 * - THE SAME SPOT (`sameSpotM`): how far a later visit's offset may lie
 *   from an answered one and still count as the same spot. Too small, and
 *   "Not now" is asked again after a reload on GPS noise alone; too large,
 *   and a code moved again is never asked about.
 * - THE FLOOR (`floorM`): the refusal's bound shrinks with the reported
 *   accuracy, so below a floor an unmoved code under a between-visit bias
 *   difference is offered as moved; above it, real moves go unasked.
 *
 * MODEL (synthetic, like M5a's; no field recording exists): device fixes
 * at 1 Hz with a per-axis Gauss-Markov error (tau 30/100/300 s, sigma
 * 3/5/10 m) plus a bias that differs between the visit that saved the code
 * and this one by 0/8/15 m; the solver's translation error is either the
 * mean of all the session's fixes or a recency-weighted mean (time
 * constant 60 s) - two proxies, because the real solver sits between them.
 * The saved pose's own error is an independent visit's after 60 s. The
 * persistence and same-spot arms use the shipped `correctionBoundM` at 5 m
 * reported accuracy on both sides (26.2 m, above the 20 m floor); the
 * floor arm varies the REPORTED accuracy (2/3/5 m) and the floor
 * (`floorM`, 0/15/20/25 m) over the same noise cells. The gate opens at
 * `MIN_ALIGNMENT_SAMPLES` (3) fixes; sessions last 600 s; 200 seeded
 * sessions per cell.
 *
 * Why this test matters: it prints the trade-off across the whole range,
 * and pins the properties the chosen values were picked for, so a change
 * of the values or of the model shows up here.
 */
import { describe, expect, it } from "vitest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  MOVE_PROMPT_RULE,
  trackMovePrompt,
  type MovePromptOnset,
} from "./code-move-prompt.js";
import { correctionBoundM } from "./visit-settle.js";

const SESSION_S = 600;
const SESSIONS = 200;
const BOUND_M = correctionBoundM(5, 5);
const PERSISTENCES = [1, 5, 10, 20, 30, 60] as const;
const SAME_SPOTS = [5, 10, 15, 20, 25, 30] as const;
const TAUS = [30, 100, 300] as const;
const SIGMAS = [3, 5, 10] as const;
const BIAS_DIFFS = [0, 8, 15] as const;
const PROXIES = ["mean", "ew60"] as const;
type Proxy = (typeof PROXIES)[number];

/** Seeded uniform [0, 1) (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** The solver proxy's translation error after each of `n` fixes. */
function alignmentErrors(
  r: () => number,
  n: number,
  tau: number,
  sigma: number,
  bias: readonly [number, number],
  proxy: Proxy,
): [number, number][] {
  const a = Math.exp(-1 / tau);
  const b = Math.sqrt(1 - a * a) * sigma;
  let x = [gauss(r) * sigma, gauss(r) * sigma];
  const sum = [0, 0];
  let weight = 0;
  const w = Math.exp(-1 / 60);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    if (i > 0) x = [a * x[0]! + b * gauss(r), a * x[1]! + b * gauss(r)];
    const g = [bias[0] + x[0]!, bias[1] + x[1]!];
    const decay = proxy === "mean" ? 1 : w;
    sum[0] = sum[0]! * decay + g[0]!;
    sum[1] = sum[1]! * decay + g[1]!;
    weight = weight * decay + 1;
    out.push([sum[0] / weight, sum[1] / weight]);
  }
  return out;
}

interface Cell {
  tau: number;
  sigma: number;
  biasDiff: number;
  proxy: Proxy;
}

/** One session: the offset of the code as seen at each fix. */
function session(cell: Cell, seed: number, moveM: number): [number, number][] {
  const r = rng(seed);
  const dir = 2 * Math.PI * r();
  const bias: [number, number] = [
    cell.biasDiff * Math.cos(dir),
    cell.biasDiff * Math.sin(dir),
  ];
  const moveDir = 2 * Math.PI * r();
  const move = [moveM * Math.cos(moveDir), moveM * Math.sin(moveDir)];
  // The saved pose: an independent visit's alignment error after 60 s.
  const saved = alignmentErrors(
    r,
    60,
    cell.tau,
    cell.sigma,
    [0, 0],
    cell.proxy,
  ).at(-1)!;
  return alignmentErrors(
    r,
    SESSION_S,
    cell.tau,
    cell.sigma,
    bias,
    cell.proxy,
  ).map(([n, e]) => [n - saved[0] + move[0]!, e - saved[1] + move[1]!]);
}

/** The first fix (s) at which an offset beyond `thresholdM` (the larger of
 *  the refusal's bound and the floor) has lasted `t` fixes/seconds since
 *  the gate opened, or null: the tracker's rule at 1 Hz. */
function firstPrompt(
  offsets: [number, number][],
  t: number,
  thresholdM: number = Math.max(BOUND_M, MOVE_PROMPT_RULE.floorM),
): number | null {
  let run = -1;
  for (let i = MIN_ALIGNMENT_SAMPLES - 1; i < offsets.length; i += 1) {
    const [n, e] = offsets[i]!;
    if (Math.hypot(n, e) > thresholdM) {
      run += 1;
      if (run >= t) return i;
    } else {
      run = -1;
    }
  }
  return null;
}

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const proxy of PROXIES)
    for (const tau of TAUS)
      for (const sigma of SIGMAS)
        for (const biasDiff of BIAS_DIFFS)
          out.push({ tau, sigma, biasDiff, proxy });
  return out;
}

const key = (c: Cell) =>
  `${c.proxy} tau${String(c.tau)} s${String(c.sigma)} B${String(c.biasDiff)}`;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

describe("the move prompt's persistence, swept", () => {
  const table = new Map<string, Record<string, string | number | null>>();
  const falseRate = new Map<string, number[]>();
  const moved50 = new Map<string, number[]>();
  for (const cell of cells()) {
    const row: Record<string, string | number | null> = {};
    const fa: number[] = [];
    const m50: number[] = [];
    const unmoved = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 1000 + s, 0),
    );
    const moved = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 5000 + s, 50),
    );
    const moved30 = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 9000 + s, 30),
    );
    for (const t of PERSISTENCES) {
      const f = unmoved.filter((o) => firstPrompt(o, t) !== null).length;
      fa.push(f);
      const times50 = moved.flatMap((o) => {
        const p = firstPrompt(o, t);
        return p === null ? [] : [p];
      });
      m50.push(times50.length);
      const n30 = moved30.filter((o) => firstPrompt(o, t) !== null).length;
      row[`T${String(t)}`] =
        `${String(f)} / ${String(n30)} / ${String(times50.length)}@${String(median(times50))}`;
    }
    table.set(key(cell), row);
    falseRate.set(key(cell), fa);
    moved50.set(key(cell), m50);
  }

  it("prints, per noise and solver proxy, unmoved prompts / 30 m moves prompted / 50 m moves prompted@median s (of 200)", () => {
    for (const [k, row] of table) {
      process.stdout.write(`MOVE-PROMPT ${k} ${JSON.stringify(row)}\n`);
    }
    expect(table.size).toBe(cells().length);
  });

  it("never prompts more for an unmoved code as persistence grows (a run-length rule)", () => {
    for (const fa of falseRate.values()) {
      for (let i = 1; i < fa.length; i += 1) {
        expect(fa[i]!).toBeLessThanOrEqual(fa[i - 1]!);
      }
    }
  });

  it("at the chosen persistence: no unmoved prompt while sigma <= 5 m with the same bias, every 50 m move prompted", () => {
    const i = PERSISTENCES.indexOf(
      MOVE_PROMPT_RULE.minSeconds as (typeof PERSISTENCES)[number],
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(MOVE_PROMPT_RULE.minFixes).toBe(MOVE_PROMPT_RULE.minSeconds);
    for (const cell of cells()) {
      if (cell.sigma > 5 || cell.biasDiff !== 0) continue;
      expect(falseRate.get(key(cell))![i], key(cell)).toBe(0);
      expect(moved50.get(key(cell))![i], key(cell)).toBe(SESSIONS);
    }
  });

  it("agrees with the tracker itself on one cell, at the 5 m and the 2 m bound (the run-length shortcut is the rule)", () => {
    const cell: Cell = { tau: 30, sigma: 10, biasDiff: 15, proxy: "mean" };
    for (const boundM of [BOUND_M, correctionBoundM(2, 2)]) {
      for (let s = 0; s < 40; s += 1) {
        const offsets = session(cell, 1000 + s, 0);
        let onset: MovePromptOnset | null = null;
        let first: number | null = null;
        offsets.forEach(([n, e], i) => {
          const h = Math.hypot(n, e);
          // The setup feeds the tracker only refusals.
          const r = trackMovePrompt(onset, {
            levelId: "lvl",
            refusal:
              h > boundM
                ? {
                    horizontalM: h,
                    yawDeg: 0,
                    maxHorizontalM: boundM,
                    maxYawDeg: 120,
                  }
                : null,
            offset: { northM: n, eastM: e },
            gateOpen: i + 1 >= MIN_ALIGNMENT_SAMPLES,
            fixCount: i + 1,
            lastFixMs: i * 1000,
            answers: [],
          });
          onset = r.onset;
          if (r.prompt !== null && first === null) first = i;
        });
        expect(first).toBe(
          firstPrompt(
            offsets,
            MOVE_PROMPT_RULE.minSeconds,
            Math.max(boundM, MOVE_PROMPT_RULE.floorM),
          ),
        );
      }
    }
  });
});

describe("the floor under a small reported accuracy, swept (M5b review #1)", () => {
  /**
   * The refusal's bound follows the REPORTED accuracy (13.5 m at 2 m on
   * both sides, 17.7 m at 3 m, 26.2 m at 5 m), while the noise cells keep
   * their own sigma and bias difference: a phone that reports 2-3 m while
   * the two visits disagree by 8-15 m is exactly the case the bound alone
   * cannot see. The prompt asks beyond max(floor, bound); the arm prints,
   * per reported accuracy and floor (0 = no floor, the behaviour before
   * the review), the unmoved prompts and the 30 m / 50 m moves prompted at
   * the chosen persistence, the worst cell across tau and solver proxy.
   */
  const ACCURACIES = [2, 3, 5] as const;
  const FLOORS = [0, 15, 20, 25] as const;
  const t = MOVE_PROMPT_RULE.minSeconds;
  // [acc][floor] -> per (sigma, B) worst unmoved / fewest 30 m / fewest 50 m.
  const worst = new Map<string, { fa: number; m30: number; m50: number }>();
  const cellKey = (acc: number, floor: number, sigma: number, b: number) =>
    `acc${String(acc)} floor${String(floor)} s${String(sigma)} B${String(b)}`;
  for (const cell of cells()) {
    const unmoved = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 1000 + s, 0),
    );
    const moved30 = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 9000 + s, 30),
    );
    const moved50 = Array.from({ length: SESSIONS }, (_, s) =>
      session(cell, 5000 + s, 50),
    );
    for (const acc of ACCURACIES) {
      const boundM = correctionBoundM(acc, acc);
      for (const floor of FLOORS) {
        const thresholdM = Math.max(boundM, floor);
        const count = (list: [number, number][][]) =>
          list.filter((o) => firstPrompt(o, t, thresholdM) !== null).length;
        const k = cellKey(acc, floor, cell.sigma, cell.biasDiff);
        const prev = worst.get(k) ?? { fa: 0, m30: SESSIONS, m50: SESSIONS };
        worst.set(k, {
          fa: Math.max(prev.fa, count(unmoved)),
          m30: Math.min(prev.m30, count(moved30)),
          m50: Math.min(prev.m50, count(moved50)),
        });
      }
    }
  }
  const at = (acc: number, floor: number, sigma: number, b: number) =>
    worst.get(cellKey(acc, floor, sigma, b))!;

  it("prints, per reported accuracy and floor, the worst unmoved prompts / fewest 30 m / fewest 50 m moves prompted (of 200)", () => {
    for (const acc of ACCURACIES) {
      for (const floor of FLOORS) {
        const row = Object.fromEntries(
          SIGMAS.flatMap((sigma) =>
            BIAS_DIFFS.map((b) => {
              const w = at(acc, floor, sigma, b);
              return [
                `s${String(sigma)}B${String(b)}`,
                `${String(w.fa)}/${String(w.m30)}/${String(w.m50)}`,
              ];
            }),
          ),
        );
        process.stdout.write(
          `MOVE-FLOOR acc${String(acc)} floor${String(floor)} ${JSON.stringify(row)}\n`,
        );
      }
    }
    expect(worst.size).toBe(
      ACCURACIES.length * FLOORS.length * SIGMAS.length * BIAS_DIFFS.length,
    );
  });

  it("without a floor a 2 m report prompts for unmoved codes the floor keeps quiet", () => {
    // The finding itself: with no floor, sigma 3 m and 15 m of bias
    // difference at a reported 2 m prompt for an unmoved code often.
    expect(at(2, 0, 3, 15).fa).toBeGreaterThan(SESSIONS * 0.2);
    expect(at(2, MOVE_PROMPT_RULE.floorM, 3, 15).fa).toBeLessThan(
      at(2, 0, 3, 15).fa,
    );
  });

  it("never prompts more for an unmoved code as the floor rises", () => {
    for (const acc of ACCURACIES) {
      for (const sigma of SIGMAS) {
        for (const b of BIAS_DIFFS) {
          for (let i = 1; i < FLOORS.length; i += 1) {
            expect(at(acc, FLOORS[i]!, sigma, b).fa).toBeLessThanOrEqual(
              at(acc, FLOORS[i - 1]!, sigma, b).fa,
            );
          }
        }
      }
    }
  });

  it("at the chosen floor: at most 15 % unmoved prompts while sigma <= 5 m and the bias difference <= 8 m, and no 50 m move lost to the floor", () => {
    const floor = MOVE_PROMPT_RULE.floorM;
    for (const acc of ACCURACIES) {
      for (const sigma of SIGMAS) {
        if (sigma > 5) continue;
        for (const b of BIAS_DIFFS) {
          const k = cellKey(acc, floor, sigma, b);
          // Beyond 8 m (the 15 m cells) no bound is pinned: the sidecar
          // reports their 25.5-52.5 %.
          const limit = b <= 8 ? SESSIONS * 0.15 : SESSIONS;
          expect(at(acc, floor, sigma, b).fa, k).toBeLessThanOrEqual(limit);
          expect(at(acc, floor, sigma, b).m50, k).toBe(
            at(acc, 0, sigma, b).m50,
          );
        }
      }
    }
  });
});

describe("the same-spot distance of a remembered answer, swept", () => {
  /**
   * A later visit's alignment error at 120 s, with its own bias (the cell's
   * bias difference, in a random direction). Two later visits of the same
   * code share its saved pose, so the saved pose's error cancels between
   * their offsets: what differs is only their own errors.
   */
  function visitError(cell: Cell, seed: number): [number, number] {
    const r = rng(seed);
    const dir = 2 * Math.PI * r();
    return alignmentErrors(
      r,
      120,
      cell.tau,
      cell.sigma,
      [cell.biasDiff * Math.cos(dir), cell.biasDiff * Math.sin(dir)],
      cell.proxy,
    ).at(-1)!;
  }
  const offsetAt = (cell: Cell, seed: number, _moveM: number) =>
    visitError(cell, seed);

  it("prints, per noise, how often an answer is asked again for the same spot, and how often a second 20/30 m move is missed (of 200)", () => {
    const rows: string[] = [];
    let chosenWorst = 0;
    for (const cell of cells()) {
      const reask: number[] = SAME_SPOTS.map(() => 0);
      const miss20: number[] = SAME_SPOTS.map(() => 0);
      const miss30: number[] = SAME_SPOTS.map(() => 0);
      for (let s = 0; s < SESSIONS; s += 1) {
        // Two later visits of the same spot: the bias differs between them
        // too, by the cell's bias difference.
        const a = offsetAt(cell, 20_000 + s, 0);
        const b = offsetAt(cell, 40_000 + s, 0);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = rng(60_000 + s);
        const dir = 2 * Math.PI * r();
        SAME_SPOTS.forEach((tol, i) => {
          if (d > tol) reask[i] = reask[i]! + 1;
          for (const [moveM, misses] of [
            [20, miss20],
            [30, miss30],
          ] as const) {
            const dn = a[0] - b[0] + moveM * Math.cos(dir);
            const de = a[1] - b[1] + moveM * Math.sin(dir);
            if (Math.hypot(dn, de) <= tol) misses[i] = misses[i]! + 1;
          }
        });
      }
      const chosen = SAME_SPOTS.indexOf(
        MOVE_PROMPT_RULE.sameSpotM as (typeof SAME_SPOTS)[number],
      );
      if (cell.sigma <= 5 && cell.biasDiff === 0) {
        chosenWorst = Math.max(chosenWorst, reask[chosen]!);
      }
      rows.push(
        `SAME-SPOT ${key(cell)} ${JSON.stringify(
          Object.fromEntries(
            SAME_SPOTS.map((tol, i) => [
              `${String(tol)}m`,
              `${String(reask[i])} / ${String(miss20[i])} / ${String(miss30[i])}`,
            ]),
          ),
        )}`,
      );
    }
    for (const row of rows) process.stdout.write(`${row}\n`);
    // The chosen distance asks again for an unmoved spot in under 5 % of
    // re-visits while sigma <= 5 m and the bias is shared.
    expect(chosenWorst).toBeLessThan(SESSIONS * 0.05);
  });
});
