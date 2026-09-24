import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CameraIntrinsics, Point2, Pose } from './qr-pose';
import { buildObjectPoints, projectViewPoint } from './qr-pose';
import type { QrFusedEntry } from './qr-fused-window';
import { solveQrPoseMultiView } from './qr-multi-view-pose';
import { createQrMotionTracker } from './qr-motion';

/**
 * Why this property matters (plan §26, owner: switch after ~4 detections,
 * in both directions): the mode must change only after `persistence`
 * CONSECUTIVE detections agree, and always once they do - for ANY sequence
 * of raw candidates, not the few runs the unit tests pick. A debounce that
 * flips early lets one bad frame drop the fused pose; one that never flips
 * leaves a hand-held code frozen.
 *
 * The raw "moving" candidates are forced: a noise-free still code, and an
 * injected solve that shifts the newest view's own position by 1 m when the
 * generated sequence says "moving". The turning signal stays quiet (exact
 * corners), so the moving flag is the one under test.
 */

const SIZE_M = 0.16;
const K: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };

function entriesFor(n: number): QrFusedEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const cameraPose: Pose = {
      position: [-0.4 + 0.05 * i, 0, 1.2],
      rotation: [0, 0, 0, 1],
    };
    const corners: Point2[] = buildObjectPoints(SIZE_M).map((p) =>
      projectViewPoint([p[0] - cameraPose.position[0], p[1], p[2] - 1.2], K)!
    );
    return { timestamp: i * 125, corners, cameraPose, intrinsics: K };
  });
}

/** The reference: flips exactly when the last `p` candidates all oppose the value. */
function debounce(candidates: readonly boolean[], p: number): boolean[] {
  let value = false;
  let run = 0;
  return candidates.map((c) => {
    run = c === value ? 0 : run + 1;
    if (run >= p) {
      value = c;
      run = 0;
    }
    return value;
  });
}

describe('createQrMotionTracker persistence (property)', () => {
  it('confirms "moving" exactly after `persistence` consecutive agreeing detections', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 16 }),
        fc.integer({ min: 1, max: 6 }),
        (flags, persistence) => {
          // Detection 0 has no motion signal (one view); flags start at 1.
          const entries = entriesFor(flags.length + 1);
          const moved = new Map<readonly Point2[], boolean>();
          flags.forEach((f, i) => moved.set(entries[i + 1]!.corners, f));
          const tracker = createQrMotionTracker({
            persistence,
            solve: (views, sizeM, options) => {
              const r = solveQrPoseMultiView(views, sizeM, options);
              if (!r || !moved.get(views[views.length - 1]!.corners)) return r;
              const last = r.viewPositions[r.viewPositions.length - 1]!;
              return {
                ...r,
                viewPositions: [
                  ...r.viewPositions.slice(0, -1),
                  [last[0] + 1, last[1], last[2]],
                ],
              };
            },
          });
          const got: boolean[] = [];
          for (let i = 1; i <= entries.length; i++) {
            got.push(tracker.update(entries.slice(0, i)).moving);
          }
          const candidates = [false, ...flags];
          expect(got).toEqual(debounce(candidates, persistence));
        }
      ),
      { numRuns: 60 }
    );
  });
});
