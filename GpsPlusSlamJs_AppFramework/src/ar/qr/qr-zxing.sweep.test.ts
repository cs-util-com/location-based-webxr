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
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';
import { candidateStartsBySet } from '../../test-utils/qr-multiview-prototype';
import {
  intrinsicsFromProjection,
  solveQrPose,
  buildObjectPoints,
  reprojectionErrorPx,
  type Pose,
} from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import {
  rotationAngleDeg,
  zxingDetect,
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
    { kind: 'rise', extent: 0.4 },
    { kind: 'rise', extent: 0.8 },
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

/** A scored row with the walk it came from (for resampling whole walks). */
type TaggedRow = WalkRow & { walk: number; kind: WalkKind };

function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function stats(xs: number[]): string {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return '-';
  return `${quantile(v, 0.5).toFixed(1)}/${quantile(v, 0.95).toFixed(1)}/${v[v.length - 1]!.toFixed(1)}`;
}

/** Rows every method produced an estimate for (review finding 7). */
function sameFrames(rows: readonly TaggedRow[]): TaggedRow[] {
  return rows.filter(
    (x) =>
      x.window >= 5 &&
      [
        x.errRawDeg,
        x.errStableDeg,
        x.errProductionDeg,
        ...Object.values(x.errFusedDeg),
      ].every(Number.isFinite)
  );
}

const BANDS = [0, 5, 10, 15, 20, 90];

/**
 * A 90 % interval of a method's p95 by resampling whole WALKS (overlapping
 * windows of one walk are not independent; review finding 6).
 */
function p95Interval(
  rows: readonly TaggedRow[],
  pick: (r: TaggedRow) => number,
  seed: number
): string {
  const walks = [...new Set(rows.map((r) => r.walk))];
  if (walks.length < 2) return 'n/a';
  const rand = mulberry32(seed);
  const p95s: number[] = [];
  for (let b = 0; b < 300; b++) {
    const drawn = walks.map(() => walks[Math.floor(rand() * walks.length)]!);
    const vals = drawn
      .flatMap((w) => rows.filter((r) => r.walk === w).map(pick))
      .sort((a, c) => a - c);
    if (vals.length > 0) p95s.push(quantile(vals, 0.95));
  }
  p95s.sort((a, c) => a - c);
  return `[${quantile(p95s, 0.05).toFixed(1)}, ${quantile(p95s, 0.95).toFixed(1)}]`;
}

/** Per band: every method's p50/p95/max, then the p95 intervals (stable, fixedT, prod). */
function bandLines(rows: readonly TaggedRow[]): string[] {
  const lines = [
    'reached deg | n (walks) | raw | stable | fixedT | prod | freeT | shared6 (p50/p95/max deg)',
  ];
  for (let i = 0; i < BANDS.length - 1; i++) {
    const [lo, hi] = [BANDS[i]!, BANDS[i + 1]!];
    const r = rows.filter((x) => x.reachedDeg >= lo && x.reachedDeg < hi);
    if (r.length === 0) continue;
    const walks = new Set(r.map((x) => x.walk)).size;
    lines.push(
      [
        `${lo}-${hi}`.padEnd(11),
        `${r.length} (${walks})`.padStart(9),
        stats(r.map((x) => x.errRawDeg)),
        stats(r.map((x) => x.errStableDeg)),
        stats(r.map((x) => x.errFusedDeg.rotSharedFixedT!)),
        stats(r.map((x) => x.errProductionDeg)),
        stats(r.map((x) => x.errFusedDeg.rotSharedFreeT!)),
        stats(r.map((x) => x.errFusedDeg.shared6!)),
      ].join(' | '),
      `            p95 90% interval (walks resampled): stable ${p95Interval(r, (x) => x.errStableDeg, lo + 1)} | fixedT ${p95Interval(r, (x) => x.errFusedDeg.rotSharedFixedT!, lo + 2)} | prod ${p95Interval(r, (x) => x.errProductionDeg, lo + 3)}`
    );
  }
  return lines;
}

/** The still walk on its own, and the pitch / yaw split over all rows. */
function stillAndAxisLines(rows: readonly TaggedRow[]): string[] {
  const still = rows.filter((x) => x.kind === 'still');
  const p95 = (xs: number[]) => stats(xs).split('/')[1] ?? '-';
  const axes = (key: 'pitch' | 'yaw') =>
    [
      `raw ${p95(rows.map((x) => x.axisErrDeg.raw[key]))}`,
      `stable ${p95(rows.map((x) => x.axisErrDeg.stable[key]))}`,
      `fixedT ${p95(rows.map((x) => x.axisErrDeg.fused.rotSharedFixedT![key]))}`,
      `prod ${p95(rows.map((x) => x.axisErrDeg.production[key]))}`,
    ].join(' | ');
  return [
    `still walk (n ${still.length}): raw ${stats(still.map((x) => x.errRawDeg))} | stable ${stats(still.map((x) => x.errStableDeg))} | fixedT ${stats(still.map((x) => x.errFusedDeg.rotSharedFixedT!))} | prod ${stats(still.map((x) => x.errProductionDeg))}`,
    `pitch p95 (all rows): ${axes('pitch')}`,
    `yaw p95 (all rows):   ${axes('yaw')}`,
    `prod ms per solve (this machine): ${stats(rows.map((x) => x.productionMs))}`,
  ];
}

/**
 * What consumers actually get (M3b design review §16 #1): the rotations above
 * are compared UNGATED, but the apps only see a pose once today's gate
 * (raw spreads within 3 cm / 5 deg) opens. Per band: how often it opens, the
 * two rotations on the windows it lets through, and the joint solve on the
 * windows it holds back.
 */
function gateLines(rows: readonly TaggedRow[]): string[] {
  const lines = [
    'reached deg | gate open | on open windows: stable | prod | on held windows: prod (p50/p95/max deg)',
  ];
  for (let i = 0; i < BANDS.length - 1; i++) {
    const [lo, hi] = [BANDS[i]!, BANDS[i + 1]!];
    const r = rows.filter((x) => x.reachedDeg >= lo && x.reachedDeg < hi);
    if (r.length === 0) continue;
    const open = r.filter((x) => x.stableGated);
    const held = r.filter((x) => !x.stableGated);
    lines.push(
      [
        `${lo}-${hi}`.padEnd(11),
        `${open.length}/${r.length} (${Math.round((100 * open.length) / r.length)} %)`.padStart(
          14
        ),
        open.length ? stats(open.map((x) => x.errStableDeg)) : '-',
        open.length ? stats(open.map((x) => x.errProductionDeg)) : '-',
        held.length ? stats(held.map((x) => x.errProductionDeg)) : '-',
      ].join(' | ')
    );
  }
  return lines;
}

/** The position re-fit spike (plan §12 / §14): one re-fit pass vs prod. */
function refitLines(rows: readonly TaggedRow[]): string[] {
  const lines = ['reached deg | n | prod | refit (p50/p95/max deg)'];
  for (let i = 0; i < BANDS.length - 1; i++) {
    const [lo, hi] = [BANDS[i]!, BANDS[i + 1]!];
    const r = rows.filter(
      (x) =>
        x.reachedDeg >= lo &&
        x.reachedDeg < hi &&
        Number.isFinite(x.errRefitDeg)
    );
    if (r.length === 0) continue;
    lines.push(
      [
        `${lo}-${hi}`.padEnd(11),
        String(r.length).padStart(4),
        stats(r.map((x) => x.errProductionDeg)),
        stats(r.map((x) => x.errRefitDeg)),
      ].join(' | ')
    );
  }
  return lines;
}

function walkReport(rows: readonly TaggedRow[]): string[] {
  const same = sameFrames(rows);
  return [
    ...bandLines(same),
    ...stillAndAxisLines(same),
    ...gateLines(same),
    ...refitLines(same),
  ];
}

/** 100 short (version 2-3, level M) and 100 launch-URL (version 6-9, level Q) payloads. */
function payloadSet(): { text: string; ecLevel: 'M' | 'Q' }[] {
  return Array.from({ length: 100 }, (_, i) => [
    { text: `https://ex.co/p/${i}`, ecLevel: 'M' as const },
    {
      text: `https://gps-plus-slam.csutil.workers.dev/tour/?t=S/${(i * 7919 + 13).toString(36)}Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq`,
      ecLevel: 'Q' as const,
    },
  ]).flat();
}

/** Paint the symbol's TL finder (and a margin) white: glare or a smudge. */
function washOutTopLeftFinder(frame: ReturnType<typeof renderQrFrame>): void {
  const [tl, tr, , bl] = frame.truthCorners;
  const reach = 8.5 / frame.moduleCount;
  const { data, width, height } = frame.image;
  const ux = tr.x - tl.x;
  const uy = tr.y - tl.y;
  const vx = bl.x - tl.x;
  const vy = bl.y - tl.y;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = ((x - tl.x) * ux + (y - tl.y) * uy) / (ux * ux + uy * uy);
      const v = ((x - tl.x) * vx + (y - tl.y) * vy) / (vx * vx + vy * vy);
      if (u > -0.02 && u < reach && v > -0.02 && v < reach) {
        const o = (y * width + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 255;
      }
    }
  }
}

