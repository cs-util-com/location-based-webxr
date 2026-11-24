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
  type PoseStep,
  type TrackerEvent,
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

/** 1 over the jump limits, 0 under, `null` within the arc margin of them. */
function wantedJumps(step: PoseStep): number | null {
  if (
    step.translationM > JUMP_TRANSLATION_M + 0.005 ||
    step.rotationDeg > JUMP_ROTATION_DEG + 0.01
  )
    return 1;
  if (
    step.translationM < JUMP_TRANSLATION_M - 0.005 &&
    step.rotationDeg < JUMP_ROTATION_DEG - 0.01
  )
    return 0;
  return null;
}

/**
 * What steady motion may log: at most the first frame pair, which has no
 * rate (a fast turn passes the limits on its raw step), uncompensated and
 * never counted.
 */
function onlyTheUnratedStart(events: readonly TrackerEvent[], t1: number) {
  const left = events.filter(
    (e) =>
      e.kind !== 'session-end' &&
      !(
        e.kind === 'jump' &&
        e.t === t1 &&
        !e.compensated &&
        e.notCounted !== null
      )
  );
  return { left, total: events.length };
}

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
          // The step D leaves at the camera, against the perfectly
          // extrapolated pose (the motion is a constant body step, so that
          // is the next track pose). The compensation misses it by under
          // 2 mm (the arc), so near the limit either answer is right.
          const atCamera = poseStep(
            cams[JUMP_AT]!,
            composeRigid(d, cams[JUMP_AT]!)
          );
          expect(jumps).toHaveLength(wantedJumps(atCamera) ?? jumps.length);
          expect(jumps.length).toBeLessThanOrEqual(1);
          for (const jump of jumps) {
            const want = followsD ? 'frame switch' : 'drift correction';
            expect(jump.truncated).toBe(false);
            expect(jump.notCounted).toBeNull();
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
          tracker.noteSession('end', 500);
          const { left, total } = onlyTheUnratedStart(tracker.events(), 16);
          expect(left).toEqual([]);
          expect(total).toBeLessThanOrEqual(2);
        }
      )
    );
  });

  // Why this matters: real frames are neither evenly spaced nor noise-free.
  // Steady motion up to 3 m/s and 300 deg/s, with millimetre and tenth-of-a
  // degree pose noise and frame times between 16 and 33 ms (an
  // extrapolation ratio up to about 2), must still log nothing.
  it('logs nothing for steady motion with pose noise and uneven frame times', () => {
    const FRAMES_N = 40;
    const rot = (a: Pose['rotation'], b: Pose['rotation']) =>
      composeRigid(
        { position: [0, 0, 0], rotation: a },
        { position: [0, 0, 0], rotation: b }
      ).rotation;
    const axisTurn = (axis: Pose['position'], deg: number) => {
      const n = Math.hypot(...axis);
      const h = (deg * Math.PI) / 360;
      const s = Math.sin(h) / n;
      return [
        axis[0] * s,
        axis[1] * s,
        axis[2] * s,
        Math.cos(h),
      ] as Pose['rotation'];
    };
    fc.assert(
      fc.property(
        anyPose(3),
        position(3).filter((v) => Math.hypot(...v) <= 3),
        position(1).filter((a) => Math.hypot(...a) > 0.1),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.array(fc.integer({ min: 16, max: 33 }), {
          minLength: FRAMES_N,
          maxLength: FRAMES_N,
        }),
        fc.array(
          fc.record({ position: position(0.003), rotation: smallTurn(0.15) }),
          { minLength: FRAMES_N, maxLength: FRAMES_N }
        ),
        (start, velocity, axis, degPerS, dts, noise) => {
          const tracker = createAnchorJumpTracker();
          let t = 0;
          for (let i = 0; i < FRAMES_N; i++) {
            t += dts[i]!;
            const s = t / 1000;
            const n = noise[i]!;
            tracker.onFrame({
              t,
              camera: {
                position: [
                  start.position[0] + velocity[0] * s + n.position[0],
                  start.position[1] + velocity[1] * s + n.position[1],
                  start.position[2] + velocity[2] * s + n.position[2],
                ],
                rotation: rot(
                  rot(start.rotation, axisTurn(axis, degPerS * s)),
                  n.rotation
                ),
              },
              anchor: null,
              anchorTracked: null,
              marker: null,
            });
          }
          tracker.noteSession('end', t);
          const t1 = dts[0]! + dts[1]!;
          const { left, total } = onlyTheUnratedStart(tracker.events(), t1);
          expect(left).toEqual([]);
          expect(total).toBeLessThanOrEqual(2);
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
