/**
 * The sweep behind `canTellApart`'s factor, the ceiling's effect on it and
 * the code-held error length (`position-precision.ts`).
 *
 * THE QUESTION. A visitor stands at a target whose nearest other targets
 * are S away. Is the target nearest to the position the app sees the one
 * the visitor stands at? "Right" is the share of positions for which it is.
 * `canTellApart` should say yes only where that share reaches a goal, and
 * say no as rarely as it can elsewhere.
 *
 * THE LAYOUT MATTERS. "S, the distance to the nearest other target" holds
 * one neighbour on each side in a row, four in a square grid and six in a
 * hexagonal one, and every neighbour at S is one more way to be wrong. So
 * the same error is right less often in a grid than in a row, and the
 * factor is set by the worst of the three layouts:
 * - **row:** the neighbours at -S and +S on a line;
 * - **square:** a square grid of side S (the eight around the target);
 * - **hex:** a hexagonal grid, six neighbours at S.
 * Each is measured at a target with its whole first ring present. In these
 * three layouts that ring alone bounds the target's area of "nearest", so
 * this is exactly an inner target of any larger layout; targets further out
 * never change the answer.
 *
 * WHAT IS SIMULATED.
 * - **GPS:** the framework's Gauss-Markov GPS error (`gaussMarkovGpsErrors`)
 *   at 1 Hz, 180 s at the target, 40 seeds, true accuracy 1-40 m, spacing
 *   3-50 m. One seeded error series per cell is read in all three layouts,
 *   so the layouts differ only in their geometry. Three noise shapes,
 *   mirroring the Tour Viewer's station sweeps (`station-bands.sweep.test.ts`):
 *   - `raw`: wander 0.60, white 0.30 of the accuracy, 20 s (0.67 of the
 *     accuracy per axis): the reported accuracy read as a 68 % radius, what
 *     a phone reports for a raw fix. The factor is set on this one;
 *   - `mid`: wander 0.45, white 0.20, 20 s;
 *   - `fused`: wander 0.25, white 0.15, 60 s (the framework's defaults, the
 *     aligned position).
 *   The rule reads the REPORTED accuracy, 0.5x, 1x or 2x the true one (a
 *   phone need not report its own error honestly).
 * - **A code:** a constant error per walk (its direction spread evenly over
 *   the seeds) of 0-2 m, plus white jitter of 0.05/0.25/0.5 m per position,
 *   at spacing 1-6 m, in all three layouts.
 * - **Where the visitor stands:** at the target's centre; and, as the
 *   sensitivity, anywhere within a quarter of half the spacing of it.
 * - **The rule's parameters:** the factor 0.5-4, the ceiling 10-50 m, and
 *   the goal (the share of right positions a "yes" must reach) 80/90/95 %.
 * - **The seeds:** a seed base shifts every seed; a re-run at 80 seeds with
 *   two other bases checks that the shipped verdict is not one draw's.
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

const DWELL_S = 180;
const SEEDS = 40;
const ROBUST_SEEDS = 80;
const ROBUST_SEED_BASES = [1_000_003, 2_000_029] as const;

/** The Tour Viewer's station-sweep noise shapes (mirrored: the framework
 *  cannot import the viewer). */
const NOISE = {
  raw: { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 },
  mid: { wanderFrac: 0.45, whiteFrac: 0.2, tauS: 20 },
  fused: { wanderFrac: 0.25, whiteFrac: 0.15, tauS: 60 },
} as const;
type Shape = keyof typeof NOISE;
const SHAPES = Object.keys(NOISE) as Shape[];

type P = readonly [number, number];

/** The target's first ring of neighbours, at a spacing of 1. */
const LAYOUT = {
  row: [
    [-1, 0],
    [1, 0],
  ],
  square: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
  hex: [0, 1, 2, 3, 4, 5].map((k): P => [
    Math.cos((k * Math.PI) / 3),
    Math.sin((k * Math.PI) / 3),
  ]),
} as const satisfies Record<string, readonly P[]>;
type Layout = keyof typeof LAYOUT;
const LAYOUTS = Object.keys(LAYOUT) as Layout[];

