/**
 * QR decode + pose parameter sweep through a REAL decoder (opt-in, not a gate).
 *
 * Run with `QR_SWEEP=1`:
 *   $env:QR_SWEEP='1'; pnpm run test:unit src/ar/qr/qr-zxing.sweep.test.ts --disable-console-intercept
 *
 * Why this exists: every other QR test injects the detector, so nothing in the
 * suite had ever decoded an image. This renders a real symbol at known poses
 * (`synthetic-qr-frame.ts`), decodes it with zxing-wasm (an independent
 * implementation, `zxing-node.ts`), and drives the corners through the
 * production pose pipeline (`solveQrPose` + `PlanarPnpSquare` +
 * `intrinsicsFromProjection`). It reports, across the whole parameter range
 * (owner rule 2026-09-13: a one-value verdict is provisional):
 * - where decoding stops working (distance / tilt / capture size / blur / noise),
 * - corner error vs truth, including its SIGNED bias per axis,
 * - pose error, and the fraction of frames inside each candidate tolerance,
 * - zxing decode time on this machine per capture size (a laptop, not a phone).
 * The gate tests in `qr-zxing-oracle.test.ts` take their tolerances from here.
 * Results: GpsPlusSlamJs_Docs/docs/2026-09-23-0104-qr-zxing-synthetic-sweep-findings.md.
 */

import { describe, expect, it } from 'vitest';
import {
  perspectiveProjection,
  qrPoseFacingCamera,
  renderQrFrame,
} from '../../test-utils/synthetic-qr-frame';
import { readQrCodes } from '../../test-utils/zxing-node';
import { canonicalizeCorners } from './qr-corner-order';
import {
  measureWalk,
  type WalkRow,
} from '../../test-utils/qr-walk-measurement';
import type { WalkKind } from '../../test-utils/synthetic-qr-walk';
import {
  measureZxingPipeline,
  type PipelineMeasurement,
} from '../../test-utils/qr-zxing-pipeline';

const RUN = process.env.QR_SWEEP === '1';
/** Opt-in measurement, minutes long by design; the gate's 30 s ceiling does not apply. */
const SWEEP_TIMEOUT_MS = 900_000;

/** A launch URL of realistic length: QR version 5-8 at level Q, like real prints. */
const PAYLOAD =
  'https://gps-plus-slam.csutil.workers.dev/tour/?t=S/k7Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq';
/** About the largest code that fits on A4 with the quiet zone. */
const SIZE_M = 0.16;
const CAPTURES = [
  // One image model at every size (2x2 supersampling), so a threshold that
  // differs by size is the size, not the anti-aliasing (review finding 8).
  { width: 512, height: 384, supersample: 2 },
  { width: 1024, height: 768, supersample: 2 },
  { width: 2048, height: 1536, supersample: 2 },
] as const;
const FOV_Y_DEG = 50;

function pct(n: number, d: number): string {
  return d === 0 ? '-' : `${Math.round((100 * n) / d)}%`;
}

function summarize(label: string, rows: PipelineMeasurement[]): string {
  const decoded = rows.filter((r) => r.decoded);
  const solved = decoded.filter((r) => r.rotationErrDeg !== null);
  const corner = decoded.map((r) => r.maxCornerErrPx ?? Infinity);
  const rot = solved.map((r) => r.rotationErrDeg ?? Infinity);
  const pos = solved.map((r) => r.positionErrCm ?? Infinity);
  const mean = (xs: number[]): number =>
    xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const within = (xs: number[], t: number): string =>
    pct(xs.filter((x) => x <= t).length, decoded.length);
  return [
    label.padEnd(34),
    `decoded ${pct(decoded.length, rows.length).padStart(4)}`,
    `solved ${pct(solved.length, decoded.length).padStart(4)}`,
    `corner<=0.5/1/1.5/2px ${[0.5, 1, 1.5, 2].map((t) => within(corner, t)).join('/')}`,
    `rot<=0.5/1/2deg ${[0.5, 1, 2].map((t) => within(rot, t)).join('/')}`,
    `maxRot ${rot.length ? Math.max(...rot).toFixed(2) : '-'}`,
    `maxPos ${pos.length ? Math.max(...pos).toFixed(1) : '-'}cm`,
    `bias x ${mean(decoded.map((r) => r.meanSignedErrX ?? 0)).toFixed(2)} y ${mean(decoded.map((r) => r.meanSignedErrY ?? 0)).toFixed(2)}px`,
    `decode ${mean(rows.map((r) => r.decodeMs)).toFixed(1)}ms`,
  ].join(' | ');
}