interface PayloadTally {
  n: number;
  confident: number;
  wrong: number;
  neverOrdered: Set<string>;
}

function tallyCornerOrder(
  tally: PayloadTally,
  text: string,
  frame: ReturnType<typeof renderQrFrame>,
  errPx: number,
  seed: number
): boolean {
  const span = 2 * errPx + 1;
  const nudge = (k: number) => ((seed * (k + 3) * 7) % span) - errPx;
  const truth = frame.truthCorners.map((p, k) => ({
    x: Math.round(p.x + nudge(k)),
    y: Math.round(p.y + nudge(k + 1)),
  }));
  let start = 0;
  truth.forEach((p, i) => {
    if (p.x + p.y < truth[start]!.x + truth[start]!.y) start = i;
  });
  const out = canonicalizeCorners(
    frame.image,
    [0, 1, 2, 3].map((k) => truth[(start + k) % 4]!)
  );
  const correct = out.corners.every(
    (p, i) => p.x === truth[i]!.x && p.y === truth[i]!.y
  );
  tally.n++;
  if (out.confident) tally.confident++;
  if (out.confident && !correct) tally.wrong++;
  return out.confident;
}

const IDENTITY_POSE: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

interface CandidateCase {
  cap: { width: number; height: number; fovYDeg: number };
  distanceM: number;
  tilt: { tiltXDeg?: number; tiltYDeg?: number };
  tiltDeg: number;
  rollDeg: number;
  offsetM: readonly [number, number];
  seed: number;
}

