import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import { composeRigid } from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import { FRAME_JUMP_THRESHOLD_M } from 'gps-plus-slam-app-framework/ar/deferred-anchors';
import {
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  FRAME_GAP_MS,
  RELOCALIZATION_RULE_M,
  SETTLE_FRAMES,
  VERDICT_TOLERANCES,
  classifyAnchor,
  classifyStep,
  createAnchorJumpTracker,
  poseStep,
  type FrameSample,
  type JumpEvent,
  type TrackerEvent,
} from './anchor-jump-tracker';

const yaw = (deg: number): Pose['rotation'] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};
const pose = (x: number, y: number, z: number, yawDeg = 0): Pose => ({
  position: [x, y, z],
  rotation: yaw(yawDeg),
});

/** A camera walking along -z at `speed` m per frame, 33 ms apart. */
function walk(
  frames: number,
  opts: { t0?: number; z0?: number; speed?: number; anchor?: Pose | null } = {}
): FrameSample[] {
  const { t0 = 0, z0 = 0, speed = 0.04, anchor = null } = opts;
  return Array.from({ length: frames }, (_, i) => ({
    t: t0 + i * 33,
    camera: pose(0, 1.5, z0 - i * speed),
    anchor,
    marker: anchor,
  }));
}

function feed(samples: readonly FrameSample[]): TrackerEvent[] {
  const tracker = createAnchorJumpTracker();
  const out: TrackerEvent[] = [];
  for (const s of samples) out.push(...tracker.onFrame(s));
  out.push(...tracker.flush());
  return out;
}

describe('thresholds', () => {
  // Why this matters: the spike exists to measure steps BELOW the shared 1 m
  // rule; if the two constants drifted apart the "0.3-1 m" band would lie.
  it('reports against the same 1 m rule the deferred anchors use', () => {
    expect(RELOCALIZATION_RULE_M).toBe(FRAME_JUMP_THRESHOLD_M);
  });

  // Why this matters: the spec fixes the logging limits and the gap rule; a
  // silent edit would change what the phone log means.
  it('pins the logging limits, the gap rule and the tolerance ladder', () => {
    expect(JUMP_TRANSLATION_M).toBe(0.25);
    expect(JUMP_ROTATION_DEG).toBe(5);
    expect(FRAME_GAP_MS).toBe(500);
    expect(VERDICT_TOLERANCES.tight.positionM).toBeLessThan(
      VERDICT_TOLERANCES.main.positionM
    );
    expect(VERDICT_TOLERANCES.main.positionM).toBeLessThan(
      VERDICT_TOLERANCES.loose.positionM
    );
    expect(VERDICT_TOLERANCES.tight.rotationDeg).toBeLessThan(
      VERDICT_TOLERANCES.loose.rotationDeg
    );
  });
});

describe('poseStep and classifyStep', () => {
  // Why this matters: every logged step is this distance; q and -q are the
  // same rotation and must read as 0 deg.
  it('measures translation in metres and rotation in degrees, sign-free', () => {
    const a = pose(0, 0, 0, 10);
    const b: Pose = {
      position: [3, 4, 0],
      rotation: [
        -a.rotation[0],
        -a.rotation[1],
        -a.rotation[2],
        -a.rotation[3],
      ],
    };
    const s = poseStep(a, b);
    expect(s.translationM).toBeCloseTo(5, 12);
    expect(s.rotationDeg).toBeCloseTo(0, 6);
    expect(
      poseStep(pose(0, 0, 0, 0), pose(0, 0, 0, 30)).rotationDeg
    ).toBeCloseTo(30, 9);
  });

  // Why this matters: the bands are what the spike reports (rotation steps
  // and 0.3-1 m steps decide follow-up work), so each edge is pinned.
  it('bands a step by its size', () => {
    expect(classifyStep({ translationM: 0.1, rotationDeg: 8 })).toBe(
      'rotation only'
    );
    expect(classifyStep({ translationM: 0.27, rotationDeg: 0 })).toBe(
      'under 0.3 m'
    );
    expect(classifyStep({ translationM: 0.3, rotationDeg: 0 })).toBe('0.3-1 m');
    expect(classifyStep({ translationM: 0.99, rotationDeg: 0 })).toBe(
      '0.3-1 m'
    );
    expect(classifyStep({ translationM: 1, rotationDeg: 0 })).toBe(
      'at least 1 m'
    );
  });
});

