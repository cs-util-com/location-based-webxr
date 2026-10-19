/**
 * The sweep behind `canTellApart`'s factor, the ceiling's effect on it and
 * the code-held error length (`position-precision.ts`).
 *
 * THE QUESTION. A visitor stands at one of a row of five targets spaced S
 * apart. Is the target nearest to the position the app sees the one the
 * visitor stands at? "Right" is the share of positions for which it is,
 * measured at the three inner targets (each has a neighbour on both sides,
 * the harder case). `canTellApart` should say yes only where that share
 * reaches a goal, and say no as rarely as it can elsewhere.
 *
 * WHAT IS SIMULATED.
 * - **GPS:** the framework's Gauss-Markov GPS error (`gaussMarkovGpsErrors`)
 *   in the `raw` shape the Tour Viewer's station sweeps use (wander 0.6,
 *   white 0.3 of the accuracy, 20 s correlation), at 1 Hz, 60 s at each
 *   target, 40 seeds. True accuracy 1-40 m, spacing 3-50 m. The rule reads
 *   the REPORTED accuracy, 0.5x, 1x or 2x the true one (a phone need not
 *   report its own error honestly).
 * - **A code:** a constant error per walk (its direction spread evenly over
 *   the seeds) of 0-2 m, plus white jitter of 0.05/0.25/0.5 m per position,
 *   at spacing 1-6 m.
 * - **Where the visitor stands:** at the target's centre; and, as the
 *   sensitivity, anywhere within a quarter of half the spacing of it.
 * - **The rule's parameters:** the factor 0.5-3, the ceiling 10-50 m, and
 *   the goal (the share of right positions a "yes" must reach) 80/90/95 %.
 *
 * Every verdict runs through the production `positionPrecision` and
 * `canTellApart`. `POSITION_PRECISION_SWEEP_OUT=<file>` writes every cell
 * and summary; `position-precision.ts.md`, Evidence, has the table.
 */

import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  gaussian,
  gaussMarkovGpsErrors,
  mulberry32,
} from '../test-utils/integrated-slam-drift.js';
import {
  CODE_HELD_ERROR_M,
  POSITION_PRECISION_CEILING_M,
  TELL_APART_FACTOR,
  canTellApart,
  positionPrecision,
  type PositionPrecision,
} from './position-precision.js';

const OUT = process.env['POSITION_PRECISION_SWEEP_OUT'];
const table: string[] = [];

const TARGETS = 5;
const DWELL_S = 60;
const SEEDS = 40;
const RAW = { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 } as const;

const ACCURACIES = [
  1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40,
] as const;
const SPACINGS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50] as const;
const RATIOS = [0.5, 1, 2] as const;
const FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const CEILINGS = [10, 15, 20, 25, 35, 50] as const;
const GOALS = [0.8, 0.9, 0.95] as const;
const SPOTS = [0, 0.25] as const;

const CODE_DRIFTS = [0, 0.5, 1, 1.5, 2] as const;
const CODE_JITTERS = [0.05, 0.25, 0.5] as const;
const CODE_SPACINGS = [1, 1.5, 2, 2.5, 3, 4, 5, 6] as const;

type P = readonly [number, number];

/** Index of the target nearest `p` on a row along x. */
function nearest(p: P, spacing: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < TARGETS; k += 1) {
    const d = Math.hypot(p[0] - k * spacing, p[1]);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

/** Where the visitor stands at target `k`: its centre, or a spot within
 *  `spot` x half the spacing of it. */
function standAt(
  k: number,
  spacing: number,
  spot: number,
  rng: () => number
): P {
  if (spot === 0) return [k * spacing, 0];
  const a = rng() * 2 * Math.PI;
  const r = Math.sqrt(rng()) * spot * (spacing / 2);
  return [k * spacing + r * Math.cos(a), r * Math.sin(a)];
}

/** The share of right positions at the inner targets under GPS error of
 *  true accuracy `a`. */
function gpsRight(a: number, spacing: number, spot: number): number {
  let right = 0;
  let n = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const rng = mulberry32(
      seed * 104729 + Math.round(a * 1009 + spacing * 31 + spot * 7)
    );
    const errors = gaussMarkovGpsErrors(rng, TARGETS * DWELL_S, a, RAW);
    for (let k = 1; k < TARGETS - 1; k += 1) {
      for (let t = 0; t < DWELL_S; t += 1) {
        const at = standAt(k, spacing, spot, rng);
        const e = errors[k * DWELL_S + t]!;
        if (nearest([at[0] + e[0], at[1] + e[1]], spacing) === k) right += 1;
        n += 1;
      }
    }
  }
  return right / n;
}

/** The same under a code-held position: a constant error `drift` per walk
 *  (directions spread evenly over the seeds) plus white jitter. */