/** Small codes, near-frontal tilts about either axis, three sub-pixel phases. */
function candidateCases(): CandidateCase[] {
  const caps = [
    { width: 439, height: 1024, fovYDeg: 64 },
    { width: 1024, height: 768, fovYDeg: 50 },
  ];
  const offsets = [
    [0, 0],
    [0.013, -0.007],
    [-0.021, 0.011],
  ] as const;
  return caps
    .flatMap((cap) =>
      [1, 1.5, 2].flatMap((distanceM) =>
        [0, 3, 6, 10, 15, 20, 30].flatMap((tiltDeg) =>
          [{ tiltXDeg: tiltDeg }, { tiltYDeg: tiltDeg }].flatMap((tilt) =>
            [0, 37].flatMap((rollDeg) =>
              offsets.map((offsetM) => ({
                cap,
                distanceM,
                tilt,
                tiltDeg,
                rollDeg,
                offsetM,
              }))
            )
          )
        )
      )
    )
    .map((c, k) => ({ ...c, seed: k + 1 }));
}

interface CandidateRow {
  tiltDeg: number;
  modulePx: number;
  /** Today's pick. */
  prodRotDeg: number;
  prodPosCm: number;
  prodInvalid: boolean;
  /** M2's pick: the best-fitting REAL candidate. */
  m2RotDeg: number;
  m2PosCm: number;
  /** The best real candidate against the truth (what no selection can beat). */
  bestRealRotDeg: number;
}

function poseErr(est: Pose, truth: Pose): { rot: number; posCm: number } {
  return {
    rot: rotationAngleDeg(est.rotation, truth.rotation),
    posCm:
      100 *
      Math.hypot(
        est.position[0] - truth.position[0],
        est.position[1] - truth.position[1],
        est.position[2] - truth.position[2]
      ),
  };
}

