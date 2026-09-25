/**
 * The chained corner-order memory across its parameters (opt-in, not a
 * gate; QR near-frontal pose plan 2026-09-23-2314, §42).
 *
 * Run with `QR_SWEEP=1`:
 *   $env:QR_SWEEP='1'; pnpm run test:unit src/ar/qr/qr-corner-order.sweep.test.ts --disable-console-intercept
 *
 * Why this exists: the chain's defaults (a 30 deg roll limit, a 500 ms max
 * gap, a 1.5-edge jump limit) were set by reasoning; the owner rule asks for
 * the verdict across the plausible range. No images are needed: the
 * single-frame orderer is injected - confident on a random share of frames
 * (the phone's finder share was 60-65 %), else unsure in image order - and
 * the code moves, rolls and jitters in the image at a detection rate.
 * Reported per cell: frames the chain got WRONG (the flips it would
 * create), frames left in the native order (the flips it failed to
 * prevent: wrong whenever the image roll is past 45 deg), and the audit's
 * agree / disagree / reject counts.
 */

import { describe, expect, it } from 'vitest';
import type { Point2 } from './qr-pose';
import type { RgbaImage } from './qr-frontend';
import { createCornerOrderCanonicalizer } from './qr-corner-order';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';

const RUN = process.env.QR_SWEEP === '1';
type Quad = [Point2, Point2, Point2, Point2];

function quadAt(
  cx: number,
  cy: number,
  edge: number,
  rollDeg: number,
  jitter: () => number
): Quad {
  const h = edge / 2;
  const r = (rollDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (
    [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ] as const
  ).map(([x, y]) => ({
    x: cx + c * x - s * y + jitter(),
    y: cy + s * x + c * y + jitter(),
  })) as Quad;
}

/** What an image-ordered detector returns: start at the top-left-most corner. */
function imageOrder(truth: readonly Point2[]): Quad {
  let start = 0;
  truth.forEach((p, i) => {
    if (p.x + p.y < truth[start]!.x + truth[start]!.y) start = i;
  });
  return [0, 1, 2, 3].map((k) => truth[(start + k) % 4]!) as Quad;
}

const same = (a: readonly Point2[], b: readonly Point2[]) =>
  a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y);

interface Cell {
  rollDegPerS: number;
  rateHz: number;
  finderShare: number;
  jitterPx: number;
  gapEvery: number;
  maxRollDeg: number;
  memoryMs: number;
}

/** One 60 s run; counts per frame. */
function run(cell: Cell, seed: number) {
  const rand = mulberry32(seed);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
    Math.cos(2 * Math.PI * rand());
  let t = 0;
  let confident: Quad | null = null;
  const c = createCornerOrderCanonicalizer({
    now: () => t,
    memoryMs: cell.memoryMs,
    maxRollDeg: cell.maxRollDeg,
    orderFrame: (_image, corners) =>
      confident
        ? { corners: confident, confident: true, source: 'finder' }
        : { corners: [...corners] as Quad, confident: false, source: 'native' },
  });
  const image: RgbaImage = {
    data: new Uint8ClampedArray(4),
    width: 1024,
    height: 768,
  };
  const counts = {
    frames: 0,
    wrong: 0,
    nativeWrong: 0,
    agree: 0,
    disagree: 0,
    reject: 0,
  };
  const dt = 1000 / cell.rateHz;
  let roll = 20;
  for (let i = 0; i < 60 * cell.rateHz; i++) {
    t += dt;
    // An occasional gap: the code out of view for 0.5-3 s.
    if (cell.gapEvery > 0 && rand() < 1 / cell.gapEvery)
      t += 500 + 2500 * rand();
    roll += (cell.rollDegPerS * dt) / 1000;
    const truth = quadAt(
      512 + 150 * Math.sin(i / 20),
      384 + 80 * Math.cos(i / 31),
      150,
      roll,
      () => cell.jitterPx * gauss()
    );
    confident = rand() < cell.finderShare ? truth : null;
    const out = c.canonicalize('code', image, imageOrder(truth));
    counts.frames += 1;
    if (!same(out.corners, truth)) {
      if (out.source === 'memory') counts.wrong += 1;
      else counts.nativeWrong += 1;
    }
    if (out.audit) counts[out.audit] += 1;
  }
  return counts;
}

type Totals = ReturnType<typeof run>;

/** Five seeds of one cell, summed. */
function summed(cell: Cell): Totals {
  const total: Totals = {
    frames: 0,
    wrong: 0,
    nativeWrong: 0,
    agree: 0,
    disagree: 0,
    reject: 0,
  };
  for (let seed = 1; seed <= 5; seed++) {
    const r = run(cell, seed);
    for (const k of Object.keys(total) as (keyof Totals)[]) total[k] += r[k];
  }
  return total;
}

const BASE: Cell = {
  rollDegPerS: 20,
  rateHz: 5,
  finderShare: 0.6,
  jitterPx: 1,
  gapEvery: 0,
  maxRollDeg: 30,
  memoryMs: 500,
};

/** One factor at a time around BASE, then the two crossings that bite. */
function cells(): [Partial<Cell>, string][] {
  const out: [Partial<Cell>, string][] = [];
  const vary: [keyof Cell, number[]][] = [
    ['rollDegPerS', [0, 20, 60, 120, 180, 360]],
    ['rateHz', [3, 5, 7.5]],
    ['finderShare', [0.2, 0.4, 0.6, 0.8]],
    ['jitterPx', [0, 1, 5, 10, 20]],
    ['gapEvery', [0, 20, 5]],
    ['maxRollDeg', [15, 20, 30, 40]],
    ['memoryMs', [300, 500, 1000, 2000]],
  ];
  for (const [key, values] of vary)
    for (const v of values) out.push([{ [key]: v }, `${key}=${v}`]);
  for (const rollDegPerS of [60, 120, 180, 240, 360])
    for (const maxRollDeg of [20, 30, 40])
      out.push([
        { rollDegPerS, maxRollDeg },
        `roll ${rollDegPerS}/s x limit ${maxRollDeg}`,
      ]);
  for (const gapEvery of [20, 5])
    for (const memoryMs of [500, 1000, 2000, 4000])
      out.push([
        { gapEvery, memoryMs },
        `gaps 1/${gapEvery} x memory ${memoryMs} ms`,
      ]);
  return out;
}

describe.runIf(RUN)('QR corner-order chain sweep (opt-in, QR_SWEEP=1)', () => {
  it('reports wrong chained frames and native flips across the parameters', () => {
    const lines = cells().map(([over, label]) => {
      const t = summed({ ...BASE, ...over });
      return `${label}: frames ${t.frames} | chained WRONG ${t.wrong} | native wrong ${t.nativeWrong} | audit agree/disagree/reject ${t.agree}/${t.disagree}/${t.reject}`;
    });
    console.log(lines.join(String.fromCharCode(10)));
    expect(lines.length).toBeGreaterThan(0);
  });
});