interface SweepCase {
  cap: (typeof CAPTURES)[number];
  distanceM: number;
  tiltXDeg: number;
  rollDeg: number;
  blurRadiusPx?: number;
  noiseSigma: number;
  seed: number;
}

/** Render one case and measure it; `modulePx` is this frame's module size. */
async function measureCase(
  c: SweepCase
): Promise<PipelineMeasurement & { modulePx: number }> {
  const projection = perspectiveProjection({
    fovYDeg: FOV_Y_DEG,
    aspect: c.cap.width / c.cap.height,
  });
  const qrPoseInCamera = qrPoseFacingCamera({
    distanceM: c.distanceM,
    tiltXDeg: c.tiltXDeg,
    rollDeg: c.rollDeg,
  });
  const frame = renderQrFrame({
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera,
    projection,
    width: c.cap.width,
    height: c.cap.height,
    supersample: c.cap.supersample,
    blurRadiusPx: c.blurRadiusPx ?? 0,
    noiseSigma: c.noiseSigma,
    seed: c.seed,
  });
  const m = await measureZxingPipeline(frame, {
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera,
    projection,
  });
  return { ...m, modulePx: frame.modulePx };
}

async function measureAll(
  cases: SweepCase[]
): Promise<(PipelineMeasurement & { modulePx: number })[]> {
  const rows = [];
  for (const c of cases) rows.push(await measureCase(c));
  return rows;
}

type BinnedRow = PipelineMeasurement & {
  modulePx: number;
  cap: number;
  tiltXDeg: number;
};

/** Upper bounds of the px/module bins (the last bin is open-ended). */
const MODULE_PX_BINS = [1.5, 2, 2.5, 3, 3.5, 4, 5, 7, Infinity];

/**
 * Re-bin every geometry frame by its OWN module size: a tilted frame at a
 * given distance has fewer px/module than the frontal pose that labels its
 * distance row (review finding 8). Pooled over capture sizes, then per size.
 */
function byModulePx(rows: BinnedRow[]): string[] {
  const lines: string[] = [];
  const scopes = [0, ...CAPTURES.map((c) => c.width)];
  for (const cap of scopes) {
    const pool = cap === 0 ? rows : rows.filter((r) => r.cap === cap);
    const scope = cap === 0 ? 'all sizes' : `${cap}px`;
    let lo = 0;
    for (const hi of MODULE_PX_BINS) {
      const bin = pool.filter((r) => r.modulePx >= lo && r.modulePx < hi);
      const range = `${lo}-${Number.isFinite(hi) ? hi : 'inf'}`;
      if (bin.length > 0) {
        lines.push(summarize(`${scope} ${range}px/mod n${bin.length}`, bin));
      }
      lo = hi;
    }
  }
  return lines;
}

interface CornerOrderCase {
  cap: { width: number; height: number; fovYDeg: number };
  distanceM: number;
  tilt: { tiltXDeg?: number; tiltYDeg?: number };
  rollDeg: number;
  blurRadiusPx: number;
  noiseSigma: number;
  /** Largest corner error per axis, px, before rounding (the phone: ~2). */
  cornerErrPx: number;
  seed: number;
}