/** Distance from `pose` to the nearest of `set`: rotation deg + position cm. */
function nearest(set: readonly Pose[], pose: Pose): number {
  return Math.min(
    ...set.map((c) => {
      const e = poseErr(c, pose);
      return e.rot + e.posCm;
    })
  );
}

/** One frame: today's pick vs M2's pick vs the best real candidate. */
async function measureCandidates(
  c: CandidateCase
): Promise<CandidateRow | null> {
  const projection = perspectiveProjection({
    fovYDeg: c.cap.fovYDeg,
    aspect: c.cap.width / c.cap.height,
  });
  const truth = qrPoseFacingCamera({
    distanceM: c.distanceM,
    rollDeg: c.rollDeg,
    offsetM: c.offsetM,
    ...c.tilt,
  });
  const frame = renderQrFrame({
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera: truth,
    projection,
    width: c.cap.width,
    height: c.cap.height,
    supersample: 2,
    noiseSigma: 2,
    seed: c.seed,
  });
  if (frame.modulePx >= 4) return null; // small codes only
  const det = await zxingDetect(frame.image);
  if (!det || det.text !== PAYLOAD) return null;
  const intrinsics = intrinsicsFromProjection(
    projection,
    c.cap.width,
    c.cap.height
  );
  const prod = solveQrPose({
    imagePoints: det.corners,
    sizeM: SIZE_M,
    intrinsics,
    cameraPose: IDENTITY_POSE,
    solver: new PlanarPnpSquare(),
    maxReprojectionErrorPx: Infinity,
  });
  const { real, invalid } = candidateStartsBySet(
    { corners: det.corners, cameraWorld: IDENTITY_POSE, intrinsics },
    SIZE_M
  );
  if (!prod || real.length === 0) return null;
  const object = buildObjectPoints(SIZE_M);
  const m2 = real.reduce((best, cand) =>
    reprojectionErrorPx(object, det.corners, cand, intrinsics) <
    reprojectionErrorPx(object, det.corners, best, intrinsics)
      ? cand
      : best
  );
  const p = poseErr(prod.qrPoseInCamera, truth);
  const m = poseErr(m2, truth);
  return {
    tiltDeg: c.tiltDeg,
    modulePx: frame.modulePx,
    prodRotDeg: p.rot,
    prodPosCm: p.posCm,
    // Nearest candidate set to today's pick, by rotation plus position: the
    // two code paths differ by ~0.03 deg, so an exact-match threshold would
    // misclassify; the invalid root differs in depth as well.
    prodInvalid:
      nearest(invalid, prod.qrPoseInCamera) <
      nearest(real, prod.qrPoseInCamera),
    m2RotDeg: m.rot,
    m2PosCm: m.posCm,
    bestRealRotDeg: Math.min(
      ...real.map((r) => rotationAngleDeg(r.rotation, truth.rotation))
    ),
  };
}