const ACCURACIES = [
  1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40,
] as const;
const SPACINGS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50] as const;
const RATIOS = [0.5, 1, 2] as const;
const FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4] as const;
const CEILINGS = [10, 15, 20, 25, 35, 50] as const;
const GOALS = [0.8, 0.9, 0.95] as const;

const CODE_DRIFTS = [0, 0.5, 1, 1.5, 2] as const;
const CODE_JITTERS = [0.05, 0.25, 0.5] as const;
const CODE_SPACINGS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6] as const;

/** Whether `o` (relative to the target) is nearer the target than every
 *  neighbour of `layout` at `spacing` (a tie counts as wrong). */
function nearestIsTarget(o: P, layout: Layout, spacing: number): boolean {
  const d0 = o[0] * o[0] + o[1] * o[1];
  for (const n of LAYOUT[layout]) {
    const dx = o[0] - n[0] * spacing;
    const dy = o[1] - n[1] * spacing;
    if (dx * dx + dy * dy <= d0) return false;
  }
  return true;
}

type Rights = Readonly<Record<Layout, number>>;

/** The share of right positions in each layout, over `seeds` error series
 *  of true accuracy `a`; the visitor stands within `spot` x half the
 *  spacing of the target. */
function gpsRight(
  shape: Shape,
  a: number,
  spacing: number,
  spot: number,
  seeds: number,
  seedBase: number
): Rights {
  const right = { row: 0, square: 0, hex: 0 };
  let n = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const rng = mulberry32(
      seedBase + seed * 104729 + Math.round(a * 1009 + spacing * 31)
    );
    const errors = gaussMarkovGpsErrors(rng, DWELL_S, a, NOISE[shape]);
    for (let t = 0; t < DWELL_S; t += 1) {
      const e = errors[t]!;
      let o: P = e;
      if (spot > 0) {
        const ang = rng() * 2 * Math.PI;
        const r = Math.sqrt(rng()) * spot * (spacing / 2);
        o = [e[0] + r * Math.cos(ang), e[1] + r * Math.sin(ang)];
      }
      for (const layout of LAYOUTS) {
        if (nearestIsTarget(o, layout, spacing)) right[layout] += 1;
      }
      n += 1;
    }
  }
  return { row: right.row / n, square: right.square / n, hex: right.hex / n };
}

/** The same under a code-held position: a constant error `drift` per walk
 *  (directions spread evenly over the seeds) plus white jitter. */
function codeRight(drift: number, jitter: number, spacing: number): Rights {
  const right = { row: 0, square: 0, hex: 0 };
  let n = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const rng = mulberry32(
      seed * 7919 + Math.round(drift * 101 + jitter * 1000 + spacing * 13)
    );
    const dir = (2 * Math.PI * seed) / SEEDS;
    for (let t = 0; t < DWELL_S; t += 1) {
      const o: P = [
        drift * Math.cos(dir) + jitter * gaussian(rng),
        drift * Math.sin(dir) + jitter * gaussian(rng),
      ];
      for (const layout of LAYOUTS) {
        if (nearestIsTarget(o, layout, spacing)) right[layout] += 1;
      }
      n += 1;
    }
  }
  return { row: right.row / n, square: right.square / n, hex: right.hex / n };
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
  readonly right: Rights;
}
interface CodeCell {
  readonly drift: number;
  readonly jitter: number;
  readonly spacing: number;
  readonly right: Rights;
}

const gpsCache = new Map<string, GpsCell[]>();

/** Every (accuracy, spacing) cell of one noise shape, spot and seed set. */
function gpsCells(
  shape: Shape,
  spot = 0,
  seeds = SEEDS,
  seedBase = 0
): GpsCell[] {
  const key = `${shape} ${String(spot)} ${String(seeds)} ${String(seedBase)}`;
  const cached = gpsCache.get(key);
  if (cached !== undefined) return cached;
  const cells: GpsCell[] = [];
  for (const a of ACCURACIES) {
    for (const spacing of SPACINGS) {
      const right = gpsRight(shape, a, spacing, spot, seeds, seedBase);
      cells.push({ a, spacing, right });
      table.push(
        `gps ${key} acc ${String(a)} spacing ${String(spacing)}: ${LAYOUTS.map((l) => `${l} ${pct(right[l])}`).join(', ')}`
      );
    }
  }
  gpsCache.set(key, cells);
  return cells;
}