function cornerOrderCases(): CornerOrderCase[] {
  const caps = [
    { width: 439, height: 1024, fovYDeg: 64 },
    { width: 1024, height: 768, fovYDeg: 50 },
  ];
  const tilts = [
    { tiltXDeg: 0 },
    { tiltXDeg: 30 },
    { tiltXDeg: 55 },
    { tiltYDeg: 40 },
  ];
  const geometry = caps.flatMap((cap) =>
    [0.3, 0.6, 1, 1.5, 2, 3].flatMap((distanceM) =>
      tilts.flatMap((tilt) =>
        [0, 37, 180, 270].map((rollDeg) => ({ cap, distanceM, tilt, rollDeg }))
      )
    )
  );
  const imaging = [0, 1].flatMap((blurRadiusPx) =>
    [1, 2, 3].map((cornerErrPx) => ({
      blurRadiusPx,
      noiseSigma: 2,
      cornerErrPx,
    }))
  );
  return geometry
    .flatMap((g) => imaging.map((i) => ({ ...g, ...i })))
    .map((c, k) => ({ ...c, seed: k + 2 }));
}

function moduleBand(m: number): string {
  if (m < 2) return '<2';
  if (m < 3) return '2-3';
  if (m < 4) return '3-4';
  return m < 6 ? '4-6' : '6+';
}

/** One frame: emulated image-ordered corners through `canonicalizeCorners`. */
function measureCornerOrder(c: CornerOrderCase): {
  key: string;
  confident: boolean;
  correct: boolean;
} {
  const frame = renderQrFrame({
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera: qrPoseFacingCamera({
      distanceM: c.distanceM,
      rollDeg: c.rollDeg,
      ...c.tilt,
    }),
    projection: perspectiveProjection({
      fovYDeg: c.cap.fovYDeg,
      aspect: c.cap.width / c.cap.height,
    }),
    width: c.cap.width,
    height: c.cap.height,
    supersample: 2,
    blurRadiusPx: c.blurRadiusPx,
    noiseSigma: c.noiseSigma,
    seed: c.seed,
  });
  const span = 2 * c.cornerErrPx + 1;
  const nudge = (k: number) => ((c.seed * (k + 3) * 7) % span) - c.cornerErrPx;
  const truth = frame.truthCorners.map((p, k) => ({
    x: Math.round(p.x + nudge(k)),
    y: Math.round(p.y + nudge(k + 1)),
  }));
  let start = 0;
  truth.forEach((p, i) => {
    if (p.x + p.y < truth[start]!.x + truth[start]!.y) start = i;
  });
  const reported = [0, 1, 2, 3].map((k) => truth[(start + k) % 4]!);
  const out = canonicalizeCorners(frame.image, reported);
  const correct = out.corners.every(
    (p, i) => p.x === truth[i]!.x && p.y === truth[i]!.y
  );
  return {
    key: `err ${c.cornerErrPx}px ${moduleBand(frame.modulePx).padEnd(3)} px/mod blur ${c.blurRadiusPx}`,
    confident: out.confident,
    correct,
  };
}