function candidateReport(rows: readonly CandidateRow[]): string[] {
  const lines = [
    'tilt | n | today rot p50/p95/max | M2 rot p50/p95/max | best real p95 | today pos p95 cm | M2 pos p95 cm | today picked invalid',
  ];
  for (const tilt of [0, 3, 6, 10, 15, 20, 30]) {
    const r = rows.filter((x) => x.tiltDeg === tilt);
    if (r.length === 0) continue;
    const p95 = (xs: number[]) => stats(xs).split('/')[1] ?? '-';
    lines.push(
      [
        String(tilt).padStart(4),
        String(r.length).padStart(3),
        stats(r.map((x) => x.prodRotDeg)),
        stats(r.map((x) => x.m2RotDeg)),
        p95(r.map((x) => x.bestRealRotDeg)),
        p95(r.map((x) => x.prodPosCm)),
        p95(r.map((x) => x.m2PosCm)),
        String(r.filter((x) => x.prodInvalid).length),
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
      // SLAM error on the poses the solvers see (review finding 4): none, a
      // level below the earlier two, the earlier two, and a drift.
      const levels = [
        { label: 'exact SLAM', noise: undefined },
        {
          label: 'SLAM noise 0.1 deg / 2 mm',
          noise: { rotationDeg: 0.1, translationM: 0.002 },
        },
        {
          label: 'SLAM noise 0.2 deg / 5 mm',
          noise: { rotationDeg: 0.2, translationM: 0.005 },
        },
        {
          label: 'SLAM noise 0.5 deg / 10 mm',
          noise: { rotationDeg: 0.5, translationM: 0.01 },
        },
        {
          label: 'SLAM drift 0.1 deg + 2 mm per step',
          noise: {
            rotationDeg: 0,
            translationM: 0,
            driftRotationDegPerStep: 0.1,
            driftTranslationMPerStep: 0.002,
          },
        },
      ];
      const reports: string[] = [];
      let total = 0;
      for (const { label, noise } of levels) {
        const rows: TaggedRow[] = [];
        let walk = 0;
        for (const w of walkCases()) {
          const measured = await measureWalk({
            ...w,
            ...(noise ? { slamNoise: noise } : {}),
          });
          rows.push(...measured.map((r) => ({ ...r, walk, kind: w.kind })));
          walk++;
        }
        total += rows.length;
        reports.push(label, ...walkReport(rows));
      }
      console.log(
        `\nWALKS (phone 439x1024, wall code 16 cm)\n${reports.join('\n')}`
      );
      expect(total).toBeGreaterThan(0);
    },
    6 * SWEEP_TIMEOUT_MS // five SLAM-noise levels over the whole walk set
  );

  it(
    'corner order over many payloads (milestone review 2026-09-24, finding 1)',
    () => {
      // One frontal frame per payload, roll and corner error, at the phone's
      // folded geometry and ~0.9 m (about 3-5 px/module for these versions);
      // then the same with the TL finder washed out.
      const projection = perspectiveProjection({
        fovYDeg: 64,
        aspect: 439 / 1024,
      });
      const lines: string[] = [];
      for (const washed of [false, true]) {
        for (const errPx of washed ? [0] : [0, 1, 2]) {
          const tally: PayloadTally = {
            n: 0,
            confident: 0,
            wrong: 0,
            neverOrdered: new Set(),
          };
          payloadSet().forEach(({ text, ecLevel }, i) => {
            let anyConfident = false;
            for (const rollDeg of washed ? [0] : [0, 90, 180, 270]) {
              const frame = renderQrFrame({
                text,
                ecLevel,
                sizeM: SIZE_M,
                qrPoseInCamera: qrPoseFacingCamera({ distanceM: 0.9, rollDeg }),
                projection,
                width: 439,
                height: 1024,
                supersample: 2,
                noiseSigma: 2,
                seed: i * 4 + rollDeg,
              });
              if (washed) washOutTopLeftFinder(frame);
              anyConfident =
                tallyCornerOrder(
                  tally,
                  text,
                  frame,
                  errPx,
                  i * 4 + rollDeg + 2
                ) || anyConfident;
            }
            if (!anyConfident) tally.neverOrdered.add(text);
          });
          lines.push(
            `${washed ? 'TL finder washed out' : `corner error ${errPx} px`} | frames ${tally.n} | confident ${pct(tally.confident, tally.n)} | WRONG confident ${tally.wrong} | codes never ordered ${tally.neverOrdered.size}/200`
          );
        }
      }
      console.log(
        `\nCORNER ORDER OVER 200 PAYLOADS (439x1024, 0.9 m)\n${lines.join('\n')}`
      );
      expect(lines.length).toBe(4);
    },
    SWEEP_TIMEOUT_MS
  );

  it(
    'per candidate: today vs removing the invalid root (plan 2026-09-23-2314, M0 for M2)',
    async () => {
      const rows: CandidateRow[] = [];
      for (const c of candidateCases()) {
        const r = await measureCandidates(c);
        if (r) rows.push(r);
      }
      console.log(
        `\nPER CANDIDATE (small codes < 4 px/module, noise 2, both tilt axes, 3 phases)\n${candidateReport(rows).join('\n')}`
      );
      expect(rows.length).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT_MS
  );
});