let codeCache: CodeCell[] | undefined;
function codeCells(): CodeCell[] {
  if (codeCache !== undefined) return codeCache;
  codeCache = [];
  for (const drift of CODE_DRIFTS) {
    for (const jitter of CODE_JITTERS) {
      for (const spacing of CODE_SPACINGS) {
        const right = codeRight(drift, jitter, spacing);
        codeCache.push({ drift, jitter, spacing, right });
        table.push(
          `code drift ${String(drift)} jitter ${String(jitter)} spacing ${String(spacing)}: ${LAYOUTS.map((l) => `${l} ${pct(right[l])}`).join(', ')}`
        );
      }
    }
  }
  return codeCache;
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

/** How a rule (factor, ceiling) fares on a set of GPS cells in one layout,
 *  at one reported ratio and goal. */
interface Verdict {
  /** "Yes" where fewer than `goal` of the positions are right. */
  readonly unsafeYes: number;
  /** "No" where at least `goal` are right. */
  readonly needlessNo: number;
  readonly yes: number;
  /** The lowest right share among the "yes" cells (1 with none). */
  readonly worstYes: number;
}

interface Rule {
  readonly factor: number;
  readonly ceilingM?: number;
  readonly ratio?: number;
  readonly goal?: number;
}

function judge(cells: readonly GpsCell[], layout: Layout, rule: Rule): Verdict {
  const ceilingM = rule.ceilingM ?? POSITION_PRECISION_CEILING_M;
  const ratio = rule.ratio ?? 1;
  const goal = rule.goal ?? 0.9;
  let unsafeYes = 0;
  let needlessNo = 0;
  let yes = 0;
  let worstYes = 1;
  for (const c of cells) {
    const right = c.right[layout];
    const said = canTellApart(gpsPrecision(ratio * c.a, ceilingM), c.spacing, {
      factor: rule.factor,
    });
    if (said) {
      yes += 1;
      worstYes = Math.min(worstYes, right);
      if (right < goal) unsafeYes += 1;
    } else if (right >= goal) {
      needlessNo += 1;
    }
  }
  return { unsafeYes, needlessNo, yes, worstYes };
}

/** The smallest swept factor whose every "yes" reaches the goal in one
 *  layout (null: none swept does). */
function smallestSafeFactor(
  cells: readonly GpsCell[],
  layout: Layout,
  rule: Omit<Rule, 'factor'> = {}
): number | null {
  for (const factor of FACTORS) {
    if (judge(cells, layout, { ...rule, factor }).unsafeYes === 0) {
      return factor;
    }
  }
  return null;
}

/** The smallest swept factor safe in every layout. */
function safeInEveryLayout(
  cells: readonly GpsCell[],
  rule: Omit<Rule, 'factor'> = {}
): number | null {
  let worst = 0;
  for (const layout of LAYOUTS) {
    const f = smallestSafeFactor(cells, layout, rule);
    if (f === null) return null;
    worst = Math.max(worst, f);
  }
  return worst;
}

/** The smallest safe factor per layout, as `{ row, square, hex }`. */
function perLayout(
  cells: readonly GpsCell[],
  rule: Omit<Rule, 'factor'> = {}
): Record<Layout, number | null> {
  return {
    row: smallestSafeFactor(cells, 'row', rule),
    square: smallestSafeFactor(cells, 'square', rule),
    hex: smallestSafeFactor(cells, 'hex', rule),
  };
}

function summary(
  label: string,
  cells: readonly GpsCell[],
  layout: Layout,
  rule: Rule
): void {
  const v = judge(cells, layout, rule);
  table.push(
    `SUMMARY ${label} ${layout} factor ${String(rule.factor)} ceiling ${String(rule.ceilingM ?? POSITION_PRECISION_CEILING_M)} ratio ${String(rule.ratio ?? 1)} goal ${pct(rule.goal ?? 0.9)}: yes ${String(v.yes)}, unsafe yes ${String(v.unsafeYes)}, needless no ${String(v.needlessNo)}, worst yes ${pct(v.worstYes)}`
  );
}

describe(
  'position precision sweep (canTellApart)',
  { timeout: 120_000 },
  () => {
    afterAll(() => {
      if (OUT !== undefined) writeFileSync(OUT, table.join('\n') + '\n');
    });

    // Why this test matters: it is the evidence for the shipped factor. A
    // row of targets understates the risk: an inner target there has two
    // neighbours at the spacing, one in a square grid four and in a hex grid
    // six. On an honest raw-fix report the factor is the smallest whose
    // every "yes" picks the right target at least 90 % of the time in ALL
    // three layouts; the row alone would have allowed less.
    it('honest report: the shipped factor is the smallest safe at a 90 % goal in a row, a square and a hex grid', () => {
      const cells = gpsCells('raw');
      for (const goal of GOALS) {
        for (const layout of LAYOUTS) {
          for (const factor of FACTORS) {
            summary('honest', cells, layout, { factor, goal });
          }
        }
        table.push(
          `SUMMARY smallest safe, raw, goal ${pct(goal)}: ${JSON.stringify(perLayout(cells, { goal }))}`
        );
      }
      expect(perLayout(cells, { goal: 0.9 })).toEqual({
        row: 1.25,
        square: 1.5,
        hex: 1.5,
      });
      expect(safeInEveryLayout(cells, { goal: 0.9 })).toBe(TELL_APART_FACTOR);
      expect(TELL_APART_FACTOR).toBe(1.5);
      // The goal is a parameter; these are the values it would take.
      expect(perLayout(cells, { goal: 0.8 })).toEqual({
        row: 1,
        square: 1.25,
        hex: 1.25,
      });
      expect(perLayout(cells, { goal: 0.95 })).toEqual({
        row: 1.5,
        square: 1.75,
        hex: 1.75,
      });
      // The rule says yes somewhere, so the zeros above are not vacuous.
      for (const layout of LAYOUTS) {
        expect(
          judge(cells, layout, { factor: TELL_APART_FACTOR }).yes
        ).toBeGreaterThan(20);
      }
    });

    // Why this test matters: the factor is set on the noisiest shape (a raw
    // fix read as a 68 % radius). A smoother error at the same reported
    // accuracy - the aligned position - must never make the shipped factor
    // unsafe; it only makes it more cautious than it needs to be.
    it('every noise shape (raw, mid, fused) is safe at the shipped factor in every layout', () => {
      for (const shape of SHAPES) {
        const cells = gpsCells(shape);
        for (const goal of GOALS) {
          table.push(
            `SUMMARY smallest safe, ${shape}, goal ${pct(goal)}: ${JSON.stringify(perLayout(cells, { goal }))}`
          );
        }
        for (const layout of LAYOUTS) {
          summary(`shape ${shape}`, cells, layout, {
            factor: TELL_APART_FACTOR,
          });
          expect(
            judge(cells, layout, { factor: TELL_APART_FACTOR }).unsafeYes
          ).toBe(0);
        }
      }
      expect(safeInEveryLayout(gpsCells('mid'), { goal: 0.9 })).toBe(1.25);
      expect(safeInEveryLayout(gpsCells('fused'), { goal: 0.9 })).toBe(0.75);
    });

    // Why this test matters: the rule reads what the phone REPORTS. A phone
    // that reports half its true error makes the shipped factor say yes
    // where it should not; one that reports double makes it refuse more than
    // it must. This pins how far the verdict moves with an honest-report
    // assumption.
    it('a report of half the error needs 3; one of double would be safe at 0.75', () => {
      const cells = gpsCells('raw');
      for (const ratio of RATIOS) {
        for (const layout of LAYOUTS) {
          for (const factor of FACTORS) {
            summary('ratio', cells, layout, { factor, ratio });
          }
        }
      }
      for (const layout of LAYOUTS) {
        expect(
          judge(cells, layout, { factor: TELL_APART_FACTOR, ratio: 0.5 })
            .unsafeYes
        ).toBeGreaterThan(0);
      }
      expect(perLayout(cells, { ratio: 0.5 })).toEqual({
        row: 2.5,
        square: 3,
        hex: 3,
      });
      expect(safeInEveryLayout(cells, { ratio: 2 })).toBe(0.75);
    });

    // Why this test matters: a visitor does not stand on a target's exact
    // centre. Standing anywhere within a quarter of half the spacing of it
    // must not make the shipped factor unsafe in any layout.
    it('standing off-centre (a quarter of half the spacing) keeps the shipped factor safe in every layout', () => {
      const cells = gpsCells('raw', 0.25);
      for (const layout of LAYOUTS) {
        summary('spot 0.25', cells, layout, { factor: TELL_APART_FACTOR });
        expect(
          judge(cells, layout, { factor: TELL_APART_FACTOR }).unsafeYes
        ).toBe(0);
      }
    });

    // Why this test matters: the shipped verdict must not be one draw's. Two
    // other seed sets at twice the seeds must give every layout the same
    // smallest safe factor at the 90 % goal.
    it('two other seed sets at 80 seeds give every layout the same smallest safe factor', () => {
      const base = perLayout(gpsCells('raw'));
      for (const seedBase of ROBUST_SEED_BASES) {
        const cells = gpsCells('raw', 0, ROBUST_SEEDS, seedBase);
        for (const layout of LAYOUTS) {
          summary(`seeds ${String(seedBase)}`, cells, layout, {
            factor: TELL_APART_FACTOR,
          });
        }
        expect(perLayout(cells)).toEqual(base);
      }
    });

    // Why this test matters: the ceiling only ever turns a yes into a no,
    // so it can never make the rule unsafe; it only costs needless no's.
    // Within 3-50 m of spacing the shipped factor already refuses every
    // accuracy above 50 / (2 x 1.5) = 16.7 m, so a ceiling of 15 m or more
    // changes no verdict; 10 m would refuse wide-spaced targets the rule
    // could tell apart.
    it('the ceiling never adds an unsafe yes, and at 15 m or more changes no verdict at the shipped factor', () => {
      const cells = gpsCells('raw');
      for (const layout of LAYOUTS) {
        const base = judge(cells, layout, { factor: TELL_APART_FACTOR });
        const at = (ceilingM: number) =>
          judge(cells, layout, { factor: TELL_APART_FACTOR, ceilingM });
        for (const c of CEILINGS) {
          summary('ceiling', cells, layout, {
            factor: TELL_APART_FACTOR,
            ceilingM: c,
          });
          expect(at(c).unsafeYes).toBe(0);
        }
        for (const c of CEILINGS.filter((c) => c >= 15)) {
          expect(at(c)).toEqual(base);
        }
        expect(at(10).needlessNo).toBeGreaterThan(base.needlessNo);
      }
    });

    // Why this test matters: a code-held position has no measured number,
    // so the rule judges it by a fixed length. At 1.5 x 1 m it says yes
    // from 3 m of spacing. Measured at that factor, in every layout, it is
    // safe while the code-held error stays at 1 m or less with up to
    // 0.25 m of jitter; a constant error of 1.5 m or more reverses it.
    it('a code: 1 m is safe at a 90 % goal up to 1 m of error and 0.25 m of jitter in every layout; 1.5 m of error reverses it', () => {
      const cells = codeCells();
      const yes = (c: CodeCell) => canTellApart(CODE, c.spacing);
      expect(CODE_HELD_ERROR_M).toBe(1);
      expect(cells.filter(yes).length).toBeGreaterThan(0);
      for (const layout of LAYOUTS) {
        const unsafe = (keep: (c: CodeCell) => boolean) =>
          cells.filter((c) => keep(c) && yes(c) && c.right[layout] < 0.9);
        for (const c of unsafe(() => true)) {
          table.push(
            `CODE unsafe yes ${layout}: drift ${String(c.drift)} jitter ${String(c.jitter)} spacing ${String(c.spacing)} right ${pct(c.right[layout])}`
          );
        }
        expect(unsafe((c) => c.drift <= 1 && c.jitter <= 0.25)).toEqual([]);
        expect(unsafe((c) => c.drift >= 1.5).length).toBeGreaterThan(0);
      }
    });
  }
);
