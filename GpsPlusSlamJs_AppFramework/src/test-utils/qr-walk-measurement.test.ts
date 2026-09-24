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
