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
});
