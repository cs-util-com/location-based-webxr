/**
 * The QR motion detector's thresholds through a REAL decoder (opt-in, not a
 * gate; QR near-frontal pose plan 2026-09-23-2314, §26).
 *
 * Run with `QR_SWEEP=1`:
 *   $env:QR_SWEEP='1'; pnpm run test:unit src/ar/qr/qr-motion.sweep.test.ts --disable-console-intercept
 *
 * Why this exists: the unit tests feed the detector exact corners plus
 * Gaussian noise, and its defaults (3 cm moving, 3 px turning, 4 detections)
 * were set from those. Here every frame is rendered (`synthetic-qr-frame.ts`)
 * at the phone's capture size and decoded by zxing, the camera pose carries
 * SLAM-like noise, and the camera follows the code as a hand does. It
 * reports, across the parameter range (owner rule 2026-09-13):
 * - the raw signals on a STILL code (what a threshold must sit above);
 * - false motion on still codes: detections not read "still";
 * - on moving codes, the delay from the motion's start to the right mode,
 *   whether the other flag fired wrongly, and the delay back to "still".
 * Results: GpsPlusSlamJs_Docs/docs/2026-09-25-0100-qr-motion-threshold-sweep-findings.md.
 */

import { describe, expect, it } from 'vitest';
import {
  perspectiveProjection,
  renderQrFrame,
} from '../../test-utils/synthetic-qr-frame';
import {
  codeInCamera,
  lookAtPose,
  walkCameraPoses,
} from '../../test-utils/synthetic-qr-walk';
import { zxingDetect } from '../../test-utils/qr-zxing-pipeline';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';
import { intrinsicsFromProjection, solveQrPose, type Pose } from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import type { QrFusedEntry } from './qr-fused-window';
import {
  createQrMotionTracker,
  measureQrMotion,
  type QrMotion,
  type QrMotionOptions,
} from './qr-motion';

const RUN = process.env.QR_SWEEP === '1';
const SWEEP_TIMEOUT_MS = 1_800_000;

const PAYLOAD =
  'https://gps-plus-slam.csutil.workers.dev/tour/?t=S/k7Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq';
const SIZE_M = 0.16;
/** The walk sweeps' phone capture (portrait, like the detection buffer). */
const PHONE = { width: 439, height: 1024, fovYDeg: 64 };
const STEP_MS = 125;
const STEPS = 40;
/** The motion runs from this detection for MOTION_STEPS, then the code rests. */
const MOTION_START = 10;
const MOTION_STEPS = 12;

type Vec3 = [number, number, number];

function qmul(a: readonly number[], b: readonly number[]): Pose['rotation'] {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}

function axisAngle(axis: Vec3, deg: number): Pose['rotation'] {
  const h = (deg * Math.PI) / 360;
  return [
    axis[0] * Math.sin(h),
    axis[1] * Math.sin(h),
    axis[2] * Math.sin(h),
    Math.cos(h),
  ];
}

/** A code at `x` (m), yawed `yawDeg` about the vertical, spun `spinDeg` in its plane. */
function codeAt(x: number, yawDeg: number, spinDeg: number): Pose {
  return {
    position: [x, 1.5, 0],
    rotation: qmul(axisAngle([0, 1, 0], yawDeg), axisAngle([0, 0, 1], spinDeg)),
  };
}

interface Scene {
  name: string;
  /** 'still' | 'moving' | 'turning' | 'both': what the motion phase is. */
  kind: 'still' | 'moving' | 'turning' | 'both';
  codeOf(step: number): Pose;
  /** The camera walks an arc (true) or holds still (false). */
  cameraWalks: boolean;
}

/** Progress through the motion phase in detections, 0 before and MOTION_STEPS after. */
const phase = (i: number) =>
  Math.min(Math.max(i - MOTION_START + 1, 0), MOTION_STEPS);

