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
  SETTLE_DELAYS_MS,
  VERDICT_TOLERANCES,
  createAnchorJumpTracker,
  poseStep,
  type EpisodeEvent,
  type FrameSample,
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

const FRAME_MS = 33;
const JUMP_AT = 10;
const FRAMES = JUMP_AT + Math.ceil(SETTLE_DELAYS_MS.at(-1)! / FRAME_MS) + 2;

describe('anchor jump tracker properties', () => {
  // Why this matters: the verdict must name the model that produced the
  // data, for any jump big enough to tell the two apart, any anchor and any
  // smooth camera motion, at every delay. The camera's own motion must not
  // leak into D, and the walk after the jump must not log a second one.
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
          const cams = cameraTrack(start, motion, FRAMES);
          const samples: FrameSample[] = cams.map((camera, i) => {
            const after = i >= JUMP_AT;
            return {
              t: i * FRAME_MS,
              camera: after ? composeRigid(d, camera) : camera,
              anchor: after && followsD ? moved : anchor0,
              anchorTracked: true,
              marker: anchor0,
            };
          });
          const tracker = createAnchorJumpTracker();
          for (const s of samples) tracker.onFrame(s);
          tracker.noteSession('end', FRAMES * FRAME_MS);
          const jumps = tracker
            .events()
            .filter((e): e is EpisodeEvent => e.kind === 'jump');
          // A D that leaves the camera under the logging limits is not
          // logged; when it is, it is one jump with every verdict right.
          expect(jumps.length).toBeLessThanOrEqual(1);
          for (const jump of jumps) {
            const want = followsD ? 'frame switch' : 'drift correction';
            expect(jump.truncated).toBe(false);
            for (const r of jump.readings) {
              expect(r.comparison?.verdicts).toEqual({
                tight: want,
                main: want,
                loose: want,
              });
            }
            // The camera turns while it moves, so its path is an arc and the
            // linear extrapolation misses it by about step length times turn
            // angle (at most 0.052 m * 0.035 rad, under 2 mm here).
            expect(poseStep(jump.d, d).translationM).toBeLessThan(5e-3);
          }
        }
      )
    );
  });

  // Why this matters: the jump list is only readable if steady motion never
  // enters it, whatever its speed: a fast turn or a quick walk is motion the
  // compensation explains, not a jump.
  it('logs nothing for steady motion of any plausible speed', () => {
    fc.assert(
      fc.property(
        anyPose(3),
        fc.record({
          position: position(0.15),
          rotation: smallTurn(4 * JUMP_ROTATION_DEG),
        }),
        (start, motion) => {
          // The arc residual is about step length times turn angle per frame:
          // at most 0.26 m * 0.35 rad, under the translation limit.
          fc.pre(
            Math.hypot(...motion.position) *
              2 *
              Math.acos(Math.min(1, motion.rotation[3])) <
              JUMP_TRANSLATION_M / 2
          );
          const tracker = createAnchorJumpTracker();
          for (const [i, camera] of cameraTrack(start, motion, 30).entries()) {
            tracker.onFrame({
              t: i * 16,
              camera,
              anchor: null,
              anchorTracked: null,
              marker: null,
            });
          }
          expect(tracker.noteSession('end', 500)).toEqual([
            { kind: 'session-end', t: 500 },
          ]);
          expect(tracker.events().map((e) => e.kind)).toEqual(['session-end']);
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