describe('classifyAnchor', () => {
  const tol = VERDICT_TOLERANCES.main;
  const before = pose(1, 0, -2);
  const predicted = pose(1.6, 0, -2.4, 4);

  // Why this matters: the three verdicts are the whole answer of the spike.
  it('says frame switch when the anchor follows D', () => {
    expect(classifyAnchor(before, pose(1.61, 0, -2.4, 4), predicted, tol)).toBe(
      'frame switch'
    );
  });
  it('says drift correction when the anchor stays put', () => {
    expect(classifyAnchor(before, pose(1.01, 0, -2), predicted, tol)).toBe(
      'drift correction'
    );
  });
  it('says unclear when the anchor is near neither', () => {
    expect(classifyAnchor(before, pose(3, 0, 0), predicted, tol)).toBe(
      'unclear'
    );
  });
  // Why this matters: a D too small to separate the two models must not be
  // credited to either.
  it('says unclear when the two predictions are within the tolerance', () => {
    const near = pose(1.02, 0, -2);
    expect(classifyAnchor(before, before, near, tol)).toBe('unclear');
  });
  // Why this matters: rotation counts too; a position match with a turned
  // anchor is not a match.
  it('needs the rotation inside the tolerance as well', () => {
    const turned: Pose = { ...predicted, rotation: yaw(4 + 20) };
    expect(classifyAnchor(before, turned, predicted, tol)).toBe('unclear');
  });
});