function scenes(): Scene[] {
  const out: Scene[] = [
    {
      name: 'still, camera walks',
      kind: 'still',
      codeOf: () => codeAt(0, 5, 0),
      cameraWalks: true,
    },
    {
      name: 'still, camera holds',
      kind: 'still',
      codeOf: () => codeAt(0, 5, 0),
      cameraWalks: false,
    },
  ];
  for (const mps of [0.05, 0.1, 0.2, 0.4]) {
    const perStep = (mps * STEP_MS) / 1000;
    out.push({
      name: `slide ${mps} m/s`,
      kind: 'moving',
      codeOf: (i) => codeAt(perStep * phase(i), 5, 0),
      cameraWalks: true,
    });
  }
  for (const dps of [10, 20, 40, 80]) {
    const perStep = (dps * STEP_MS) / 1000;
    out.push({
      name: `spin in plane ${dps} deg/s`,
      kind: 'turning',
      codeOf: (i) => codeAt(0, 5, perStep * phase(i)),
      cameraWalks: true,
    });
    out.push({
      name: `turn out of plane ${dps} deg/s`,
      kind: 'turning',
      codeOf: (i) => codeAt(0, 5 + perStep * phase(i), 0),
      cameraWalks: true,
    });
  }
  out.push({
    name: 'slide 0.2 m/s + spin 20 deg/s',
    kind: 'both',
    codeOf: (i) => codeAt(0.025 * phase(i), 5, 2.5 * phase(i)),
    cameraWalks: true,
  });
  return out;
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

interface SlamNoise {
  rotationDeg: number;
  translationM: number;
}

function perturbed(
  camera: Pose,
  n: SlamNoise | null,
  rand: () => number
): Pose {
  if (!n) return camera;
  const axis = [gaussian(rand), gaussian(rand), gaussian(rand)];
  const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
  const turn = axisAngle(
    [axis[0]! / len, axis[1]! / len, axis[2]! / len],
    gaussian(rand) * n.rotationDeg
  );
  return {
    position: [
      camera.position[0] + gaussian(rand) * n.translationM,
      camera.position[1] + gaussian(rand) * n.translationM,
      camera.position[2] + gaussian(rand) * n.translationM,
    ],
    rotation: qmul(camera.rotation, turn),
  };
}

/** Render, decode and solve a scene: the entries a phone would record. */
async function render(
  scene: Scene,
  opts: {
    seed: number;
    noiseSigma: number;
    slam: SlamNoise | null;
    distanceM?: number;
  }
): Promise<(QrFusedEntry | null)[]> {
  const projection = perspectiveProjection({
    fovYDeg: PHONE.fovYDeg,
    aspect: PHONE.width / PHONE.height,
  });
  const intrinsics = intrinsicsFromProjection(
    projection,
    PHONE.width,
    PHONE.height
  );
  const eyes = walkCameraPoses({
    kind: scene.cameraWalks ? 'arc' : 'still',
    codeWorld: codeAt(0, 0, 0),
    distanceM: opts.distanceM ?? 1.2,
    extent: 30,
    steps: STEPS,
  }).map((p) => p.position as Vec3);
  const rand = mulberry32(opts.seed * 7919 + 17);
  const out: (QrFusedEntry | null)[] = [];
  for (let i = 0; i < STEPS; i++) {
    const code = scene.codeOf(i);
    // The hand keeps the code in view: the camera looks at it.
    const camera = lookAtPose(eyes[i]!, code.position as Vec3);
    const frame = renderQrFrame({
      text: PAYLOAD,
      sizeM: SIZE_M,
      qrPoseInCamera: codeInCamera(camera, code),
      projection,
      width: PHONE.width,
      height: PHONE.height,
      supersample: 2,
      noiseSigma: opts.noiseSigma,
      seed: opts.seed * 1000 + i,
    });
    const det = await zxingDetect(frame.image);
    if (!det || det.text !== PAYLOAD) {
      out.push(null);
      continue;
    }
    const seenFrom = perturbed(camera, opts.slam, rand);
    const raw = solveQrPose({
      imagePoints: det.corners,
      sizeM: SIZE_M,
      intrinsics,
      cameraPose: seenFrom,
      solver: new PlanarPnpSquare(),
    });
    out.push({
      timestamp: i * STEP_MS,
      corners: det.corners,
      cameraPose: seenFrom,
      intrinsics,
      rawPose: raw ? raw.qrPoseWorld : null,
    });
  }
  return out;
}

interface Rendered {
  scene: Scene;
  steps: (QrFusedEntry | null)[];
}

/** The entries up to each step: what the tracker would see after it. */
function prefixes(steps: (QrFusedEntry | null)[]) {
  const kept: QrFusedEntry[] = [];
  return steps.map((e) => {
    if (e) kept.push(e);
    return e ? [...kept] : null;
  });
}

const pctile = (xs: number[], p: number): number => {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

/** The raw signals over the still scenes: what any threshold must sit above. */
function stillSignals(rendered: Rendered[], motionWindow: number): string {
  const fits: number[] = [];
  const offsets: number[] = [];
  for (const r of rendered.filter((x) => x.scene.kind === 'still')) {
    for (const entries of prefixes(r.steps)) {
      if (!entries) continue;
      const m = measureQrMotion(entries, { motionWindow });
      if (m.newestFitPx !== null) fits.push(m.newestFitPx);
      if (m.offsetM !== null) offsets.push(m.offsetM * 100);
    }
  }
  return `motionWindow ${motionWindow}: still turn signal p50/p95/p99/max ${f(pctile(fits, 0.5))}/${f(pctile(fits, 0.95))}/${f(pctile(fits, 0.99))}/${f(Math.max(...fits))} px (n ${fits.length}) | still move signal p50/p95/p99/max ${f(pctile(offsets, 0.5))}/${f(pctile(offsets, 0.95))}/${f(pctile(offsets, 0.99))}/${f(Math.max(...offsets))} cm`;
}

interface Score {
  /** Still scenes: detections not read still / detections. */
  falseMotion: number;
  falseN: number;
  /** Moving scenes: detections from the motion's start to the right flag; NaN = missed. */
  delays: number[];
  missed: number;
  /** Moving scenes: the wrong flag confirmed during a pure slide or turn. */
  wrongFlag: number;
  /** Detections from the motion's end back to still; NaN = never. */
  backDelays: number[];
}

type States = (QrMotion | null)[];

function scoreStill(s: Score, states: States): void {
  for (const m of states) {
    if (!m) continue;
    s.falseN += 1;
    if (m.state !== 'still') s.falseMotion += 1;
  }
}

/** Whether a reading shows the motion a scene of this kind has. */
function shows(kind: Scene['kind'], m: QrMotion): boolean {
  if (kind === 'moving') return m.moving;
  if (kind === 'turning') return m.turning;
  return m.moving && m.turning;
}

/** The OTHER flag during a pure slide or turn. */
function wrongFlag(kind: Scene['kind'], m: QrMotion): boolean {
  return (kind === 'moving' && m.turning) || (kind === 'turning' && m.moving);
}

function scoreMotion(s: Score, kind: Scene['kind'], states: States): void {
  const end = MOTION_START + MOTION_STEPS;
  const during = states.slice(MOTION_START, end);
  const first = during.findIndex((m) => m !== null && shows(kind, m));
  if (first < 0) s.missed += 1;
  else s.delays.push(first + 1);
  if (during.some((m) => m !== null && wrongFlag(kind, m))) s.wrongFlag += 1;
  const back = states.slice(end).findIndex((m) => m?.state === 'still');
  s.backDelays.push(back < 0 ? Number.NaN : back + 1);
}

function score(rendered: Rendered[], options: QrMotionOptions): Score {
  const s: Score = {
    falseMotion: 0,
    falseN: 0,
    delays: [],
    missed: 0,
    wrongFlag: 0,
    backDelays: [],
  };
  for (const r of rendered) {
    const tracker = createQrMotionTracker(options);
    const states = prefixes(r.steps).map((entries) =>
      entries ? tracker.update(entries) : null
    );
    if (r.scene.kind === 'still') scoreStill(s, states);
    else scoreMotion(s, r.scene.kind, states);
  }
  return s;
}

function line(label: string, s: Score, moving: number): string {
  const back = s.backDelays.filter(Number.isFinite);
  return `${label}: false motion ${s.falseMotion}/${s.falseN} | caught ${s.delays.length}/${moving} (delay p50/max ${f(pctile(s.delays, 0.5), 0)}/${f(Math.max(...s.delays), 0)} det) | wrong flag ${s.wrongFlag} | back to still p50/max ${f(pctile(back, 0.5), 0)}/${f(Math.max(...back), 0)} det (never ${s.backDelays.length - back.length})`;
}

describe.runIf(RUN)('QR motion threshold sweep (opt-in, QR_SWEEP=1)', () => {
  it(
    'measures false motion and detection delay across the thresholds',
    async () => {
      const conditions = [
        { name: 'clean', noiseSigma: 0, slam: null },
        { name: 'pixel noise 4', noiseSigma: 4, slam: null },
        {
          name: 'pixel noise 4 + SLAM 0.2 deg / 5 mm',
          noiseSigma: 4,
          slam: { rotationDeg: 0.2, translationM: 0.005 },
        },
        {
          name: 'pixel noise 8 + SLAM 0.5 deg / 10 mm',
          noiseSigma: 8,
          slam: { rotationDeg: 0.5, translationM: 0.01 },
        },
      ];
      for (const c of conditions) {
        const all = scenes();
        const rendered: Rendered[] = [];
        for (const scene of all) {
          for (const seed of [1, 2, 3]) {
            rendered.push({
              scene,
              steps: await render(scene, { seed, ...c }),
            });
          }
        }
        const decoded = rendered.flatMap((r) => r.steps).filter(Boolean).length;
        const moving = rendered.filter((r) => r.scene.kind !== 'still').length;
        const out = [
          `== ${c.name}: ${decoded}/${rendered.length * STEPS} frames decoded`,
        ];
        for (const w of [3, 4, 6]) out.push(stillSignals(rendered, w));
        for (const persistence of [2, 3, 4, 6]) {
          for (const moveM of [0.02, 0.03, 0.05, 0.1]) {
            out.push(
              line(
                `persistence ${persistence} moveM ${moveM} turnPx 3`,
                score(rendered, { persistence, moveM }),
                moving
              )
            );
          }
          for (const turnPx of [2, 4, 6, 10]) {
            out.push(
              line(
                `persistence ${persistence} moveM 0.03 turnPx ${turnPx}`,
                score(rendered, { persistence, turnPx }),
                moving
              )
            );
          }
        }
        // Per scene at the defaults: which motions are caught, which not.
        for (const scene of all) {
          const own = rendered.filter((r) => r.scene === scene);
          const s = score(own, {});
          out.push(
            `  default | ${scene.name}: ${line('', s, scene.kind === 'still' ? 0 : own.length).slice(2)}`
          );
        }
        console.log(out.join('\n'));
        expect(decoded).toBeGreaterThan(0);
      }
    },
    SWEEP_TIMEOUT_MS
  );
});

describe.runIf(RUN)('QR motion: a still code across distance (opt-in)', () => {
  // Milestone review finding 1: the moving signal is a single-frame position
  // difference, whose SLAM-rotation part grows with distance and whose PnP
  // depth part grows faster; every scene above is at 1.2 m.
  it(
    'measures the still move signal and false motion from 0.6 to 3 m',
    async () => {
      const still = scenes().find((x) => x.name === 'still, camera walks')!;
      const out: string[] = [];
      for (const slam of [
        { rotationDeg: 0.2, translationM: 0.005 },
        { rotationDeg: 0.5, translationM: 0.01 },
      ]) {
        for (const distanceM of [0.6, 1.2, 2, 3]) {
          const rendered: Rendered[] = [];
          for (const seed of [1, 2, 3, 4, 5]) {
            rendered.push({
              scene: still,
              steps: await render(still, {
                seed,
                noiseSigma: 4,
                slam,
                distanceM,
              }),
            });
          }
          const decoded = rendered.flatMap((r) => r.steps).filter(Boolean);
          const cells = [0.03, 0.05, 0.08].map((moveM) => {
            const s = score(rendered, { moveM });
            return `moveM ${moveM}: false ${s.falseMotion}/${s.falseN}`;
          });
          out.push(
            `SLAM ${slam.rotationDeg} deg / ${slam.translationM * 1000} mm, ${distanceM} m: ${decoded.length}/${rendered.length * STEPS} decoded | ${stillSignals(rendered, 4)} | ${cells.join(' | ')}`
          );
        }
      }
      console.log(out.join('\n'));
      expect(out.length).toBe(8);
    },
    SWEEP_TIMEOUT_MS
  );
});
