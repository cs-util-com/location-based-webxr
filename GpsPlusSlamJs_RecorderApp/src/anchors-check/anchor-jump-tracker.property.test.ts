import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  composeRigid,
  invertRigid,
} from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import {
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  VERDICT_TOLERANCES,
  createAnchorJumpTracker,
  poseStep,
  type FrameSample,
  type JumpEvent,
} from './anchor-jump-tracker';

const unitQuat = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => {
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n] as Pose['rotation'];
  });
const coord = (r: number) => fc.double({ min: -r, max: r, noNaN: true });
const position = (r: number) =>
  fc.tuple(coord(r), coord(r), coord(r)) as fc.Arbitrary<Pose['position']>;
const anyPose = (r: number) =>
  fc.record({ position: position(r), rotation: unitQuat });

/** A rotation of `deg` about a random axis. */
const smallTurn = (maxDeg: number) =>
  fc
    .tuple(
      position(1).filter((a) => Math.hypot(...a) > 0.1),
      fc.double({ min: 0, max: maxDeg, noNaN: true })
    )
    .map(([axis, deg]) => {
      const n = Math.hypot(...axis);
      const h = (deg * Math.PI) / 360;
      const s = Math.sin(h) / n;
      return [
        axis[0] * s,
        axis[1] * s,
        axis[2] * s,
        Math.cos(h),
      ] as Pose['rotation'];
    });

/**
 * A camera moving by the same body-frame step every frame: constant angular
 * rate, position on an arc (the compensation extrapolates it linearly).
 */
function cameraTrack(start: Pose, step: Pose, frames: number): Pose[] {
  const out: Pose[] = [start];
  for (let i = 1; i < frames; i++) out.push(composeRigid(out[i - 1]!, step));
  return out;
}

describe('anchor jump tracker properties', () => {
  // Why this matters: the verdict must name the model that produced the
  // data, for any jump big enough to tell the two apart, any anchor and any
  // smooth camera motion. The camera's own motion must not leak into D.
  it('names frame switch and drift correction for any separable jump', () => {
    fc.assert(
      fc.property(
        anyPose(3),
        fc.record({ position: position(0.03), rotation: smallTurn(2) }),
        anyPose(5),
        fc.record({ position: position(3), rotation: unitQuat }),
        fc.boolean(),
        (start, motion, anchor0, d, followsD) => {
          const moved = composeRigid(d, anchor0);
          const separation = poseStep(anchor0, moved);
          const tol = VERDICT_TOLERANCES.loose;
          fc.pre(
            separation.translationM > 2 * tol.positionM ||
              separation.rotationDeg > 2 * tol.rotationDeg
          );
          const cams = cameraTrack(start, motion, 20);
          const samples: FrameSample[] = cams.map((camera, i) => {
            const after = i >= 10;
            return {
              t: i * 33,
              camera: after ? composeRigid(d, camera) : camera,
              anchor: after && followsD ? moved : anchor0,
              marker: anchor0,
            };
          });
          const tracker = createAnchorJumpTracker();
          for (const s of samples) tracker.onFrame(s);
          tracker.flush();
          const jumps = tracker
            .events()
            .filter((e): e is JumpEvent => e.kind === 'jump');
          // A D that moves the camera less than the logging limits is not
          // logged; when it is, the verdict must be right at every tolerance.
          for (const jump of jumps) {
            const want = followsD ? 'frame switch' : 'drift correction';
            expect(jump.atJump?.verdicts).toEqual({
              tight: want,
              main: want,
              loose: want,
            });
            // The camera turns while it moves, so its path is an arc and the
            // linear extrapolation misses it by about step length times turn
            // angle (at most 0.052 m * 0.035 rad, under 2 mm here).
            expect(poseStep(jump.d, d).translationM).toBeLessThan(5e-3);
          }
        }
      )
    );
  });

  // Why this matters: the jump list is only readable if steady motion under
  // the limits never enters it.
  it('logs nothing for motion under the logging limits', () => {
    fc.assert(
      fc.property(
        anyPose(3),
        fc.record({
          position: position(JUMP_TRANSLATION_M / 2),
          rotation: smallTurn(JUMP_ROTATION_DEG * 0.9),
        }),
        (start, motion) => {
          const tracker = createAnchorJumpTracker();
          for (const [i, camera] of cameraTrack(start, motion, 30).entries()) {
            tracker.onFrame({ t: i * 16, camera, anchor: null, marker: null });
          }
          expect(tracker.flush()).toEqual([]);
          expect(tracker.events()).toEqual([]);
        }
      )
    );
  });

  // Why this matters: every logged distance is poseStep; it must be a
  // symmetric, frame-invariant metric, or before/after comparisons depend on
  // which pose came first or on where the session origin sits.
  it('poseStep is symmetric and invariant under a common rigid change', () => {
    fc.assert(
      fc.property(anyPose(10), anyPose(10), anyPose(10), (a, b, g) => {
        const ab = poseStep(a, b);
        const ba = poseStep(b, a);
        expect(ab.translationM).toBeCloseTo(ba.translationM, 9);
        expect(ab.rotationDeg).toBeCloseTo(ba.rotationDeg, 6);
        const ga = composeRigid(g, a);
        const gb = composeRigid(g, b);
        expect(poseStep(ga, gb).translationM).toBeCloseTo(ab.translationM, 6);
        expect(poseStep(ga, gb).rotationDeg).toBeCloseTo(ab.rotationDeg, 4);
        expect(
          poseStep(a, composeRigid(a, invertRigid(a))).translationM
        ).toBeGreaterThanOrEqual(0);
      })
    );
  });
});