function codeRight(drift: number, jitter: number, spacing: number): number {
  let right = 0;
  let n = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const rng = mulberry32(
      seed * 7919 + Math.round(drift * 101 + jitter * 1000 + spacing * 13)
    );
    const dir = (2 * Math.PI * seed) / SEEDS;
    const bias: P = [drift * Math.cos(dir), drift * Math.sin(dir)];
    for (let k = 1; k < TARGETS - 1; k += 1) {
      for (let t = 0; t < DWELL_S; t += 1) {
        const o: P = [
          k * spacing + bias[0] + jitter * gaussian(rng),
          bias[1] + jitter * gaussian(rng),
        ];
        if (nearest(o, spacing) === k) right += 1;
        n += 1;
      }
    }
  }
  return right / n;
}

/** The production judgement of a GPS position reporting `reportedM`. */
function gpsPrecision(reportedM: number, ceilingM: number): PositionPrecision {
  return positionPrecision({
    position: 'aligned',
    codeHold: false,
    gpsPoints: [{ latLongAccuracy: reportedM }],
    ceilingM,
  });
}

const CODE: PositionPrecision = positionPrecision({
  position: 'aligned',
  codeHold: true,
  gpsPoints: [],
});

interface GpsCell {
  readonly a: number;
  readonly spacing: number;
  readonly spot: number;
  readonly right: number;
}
interface CodeCell {
  readonly drift: number;
  readonly jitter: number;
  readonly spacing: number;
  readonly right: number;
}
const gpsCells: GpsCell[] = [];
const codeCells: CodeCell[] = [];

