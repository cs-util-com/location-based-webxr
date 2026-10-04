import { describe, expect, it } from 'vitest';
import { measureWalk } from './qr-walk-measurement';

const WALL_CODE = {
  position: [0, 1.5, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

describe('measureWalk (M0 walk harness)', () => {
  // Why this test matters: the M0 baselines and every later verdict come
  // from these rows; on a clean, strongly oblique walk every method must be
  // near the truth, and the row must carry the reached obliqueness it will be
  // binned by.
  it('scores every method against the truth on a clean oblique walk', async () => {
    const rows = await measureWalk({
      kind: 'arc',
      codeWorld: WALL_CODE,
      distanceM: 0.8,
      extent: 50,
      steps: 6,
      noiseSigma: 0,
      seed: 1,
    });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const last = rows[rows.length - 1]!;
    expect(last.reachedDeg).toBeGreaterThan(20);
    expect(last.errRawDeg).toBeLessThan(3);
    expect(last.errFusedDeg.rotSharedFreeT!).toBeLessThan(1);
    expect(last.errProductionDeg).toBeLessThan(1);
    // Today's gate stays SHUT even here (M3b design review §16 #1): the raw
    // rotations of this clean, strongly oblique window spread 5.7 deg, just
    // over the 5 deg gate (3 cm / 1 cm is fine), while the joint solve on
    // the same window is within 1 deg. Measured 2026-09-24.
    expect(last.stableGated).toBe(false);
    expect(last.stableSpread.rotationDeg).toBeGreaterThan(5);
    expect(last.stableSpread.translationM).toBeLessThan(0.03);
    // The re-fit spike's column exists and is sane on clean data.
    expect(last.errRefitDeg).toBeLessThan(1);
    // The fused gate's inputs: the joint fit on clean frames is sub-pixel.
    expect(last.prodViews).toBe(last.window);
    expect(last.prodFitPx).toBeLessThan(1);
    expect(last.axisErrDeg.production.pitch).toBeLessThan(1);
    expect(last.window).toBe(rows.length);
  }, 120_000);

  // Why this test matters: the variant ranking hinges on SLAM error (plan §8);
  // the noise must reach what the SOLVERS see, not the rendered image, or the
  // sweep would measure nothing. Same frames, same seed: only the poses the
  // solvers are handed differ.
  it('hands the solvers noisy camera poses when asked', async () => {
    const base = {
      kind: 'arc' as const,
      codeWorld: WALL_CODE,
      distanceM: 0.8,
      extent: 50,
      steps: 6,
      noiseSigma: 0,
      seed: 3,
    };
    const clean = await measureWalk(base);
    const noisy = await measureWalk({
      ...base,
      slamNoise: { rotationDeg: 1, translationM: 0.01 },
    });
    expect(noisy.length).toBe(clean.length);
    expect(noisy.map((r) => r.reachedDeg)).toEqual(
      clean.map((r) => r.reachedDeg)
    );
    const last = (rows: typeof clean) =>
      rows[rows.length - 1]!.errFusedDeg.rotSharedFreeT!;
    expect(Math.abs(last(noisy) - last(clean))).toBeGreaterThan(0.1);
  }, 120_000);

  // Why this test matters (milestone review 2026-09-24, finding 3): the
  // phone's absolute check is the PITCH of a wall code's normal; a single
  // total angle cannot show which axis a method gets right.
  it('reports pitch and yaw errors of the code normal apart', async () => {
    const rows = await measureWalk({
      kind: 'rise',
      codeWorld: WALL_CODE,
      distanceM: 0.8,
      extent: 0.5,
      steps: 6,
      noiseSigma: 0,
      seed: 5,
    });
    const last = rows[rows.length - 1]!;
    const fused = last.axisErrDeg.fused.rotSharedFixedT!;
    expect(Number.isFinite(last.axisErrDeg.raw.pitch)).toBe(true);
    expect(Number.isFinite(last.axisErrDeg.stable.yaw)).toBe(true);
    expect(fused.pitch).toBeLessThan(1);
    expect(fused.yaw).toBeLessThan(1);
    // Neither axis can exceed the total rotation error of the same pose.
    expect(fused.pitch).toBeLessThanOrEqual(
      last.errFusedDeg.rotSharedFixedT! + 1e-6
    );
  }, 120_000);

  // Why this test matters (finding 4): SLAM error drifts, it is not only
  // white; a drift the solvers see must change what they measure.
  it('applies a drifting SLAM error when asked', async () => {
    const base = {
      kind: 'arc' as const,
      codeWorld: WALL_CODE,
      distanceM: 0.8,
      extent: 50,
      steps: 6,
      noiseSigma: 0,
      seed: 3,
    };
    const clean = await measureWalk(base);
    const drifting = await measureWalk({
      ...base,
      slamNoise: {
        rotationDeg: 0,
        translationM: 0,
        driftRotationDegPerStep: 0.5,
        driftTranslationMPerStep: 0.005,
      },
    });
    const last = (rows: typeof clean) =>
      rows[rows.length - 1]!.errFusedDeg.rotSharedFixedT!;
    expect(Math.abs(last(drifting) - last(clean))).toBeGreaterThan(0.1);
  }, 120_000);

  // Why this test matters: a frame that zxing cannot decode must be skipped,
  // not scored as a pose; a walk too far away yields no rows at all.
  it('returns no rows when nothing decodes', async () => {
    const rows = await measureWalk({
      kind: 'still',
      codeWorld: WALL_CODE,
      distanceM: 12,
      extent: 0,
      steps: 2,
      noiseSigma: 0,
      seed: 1,
    });
    expect(rows).toEqual([]);
  }, 120_000);
});
