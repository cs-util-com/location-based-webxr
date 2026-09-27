/**
 * The parallax size's per-view solve cache (QR size consensus plan §12 #6).
 *
 * Why this test matters: a caller re-reads a code's entries after every
 * detection, and `selectQrFusedEntries` builds NEW entry objects each time
 * (only the corners array is kept by reference). A cache keyed on the entry
 * object never hit, so every detection re-solved up to 32 views; keyed on
 * the corners, only the new detection is solved.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as QrPose from './qr-pose';

const solves = vi.hoisted(() => ({ count: 0 }));
vi.mock('./qr-pose', async (importOriginal) => {
  const actual = await importOriginal<typeof QrPose>();
  return {
    ...actual,
    solveQrPose: (...args: Parameters<typeof actual.solveQrPose>) => {
      solves.count += 1;
      return actual.solveQrPose(...args);
    },
  };
});

import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  type Pose,
} from './qr-pose';
import type { QrFusedEntry } from './qr-fused-window';
import { estimateQrSizeFromParallax } from './qr-size-parallax';
import { walkCameraPoses } from '../../test-utils/synthetic-qr-walk';

const K = { fx: 820, fy: 820, cx: 512, cy: 384 };
const CODE: Pose = { position: [0, 1.4, 0], rotation: [0, 0, 0, 1] };

function entries(): QrFusedEntry[] {
  return walkCameraPoses({
    kind: 'sidestep',
    codeWorld: CODE,
    distanceM: 1.5,
    extent: 0.6,
    steps: 8,
  }).map((camera, i) => {
    const inv: Pose['rotation'] = [
      -camera.rotation[0],
      -camera.rotation[1],
      -camera.rotation[2],
      camera.rotation[3],
    ];
    const corners = buildObjectPoints(0.16).map((p) =>
      projectViewPoint(
        rotateVectorByQuaternion(inv, [
          p[0] + CODE.position[0] - camera.position[0],
          p[1] + CODE.position[1] - camera.position[1],
          p[2] + CODE.position[2] - camera.position[2],
        ]),
        K
      )!
    );
    return {
      timestamp: 1000 + i * 125,
      corners,
      cameraPose: camera,
      intrinsics: K,
    };
  });
}

describe('estimateQrSizeFromParallax solve cache', () => {
  it('solves each detection once, although the entry objects are rebuilt', () => {
    const e = entries();
    estimateQrSizeFromParallax(e);
    expect(solves.count).toBe(8);
    // What selectQrFusedEntries hands back after the next detection: new
    // entry objects, the same corners arrays.
    const rebuilt = e.map((entry) => ({ ...entry }));
    estimateQrSizeFromParallax(rebuilt);
    expect(solves.count).toBe(8);
  });

  it('reports the time span of the window it used', () => {
    const r = estimateQrSizeFromParallax(entries())!;
    expect(r.oldestTimestamp).toBe(1000);
    expect(r.newestTimestamp).toBe(1000 + 7 * 125);
  });
});