const WALL_CODE = {
  position: [0, 1.5, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

/** The fixed walk set of the plan's done bar, at three distances, two seeds. */
function walkCases() {
  const shapes: { kind: WalkKind; extent: number }[] = [
    { kind: 'sidestep', extent: 0.3 },
    { kind: 'sidestep', extent: 0.6 },
    { kind: 'arc', extent: 20 },
    { kind: 'arc', extent: 40 },
    { kind: 'approach', extent: 1 },
    { kind: 'still', extent: 0 },
  ];
  return shapes.flatMap((s) =>
    [1, 1.5, 2].flatMap((distanceM) =>
      [1, 2].map((seed) => ({
        ...s,
        codeWorld: WALL_CODE,
        distanceM,
        steps: 12,
        noiseSigma: 2,
        seed,
      }))
    )
  );
}

function stats(xs: number[]): string {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return '-';
  const at = (p: number) =>
    v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  return `${at(0.5).toFixed(1)}/${at(0.95).toFixed(1)}/${v[v.length - 1]!.toFixed(1)}`;
}

/** p50/p95/max per method, binned by the obliqueness the window reached (>= 5 obs). */
function walkReport(rows: readonly WalkRow[]): string[] {
  const bands = [0, 5, 10, 15, 20, 90];
  const lines = [
    'reached deg | n | raw | stable | fixedT | freeT | shared6 (p50/p95/max deg)',
  ];
  for (let i = 0; i < bands.length - 1; i++) {
    const [lo, hi] = [bands[i]!, bands[i + 1]!];
    const r = rows.filter(
      (x) => x.window >= 5 && x.reachedDeg >= lo && x.reachedDeg < hi
    );
    if (r.length === 0) continue;
    lines.push(
      [
        `${lo}-${hi}`.padEnd(11),
        String(r.length).padStart(3),
        stats(r.map((x) => x.errRawDeg)),
        stats(r.map((x) => x.errStableDeg)),
        stats(r.map((x) => x.errFusedDeg.rotSharedFixedT ?? Number.NaN)),
        stats(r.map((x) => x.errFusedDeg.rotSharedFreeT ?? Number.NaN)),
        stats(r.map((x) => x.errFusedDeg.shared6 ?? Number.NaN)),
      ].join(' | ')
    );
  }
  return lines;
}

describe.runIf(RUN)('QR zxing sweep (opt-in, QR_SWEEP=1)', () => {
  it(
    'geometry: distance x tilt x roll x capture size',
    async () => {
      const lines: string[] = [];
      const all: BinnedRow[] = [];
      const groups = CAPTURES.flatMap((cap) =>
        [0.3, 0.6, 1, 1.5, 2, 3].map((distanceM) => ({ cap, distanceM }))
      );
      for (const { cap, distanceM } of groups) {
        const cases = [0, 20, 40, 60].flatMap((tiltXDeg) =>
          [0, 37, 90, 180, 270].map((rollDeg) => ({
            cap,
            distanceM,
            tiltXDeg,
            rollDeg,
            noiseSigma: 2,
            seed: Math.round(distanceM * 1000 + tiltXDeg * 10 + rollDeg),
          }))
        );
        const rows = await measureAll(cases);
        all.push(
          ...rows.map((r, k) => ({
            ...r,
            cap: cap.width,
            tiltXDeg: cases[k]!.tiltXDeg,
          }))
        );
        // The first case is frontal (tilt 0, roll 0): its module size labels the row.
        const modulePx = rows[0]?.modulePx ?? NaN;
        lines.push(
          summarize(
            `${cap.width}px d=${distanceM}m (${modulePx.toFixed(1)}px/mod)`,
            rows
          )
        );
      }
      console.log(
        `\nGEOMETRY SWEEP (size ${SIZE_M} m, fovY ${FOV_Y_DEG} deg, noise 2)\n${lines.join('\n')}`
      );
      console.log(
        `\nBY EACH FRAME'S OWN px/module (shortest projected edge / modules)\n${byModulePx(all).join('\n')}`
      );
      // Does the pose error at small codes follow the tilt (planar two-fold
      // ambiguity near fronto-parallel, "Cause B") rather than px/module?
      const small = all.filter((r) => r.modulePx < 4);
      const byTilt = [0, 20, 40, 60].map((tilt) =>
        summarize(
          `<4 px/mod tilt ${tilt} n${small.filter((r) => r.tiltXDeg === tilt).length}`,
          small.filter((r) => r.tiltXDeg === tilt)
        )
      );
      console.log(`\nSMALL CODES (<4 px/module) BY TILT\n${byTilt.join('\n')}`);
      expect(lines.length).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT_MS
  );

  it(
    'degradation: blur x noise at a tilted, rolled pose',
    async () => {
      const lines: string[] = [];
      const cap = CAPTURES[1];
      const groups = [1, 2, 3].flatMap((distanceM) =>
        [0, 1, 2].map((blurRadiusPx) => ({ distanceM, blurRadiusPx }))
      );
      for (const { distanceM, blurRadiusPx } of groups) {
        const cases = [0, 4, 8].flatMap((noiseSigma) =>
          [1, 2, 3].map((seed) => ({
            cap,
            distanceM,
            tiltXDeg: 30,
            rollDeg: 37,
            blurRadiusPx,
            noiseSigma,
            seed,
          }))
        );
        lines.push(
          summarize(
            `1024px d=${distanceM}m blur=${blurRadiusPx}`,
            await measureAll(cases)
          )
        );
      }
      console.log(
        `\nDEGRADATION SWEEP (tilt 30, roll 37, noise 0/4/8 x 3 seeds)\n${lines.join('\n')}`
      );
      expect(lines.length).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT_MS
  );

  it(
    'decode time: no code in frame, default vs fast options, per capture size',
    async () => {
      const lines: string[] = [];
      const optionSets = [
        ['default', {}],
        [
          'fast',
          {
            tryHarder: false,
            tryRotate: false,
            tryInvert: false,
            tryDownscale: false,
            maxNumberOfSymbols: 1,
          },
        ],
      ] as const;
      const runs = CAPTURES.flatMap((cap) =>
        optionSets.map(([name, options]) => ({ cap, name, options }))
      );
      for (const { cap, name, options } of runs) {
        const blank = {
          data: new Uint8ClampedArray(cap.width * cap.height * 4).fill(128),
          width: cap.width,
          height: cap.height,
        };
        const times: number[] = [];
        for (let k = 0; k < 7; k++) {
          const t0 = performance.now();
          await readQrCodes(blank, options);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        lines.push(
          `${cap.width}px ${name.padEnd(7)} median ${times[3]!.toFixed(1)} ms`
        );
      }
      console.log(
        `\nEMPTY-FRAME DECODE TIME (this machine)\n${lines.join('\n')}`
      );
      expect(lines.length).toBe(CAPTURES.length * 2);
    },
    SWEEP_TIMEOUT_MS
  );

  it(
    'corner order from the finder patterns (plan 2026-09-23-2314, M1c)',
    () => {
      // The detector's corners are emulated: the true corners, nudged by up to
      // 1 px and rounded (the phone reports whole pixels ~2 px from zxing's),
      // then handed over in IMAGE order. A wrong CONFIDENT answer is the
      // failure that matters; unsure frames keep today's behaviour.
      const bins = new Map<
        string,
        { n: number; confident: number; wrong: number }
      >();
      for (const c of cornerOrderCases()) {
        const r = measureCornerOrder(c);
        const b = bins.get(r.key) ?? { n: 0, confident: 0, wrong: 0 };
        b.n++;
        if (r.confident) b.confident++;
        if (r.confident && !r.correct) b.wrong++;
        bins.set(r.key, b);
      }
      const lines = [...bins]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([k, b]) =>
            `${k} | n ${String(b.n).padStart(3)} | confident ${pct(b.confident, b.n).padStart(4)} | WRONG confident ${b.wrong}`
        );
      console.log(
        `\nCORNER ORDER (finder patterns; noise 2, corner error 1/2/3 px, rolls 0/37/180/270, 4 tilts)\n${lines.join('\n')}`
      );
      expect(bins.size).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT_MS
  );

  it(
    'walks: today vs the multi-view prototype (plan 2026-09-23-2314, M0)',
    async () => {
      // SLAM error on the poses the solvers see: none, then two levels (the
      // variant ranking hinges on it, plan §8).
      const levels = [
        undefined,
        { rotationDeg: 0.2, translationM: 0.005 },
        { rotationDeg: 0.5, translationM: 0.01 },
      ];
      const reports: string[] = [];
      let total = 0;
      for (const slamNoise of levels) {
        const rows: WalkRow[] = [];
        for (const w of walkCases()) {
          rows.push(
            ...(await measureWalk({
              ...w,
              ...(slamNoise ? { slamNoise } : {}),
            }))
          );
        }
        total += rows.length;
        reports.push(
          slamNoise
            ? `SLAM noise ${slamNoise.rotationDeg} deg / ${slamNoise.translationM * 1000} mm`
            : 'exact SLAM',
          ...walkReport(rows)
        );
      }
      console.log(
        `\nWALKS (phone 439x1024, wall code 16 cm)\n${reports.join('\n')}`
      );
      expect(total).toBeGreaterThan(0);
    },
    4 * SWEEP_TIMEOUT_MS // three SLAM-noise levels over the whole walk set
  );
});