function computeAll(): void {
  if (gpsCells.length > 0) return;
  for (const spot of SPOTS) {
    for (const a of ACCURACIES) {
      for (const spacing of SPACINGS) {
        const right = gpsRight(a, spacing, spot);
        gpsCells.push({ a, spacing, spot, right });
        table.push(
          `gps spot ${String(spot)} acc ${String(a)} spacing ${String(spacing)}: right ${pct(right)}`
        );
      }
    }
  }
  for (const drift of CODE_DRIFTS) {
    for (const jitter of CODE_JITTERS) {
      for (const spacing of CODE_SPACINGS) {
        const right = codeRight(drift, jitter, spacing);
        codeCells.push({ drift, jitter, spacing, right });
        table.push(
          `code drift ${String(drift)} jitter ${String(jitter)} spacing ${String(spacing)}: right ${pct(right)}`
        );
      }
    }
  }
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

/** How a rule (factor, ceiling) fares on the GPS cells at one reported
 *  ratio, spot and goal. */
interface Verdict {
  /** "Yes" where fewer than `goal` of the positions are right. */
  readonly unsafeYes: number;
  /** "No" where at least `goal` are right. */
  readonly needlessNo: number;
  readonly yes: number;
  /** The lowest right share among the "yes" cells (1 with none). */
  readonly worstYes: number;
}

function judge(
  factor: number,
  ceilingM: number,
  ratio: number,
  spot: number,
  goal: number
): Verdict {
  let unsafeYes = 0;
  let needlessNo = 0;
  let yes = 0;
  let worstYes = 1;
  for (const c of gpsCells) {
    if (c.spot !== spot) continue;
    const said = canTellApart(gpsPrecision(ratio * c.a, ceilingM), c.spacing, {
      factor,
    });
    if (said) {
      yes += 1;
      worstYes = Math.min(worstYes, c.right);
      if (c.right < goal) unsafeYes += 1;
    } else if (c.right >= goal) {
      needlessNo += 1;
    }
  }
  return { unsafeYes, needlessNo, yes, worstYes };
}

/** The smallest swept factor whose every "yes" reaches the goal. */
function smallestSafeFactor(
  ratio: number,
  spot: number,
  goal: number,
  ceilingM = POSITION_PRECISION_CEILING_M
): number | null {
  for (const f of FACTORS) {
    if (judge(f, ceilingM, ratio, spot, goal).unsafeYes === 0) return f;
  }
  return null;
}

function summaryLine(
  label: string,
  f: number,
  ceilingM: number,
  ratio: number,
  spot: number,
  goal: number
): void {
  const v = judge(f, ceilingM, ratio, spot, goal);
  table.push(
    `SUMMARY ${label} factor ${String(f)} ceiling ${String(ceilingM)} ratio ${String(ratio)} spot ${String(spot)} goal ${pct(goal)}: yes ${String(v.yes)}, unsafe yes ${String(v.unsafeYes)}, needless no ${String(v.needlessNo)}, worst yes ${pct(v.worstYes)}`
  );
}

describe(
  'position precision sweep (canTellApart)',
  { timeout: 120_000 },
  () => {
    afterAll(() => {
      if (OUT !== undefined) writeFileSync(OUT, table.join('\n') + '\n');
    });

    // Why this test matters: it is the evidence for the shipped factor. On
    // an honest accuracy report, 1.25 is the smallest swept factor whose
    // every "yes" picks the right target at least 90 % of the time; 1 says
    // yes where only about 86 % are right. The goal is a parameter: 80 %
    // would take 1, 95 % 1.5.
    it('honest report: 1.25 is the smallest factor safe at a 90 % goal; 80 % takes 1, 95 % takes 1.5', () => {
      computeAll();
      for (const goal of GOALS) {
        for (const f of FACTORS) {
          summaryLine('honest', f, POSITION_PRECISION_CEILING_M, 1, 0, goal);
        }
      }
      expect(TELL_APART_FACTOR).toBe(1.25);
      expect(smallestSafeFactor(1, 0, 0.9)).toBe(TELL_APART_FACTOR);
      expect(smallestSafeFactor(1, 0, 0.8)).toBe(1);
      expect(smallestSafeFactor(1, 0, 0.95)).toBe(1.5);
      // The rule says yes somewhere, so the zero above is not vacuous.
      expect(
        judge(TELL_APART_FACTOR, POSITION_PRECISION_CEILING_M, 1, 0, 0.9).yes
      ).toBeGreaterThan(20);
    });

    // Why this test matters: the rule reads what the phone REPORTS. A phone
    // that reports half its true error makes 1.25 say yes where it should
    // not; one that reports double makes it refuse more than it must. This
    // pins how far the verdict moves with an honest-report assumption.
    it('a report of half the error needs 2.5; one of double is safe at 1.25 and would be at 0.75', () => {
      computeAll();
      for (const ratio of RATIOS) {
        for (const f of FACTORS) {
          summaryLine('ratio', f, POSITION_PRECISION_CEILING_M, ratio, 0, 0.9);
        }
      }
      expect(
        judge(TELL_APART_FACTOR, POSITION_PRECISION_CEILING_M, 0.5, 0, 0.9)
          .unsafeYes
      ).toBeGreaterThan(0);
      expect(smallestSafeFactor(0.5, 0, 0.9)).toBe(2.5);
      expect(smallestSafeFactor(2, 0, 0.9)).toBe(0.75);
    });

    // Why this test matters: a visitor does not stand on a target's exact
    // centre. Standing anywhere within a quarter of half the spacing of it
    // must not make the shipped factor unsafe.
    it('standing off-centre (a quarter of half the spacing) keeps 1.25 safe at a 90 % goal', () => {
      computeAll();
      summaryLine(
        'spot',
        TELL_APART_FACTOR,
        POSITION_PRECISION_CEILING_M,
        1,
        0.25,
        0.9
      );
      expect(
        judge(TELL_APART_FACTOR, POSITION_PRECISION_CEILING_M, 1, 0.25, 0.9)
          .unsafeYes
      ).toBe(0);
    });

    // Why this test matters: the ceiling only ever turns a yes into a no,
    // so it can never make the rule unsafe; it only costs needless no's.
    // Within 3-50 m of spacing, 1.25 already refuses every accuracy above
    // 20 m, so a ceiling of 20 m or more changes no verdict; 10-15 m would
    // refuse wide-spaced targets the rule could tell apart.
    it('the ceiling never adds an unsafe yes, and at 20 m or more changes no verdict at 1.25', () => {
      computeAll();
      const base = judge(
        TELL_APART_FACTOR,
        POSITION_PRECISION_CEILING_M,
        1,
        0,
        0.9
      );
      const at = (c: number) => judge(TELL_APART_FACTOR, c, 1, 0, 0.9);
      for (const c of CEILINGS) {
        summaryLine('ceiling', TELL_APART_FACTOR, c, 1, 0, 0.9);
        expect(at(c).unsafeYes).toBe(0);
      }
      for (const c of CEILINGS.filter((c) => c >= 20)) {
        expect(at(c)).toEqual(base);
      }
      for (const c of CEILINGS.filter((c) => c < 20)) {
        expect(at(c).needlessNo).toBeGreaterThan(base.needlessNo);
      }
    });

    // Why this test matters: a code-held position has no measured number,
    // so the rule judges it by a fixed length. At 1.25 x 1 m it says yes
    // from 2.5 m of spacing; that is safe while the code-held error stays
    // at 1 m or less with up to 0.25 m of jitter, and a constant error of
    // 1.5 m or more is what reverses it.
    it('a code: 1 m is safe at a 90 % goal up to 1 m of error and 0.25 m of jitter; 1.5 m of error reverses it', () => {
      computeAll();
      const unsafe = (keep: (c: CodeCell) => boolean) =>
        codeCells.filter(
          (c) => keep(c) && canTellApart(CODE, c.spacing) && c.right < 0.9
        );
      const yesCells = codeCells.filter((c) => canTellApart(CODE, c.spacing));
      expect(yesCells.length).toBeGreaterThan(0);
      expect(CODE_HELD_ERROR_M).toBe(1);
      expect(unsafe((c) => c.drift <= 1 && c.jitter <= 0.25)).toEqual([]);
      expect(unsafe((c) => c.drift >= 1.5).length).toBeGreaterThan(0);
      for (const c of codeCells) {
        if (canTellApart(CODE, c.spacing) && c.right < 0.9) {
          table.push(
            `CODE unsafe yes: drift ${String(c.drift)} jitter ${String(c.jitter)} spacing ${String(c.spacing)} right ${pct(c.right)}`
          );
        }
      }
    });
  }
);