describe('createAnchorJumpTracker', () => {
  // Why this matters: normal walking must log nothing, or the jump list fills
  // with noise and the verdict count means nothing.
  it('logs no event for a smooth walk and keeps the frame statistics', () => {
    const tracker = createAnchorJumpTracker();
    for (const s of walk(50)) expect(tracker.onFrame(s)).toEqual([]);
    expect(tracker.flush()).toEqual([]);
    const stats = tracker.stats();
    expect(stats.frames).toBe(50);
    expect(stats.dtMs).toHaveLength(49);
    expect(stats.translationM[0]).toBeCloseTo(0.04, 12);
  });

  // Why this matters: the core case. ARCore shifts the whole frame; an anchor
  // that keeps its physical spot reads D * anchorBefore, and the marker keeps
  // its old coordinates.
  it('reads a frame switch from an anchor that follows the camera jump', () => {
    const anchor0 = pose(0.5, 0, -3, 0);
    const d = pose(0.6, 0, 0.2, 3);
    const before = walk(10, { anchor: anchor0 });
    const after = walk(15, { t0: 330, z0: -0.4, anchor: anchor0 }).map((s) => ({
      ...s,
      camera: composeRigid(d, s.camera!),
      anchor: composeRigid(d, anchor0),
    }));
    const events = feed([...before, ...after]);
    expect(events).toHaveLength(1);
    const jump = events[0] as JumpEvent;
    expect(jump.kind).toBe('jump');
    expect(jump.dtMs).toBe(33);
    expect(jump.atJump?.verdicts).toEqual({
      tight: 'frame switch',
      main: 'frame switch',
      loose: 'frame switch',
    });
    expect(jump.settled?.verdicts.main).toBe('frame switch');
    expect(jump.settledFrames).toBe(SETTLE_FRAMES);
    expect(jump.marker).toEqual(anchor0);
    // D recovered in the raw frame, with the walk compensated away.
    expect(poseStep(jump.d, d).translationM).toBeLessThan(1e-9);
    expect(
      poseStep(jump.predicted!, composeRigid(d, anchor0)).translationM
    ).toBeLessThan(1e-9);
  });

  // Why this matters: the competing model. The camera estimate is corrected,
  // the anchor keeps its coordinates.
  it('reads a drift correction from an anchor that stays put', () => {
    const anchor0 = pose(0.5, 0, -3, 0);
    const d = pose(0.6, 0, 0.2, 3);
    const before = walk(10, { anchor: anchor0 });
    const after = walk(15, { t0: 330, z0: -0.4, anchor: anchor0 }).map((s) => ({
      ...s,
      camera: composeRigid(d, s.camera!),
    }));
    const jump = feed([...before, ...after])[0] as JumpEvent;
    expect(jump.atJump?.verdicts.main).toBe('drift correction');
    expect(jump.settled?.verdicts.main).toBe('drift correction');
  });

  // Why this matters: an anchor that catches up a few frames late must still
  // be judged on its settled pose.
  it('judges the settled pose separately from the jump frame', () => {
    const anchor0 = pose(0.5, 0, -3, 0);
    const d = pose(0.8, 0, 0, 0);
    const before = walk(10, { anchor: anchor0 });
    const after = walk(15, { t0: 330, z0: -0.4, anchor: anchor0 }).map(
      (s, i) => ({
        ...s,
        camera: composeRigid(d, s.camera!),
        anchor: i < 3 ? anchor0 : composeRigid(d, anchor0),
      })
    );
    const jump = feed([...before, ...after])[0] as JumpEvent;
    expect(jump.atJump?.verdicts.main).toBe('drift correction');
    expect(jump.settled?.verdicts.main).toBe('frame switch');
  });

  // Why this matters: pure rotation steps are one of the three questions.
  it('logs a rotation-only step', () => {
    const samples = walk(10);
    samples.push({
      t: 330,
      camera: pose(0, 1.5, -0.4, 12),
      anchor: null,
      marker: null,
    });
    const jump = feed(samples)[0] as JumpEvent;
    expect(jump.stepClass).toBe('rotation only');
    expect(jump.atJump).toBeNull();
  });

  // Why this matters: a loss hides a jump from the per-frame rule; the step
  // across it must be logged, not silently dropped.
  it('logs the pose step across a tracking loss', () => {
    const anchor0 = pose(0, 0, -2);
    const samples: FrameSample[] = [
      ...walk(5, { anchor: anchor0 }),
      { t: 200, camera: null, anchor: null, marker: anchor0 },
      { t: 900, camera: null, anchor: null, marker: anchor0 },
      {
        t: 933,
        camera: pose(2, 1.5, 0),
        anchor: pose(2, 0, -2),
        marker: anchor0,
      },
      ...walk(5, { t0: 966, anchor: pose(2, 0, -2) }).map((s) => ({
        ...s,
        camera: pose(2, 1.5, 0),
      })),
    ];
    const events = feed(samples);
    expect(events.map((e) => e.kind)).toEqual(['tracking-loss']);
    const loss = events[0]!;
    if (loss.kind !== 'tracking-loss') throw new Error('kind');
    expect(loss.durationMs).toBe(933 - 132);
    expect(loss.cameraStep.translationM).toBeCloseTo(Math.hypot(2, 0.16), 9);
    expect(loss.anchorStep?.translationM).toBeCloseTo(2, 9);
  });

  // Why this matters: a long frame gap is "cannot judge", never a jump.
  it('logs a frame gap over the gap rule instead of a jump', () => {
    const samples = walk(5);
    samples.push({
      t: 132 + 600,
      camera: pose(0, 1.5, -1.5),
      anchor: null,
      marker: null,
    });
    const events = feed(samples);
    expect(events.map((e) => e.kind)).toEqual(['frame-gap']);
    if (events[0]!.kind !== 'frame-gap') throw new Error('kind');
    expect(events[0]!.dtMs).toBe(600);
  });

  // Why this matters: a second jump inside the settle window ends the first
  // record on the frame before the second jump, so each verdict sees only
  // its own jump.
  it('closes a pending jump early when the next one arrives', () => {
    const samples = walk(5);
    samples.push({
      t: 165,
      camera: pose(1, 1.5, -0.2),
      anchor: null,
      marker: null,
    });
    samples.push({
      t: 198,
      camera: pose(1, 1.5, -0.24),
      anchor: null,
      marker: null,
    });
    samples.push({
      t: 231,
      camera: pose(3, 1.5, -0.28),
      anchor: null,
      marker: null,
    });
    const events = feed(samples) as JumpEvent[];
    expect(events.map((e) => e.index)).toEqual([1, 2]);
    expect(events[0]!.settledFrames).toBe(1);
  });

  // Why this matters: a placement mid-walk is a log landmark and must not be
  // judged as part of an older jump.
  it('records a placement and closes a pending jump', () => {
    const tracker = createAnchorJumpTracker();
    for (const s of walk(5)) tracker.onFrame(s);
    tracker.onFrame({
      t: 165,
      camera: pose(1, 1.5, -0.2),
      anchor: null,
      marker: null,
    });
    const out = tracker.notePlaced(170, pose(0, 0, -1));
    expect(out.map((e) => e.kind)).toEqual(['jump', 'placed']);
  });

  // Why this matters: the copy button reads the log mid-walk; a snapshot
  // must include a still-settling jump without ending it.
  it('shows a pending jump in the snapshot without closing it', () => {
    const tracker = createAnchorJumpTracker();
    for (const s of walk(5)) tracker.onFrame(s);
    tracker.onFrame({
      t: 165,
      camera: pose(1, 1.5, -0.2),
      anchor: null,
      marker: null,
    });
    expect(tracker.snapshot().map((e) => e.kind)).toEqual(['jump']);
    expect(tracker.events()).toEqual([]);
  });

  // Why this matters: a duplicate or backwards frame time would give a
  // division by zero in the compensation; it is skipped, not trusted.
  it('ignores a frame whose time does not advance', () => {
    const tracker = createAnchorJumpTracker();
    tracker.onFrame({
      t: 0,
      camera: pose(0, 0, 0),
      anchor: null,
      marker: null,
    });
    expect(
      tracker.onFrame({
        t: 0,
        camera: pose(5, 0, 0),
        anchor: null,
        marker: null,
      })
    ).toEqual([]);
    expect(tracker.stats().dtMs).toEqual([]);
  });

  // Why this matters: the page hands over whatever WebXR gave it; a NaN pose
  // must not poison the statistics.
  it('treats a non-finite camera pose as a tracking loss', () => {
    const tracker = createAnchorJumpTracker();
    tracker.onFrame({
      t: 0,
      camera: pose(0, 0, 0),
      anchor: null,
      marker: null,
    });
    tracker.onFrame({
      t: 33,
      camera: pose(Number.NaN, 0, 0),
      anchor: null,
      marker: null,
    });
    const out = tracker.onFrame({
      t: 66,
      camera: pose(0, 0, 0),
      anchor: null,
      marker: null,
    });
    expect(out.map((e) => e.kind)).toEqual(['tracking-loss']);
  });
});
