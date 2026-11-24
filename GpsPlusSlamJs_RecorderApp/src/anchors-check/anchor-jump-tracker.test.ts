import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import { composeRigid } from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import { FRAME_JUMP_THRESHOLD_M } from 'gps-plus-slam-app-framework/ar/deferred-anchors';
import {
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  FRAME_GAP_MS,
  RELOCALIZATION_RULE_M,
  SETTLE_DELAYS_MS,
  VERDICT_TOLERANCES,
  classifyAnchor,
  classifyStep,
  createAnchorJumpTracker,
  poseStep,
  type EpisodeEvent,
  type FrameSample,
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

const FRAME_MS = 33;
/** Frames that cover the whole settle window after an episode. */
const SETTLE_SPAN = Math.ceil(SETTLE_DELAYS_MS.at(-1)! / FRAME_MS) + 2;

/** A camera walking along -z at `speed` m per frame, 33 ms apart. */
function walk(
  frames: number,
  opts: { t0?: number; z0?: number; speed?: number; anchor?: Pose | null } = {}
): FrameSample[] {
  const { t0 = 0, z0 = 0, speed = 0.04, anchor = null } = opts;
  return Array.from({ length: frames }, (_, i) => ({
    t: t0 + i * FRAME_MS,
    camera: pose(0, 1.5, z0 - i * speed),
    anchor,
    anchorTracked: anchor === null ? null : true,
    marker: anchor,
  }));
}

const bare = (t: number, camera: Pose | null): FrameSample => ({
  t,
  camera,
  anchor: null,
  anchorTracked: null,
  marker: null,
});

function feed(samples: readonly FrameSample[]): TrackerEvent[] {
  const tracker = createAnchorJumpTracker();
  for (const s of samples) tracker.onFrame(s);
  tracker.noteSession('end', samples.at(-1)?.t ?? 0);
  return [...tracker.events()];
}

const episodes = (events: readonly TrackerEvent[]): EpisodeEvent[] =>
  events.filter(
    (e): e is EpisodeEvent =>
      e.kind === 'jump' || e.kind === 'tracking-loss' || e.kind === 'frame-gap'
  );

/** A walk that jumps by `d` at frame 10, the anchor given per frame after. */
function jumpWalk(
  d: Pose,
  anchor0: Pose,
  anchorAfter: (i: number) => Pose | null,
  afterFrames = SETTLE_SPAN
): FrameSample[] {
  const before = walk(10, { anchor: anchor0 });
  const after = walk(afterFrames, {
    t0: 10 * FRAME_MS,
    z0: -0.4,
    anchor: anchor0,
  }).map((s, i) => ({
    ...s,
    camera: composeRigid(d, s.camera!),
    anchor: anchorAfter(i),
  }));
  return [...before, ...after];
}

describe('thresholds', () => {
  // Why this matters: the spike exists to measure steps BELOW the shared 1 m
  // rule; if the two constants drifted apart the "0.3-1 m" band would lie.
  it('reports against the same 1 m rule the deferred anchors use', () => {
    expect(RELOCALIZATION_RULE_M).toBe(FRAME_JUMP_THRESHOLD_M);
  });

  // Why this matters: the spec fixes the logging limits and the gap rule; the
  // settle delays are in ms so the window means the same at 30 and 60 Hz.
  it('pins the limits, the settle delays and the tolerance ladder', () => {
    expect(JUMP_TRANSLATION_M).toBe(0.25);
    expect(JUMP_ROTATION_DEG).toBe(5);
    expect(FRAME_GAP_MS).toBe(500);
    expect(SETTLE_DELAYS_MS).toEqual([100, 300, 1000, 2000]);
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

describe('jump detection', () => {
  // Why this matters: normal walking must log nothing, or the jump list fills
  // with noise and the verdict count means nothing.
  it('logs no event for a smooth walk and keeps the frame statistics', () => {
    const tracker = createAnchorJumpTracker();
    for (const s of walk(50)) expect(tracker.onFrame(s)).toEqual([]);
    const stats = tracker.stats();
    expect(stats.frames).toBe(50);
    expect(stats.dtMs).toHaveLength(49);
    expect(stats.translationM[0]).toBeCloseTo(0.04, 12);
    // The first pair has no rate yet, so 48 compensated pairs.
    expect(stats.unexplainedM).toHaveLength(48);
    expect(Math.max(...stats.unexplainedM)).toBeLessThan(1e-9);
  });

  // Why this matters: a quick wrist turn is 5 deg or more per frame at 30 Hz.
  // Judged on the raw step it reads as a jump, counts towards the stop rule
  // and closes a real jump's window; judged after the motion compensation it
  // is ordinary motion.
  it('logs no jump for a steady fast turn', () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      bare(i * FRAME_MS, pose(0, 1.5, 0, i * 6))
    );
    expect(feed(samples).filter((e) => e.kind === 'jump')).toEqual([]);
  });

  // Why this matters: a sudden turn with no motion before it is one of the
  // three questions of the spike (rotation-only steps).
  it('logs a sudden rotation-only step', () => {
    const samples = walk(10);
    samples.push(bare(330, pose(0, 1.5, -0.4, 12)));
    const [jump] = episodes(feed(samples));
    expect(jump?.kind).toBe('jump');
    expect(jump?.stepClass).toBe('rotation only');
    expect(jump?.readings[0]?.comparison).toBeNull();
  });

  // Why this matters: the log must allow recomputing the extrapolation
  // offline, so the frame before the jump's previous frame is logged too.
  it('logs the rate frame with each jump', () => {
    const d = pose(0.6, 0, 0.2, 3);
    const samples = jumpWalk(d, pose(0, 0, -3), () => null);
    const [jump] = episodes(feed(samples));
    expect(jump?.cameraBefore.t).toBe(9 * FRAME_MS);
    expect(jump?.cameraPrev?.t).toBe(8 * FRAME_MS);
    expect(jump?.cameraPrev?.pose).toEqual(samples[8]!.camera);
  });

  // Why this matters: after a jump the camera keeps its own speed; taking
  // the jump itself as velocity would log a second, false jump on the next
  // frame and truncate the first.
  it('logs one jump, not two, when the walk goes on after it', () => {
    const d = pose(0.6, 0, 0.2, 3);
    const events = episodes(feed(jumpWalk(d, pose(0, 0, -3), () => null)));
    expect(events).toHaveLength(1);
    expect(events[0]?.truncated).toBe(false);
  });
});

describe('anchor readings after a jump', () => {
  const anchor0 = pose(0.5, 0, -3, 0);
  const d = pose(0.6, 0, 0.2, 3);

  // Why this matters: the core case. ARCore shifts the whole frame; an anchor
  // that keeps its physical spot reads D * anchorBefore, and the marker keeps
  // its old coordinates.
  it('reads a frame switch at every delay from an anchor that follows D', () => {
    const [jump] = episodes(
      feed(jumpWalk(d, anchor0, () => composeRigid(d, anchor0)))
    );
    expect(jump?.kind).toBe('jump');
    expect(jump?.dtMs).toBe(FRAME_MS);
    expect(jump?.readings.map((r) => r.delayMs)).toEqual([
      0,
      ...SETTLE_DELAYS_MS,
    ]);
    for (const r of jump!.readings) {
      expect(r.atMs).toBeGreaterThanOrEqual(r.delayMs);
      expect(r.comparison?.verdicts).toEqual({
        tight: 'frame switch',
        main: 'frame switch',
        loose: 'frame switch',
      });
    }
    expect(jump?.marker).toEqual(anchor0);
    expect(poseStep(jump!.d, d).translationM).toBeLessThan(1e-9);
    expect(
      poseStep(jump!.predicted!, composeRigid(d, anchor0)).translationM
    ).toBeLessThan(1e-9);
  });

  // Why this matters: the competing model. The camera estimate is corrected,
  // the anchor keeps its coordinates.
  it('reads a drift correction from an anchor that stays put', () => {
    const [jump] = episodes(feed(jumpWalk(d, anchor0, () => anchor0)));
    expect(jump?.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'drift correction'
    );
  });

  // Why this matters: an anchor that catches up late must show as lagging
  // (drift first, frame switch later), not be misread at one fixed delay.
  it('shows a lagging anchor across the delays', () => {
    const lagFrames = Math.ceil(200 / FRAME_MS);
    const [jump] = episodes(
      feed(
        jumpWalk(d, anchor0, (i) =>
          i < lagFrames ? anchor0 : composeRigid(d, anchor0)
        )
      )
    );
    expect(jump?.readings.map((r) => r.comparison?.verdicts.main)).toEqual([
      'drift correction',
      'drift correction',
      'frame switch',
      'frame switch',
      'frame switch',
    ]);
  });

  // Why this matters: a lost anchor may keep returning its frozen last pose;
  // judged as a pose it reads as a false "drift correction".
  it('does not judge an anchor that WebXR reports as not tracked', () => {
    const samples = jumpWalk(d, anchor0, () => anchor0).map((s, i) =>
      i >= 10 ? { ...s, anchorTracked: false } : s
    );
    const [jump] = episodes(feed(samples));
    expect(jump?.readings).toHaveLength(SETTLE_DELAYS_MS.length + 1);
    for (const r of jump!.readings) {
      expect(r.tracked).toBe(false);
      expect(r.anchor).toEqual(anchor0);
      expect(r.comparison).toBeNull();
    }
  });

  // Why this matters: a second jump inside the window cuts the first one
  // short; its verdict then rests on fewer readings and must say so.
  it('marks a jump truncated when the next one comes inside its window', () => {
    const samples = jumpWalk(
      d,
      anchor0,
      () => composeRigid(d, anchor0),
      SETTLE_SPAN + 15
    );
    const d2 = pose(-0.8, 0, 0);
    for (let i = 22; i < samples.length; i++) {
      const s = samples[i]!;
      samples[i] = { ...s, camera: composeRigid(d2, s.camera!) };
    }
    const events = episodes(feed(samples));
    expect(events.map((e) => [e.index, e.truncated])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(events[0]!.readings.map((r) => r.delayMs)).toEqual([0, 100, 300]);
  });
});

describe('tracking losses and frame gaps', () => {
  // Why this matters: covering the camera is how the walker forces a loss;
  // the step across it gets the same settle window and verdict as a jump.
  it('judges the anchor after a tracking loss', () => {
    const anchor0 = pose(0, 0, -2);
    const shift = pose(2, 0, 0);
    const still = pose(0, 1.5, 0);
    const samples: FrameSample[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        ...bare(i * FRAME_MS, still),
        anchor: anchor0,
        anchorTracked: true,
        marker: anchor0,
      })),
      bare(200, null),
      bare(900, null),
      ...Array.from({ length: SETTLE_SPAN }, (_, i) => ({
        ...bare(933 + i * FRAME_MS, composeRigid(shift, still)),
        anchor: composeRigid(shift, anchor0),
        anchorTracked: true,
        marker: anchor0,
      })),
    ];
    const events = episodes(feed(samples));
    expect(events.map((e) => e.kind)).toEqual(['tracking-loss']);
    const loss = events[0]!;
    expect(loss.dtMs).toBe(933 - 132);
    expect(loss.cameraBefore.pose).toEqual(still);
    expect(loss.cameraPrev).toBeNull();
    expect(loss.cameraStep.translationM).toBeCloseTo(2, 9);
    expect(loss.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'frame switch'
    );
  });

  // Why this matters: a long frame gap is "cannot compensate", never a jump,
  // but the anchor across it is still judged.
  it('logs a frame gap over the gap rule, with a verdict', () => {
    const anchor0 = pose(0, 0, -2);
    const samples = walk(5, { anchor: anchor0 });
    samples.push(
      ...walk(SETTLE_SPAN, { t0: 132 + 600, z0: -1.5, anchor: anchor0 })
    );
    const events = episodes(feed(samples));
    expect(events.map((e) => e.kind)).toEqual(['frame-gap']);
    expect(events[0]!.dtMs).toBe(600);
    expect(events[0]!.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'drift correction'
    );
  });

  // Why this matters: the page hands over whatever WebXR gave it; a NaN pose
  // must not poison the statistics.
  it('treats a non-finite camera pose as a tracking loss', () => {
    const events = feed([
      bare(0, pose(0, 0, 0)),
      bare(33, pose(Number.NaN, 0, 0)),
      bare(66, pose(0, 0, 0)),
    ]);
    expect(episodes(events).map((e) => e.kind)).toEqual(['tracking-loss']);
  });
});

describe('the record around the episodes', () => {
  // Why this matters: the screen shows a still-settling episode as such; the
  // flag comes from the snapshot, which must not close the episode.
  it('flags the snapshot pending episode without closing it', () => {
    const tracker = createAnchorJumpTracker();
    for (const s of walk(5)) tracker.onFrame(s);
    tracker.onFrame(bare(165, pose(1, 1.5, -0.2)));
    const [shown] = episodes(tracker.snapshot());
    expect([shown?.pending, shown?.truncated]).toEqual([true, false]);
    expect(tracker.events()).toEqual([]);
    for (let i = 1; i <= SETTLE_SPAN; i++)
      tracker.onFrame(bare(165 + i * FRAME_MS, pose(1, 1.5, -0.2)));
    const [closed] = episodes(tracker.events());
    expect([closed?.pending, closed?.truncated]).toEqual([false, false]);
  });

  // Why this matters: a placement mid-window ends the older record, and a
  // jump right after a re-tap must not compare the old anchor with the new.
  it('truncates a pending jump on a placement and forgets the old anchor', () => {
    const tracker = createAnchorJumpTracker();
    const old = pose(0, 0, -1);
    for (const s of walk(5, { anchor: old })) tracker.onFrame(s);
    tracker.onFrame({ ...bare(165, pose(1, 1.5, -0.2)), anchor: old });
    const out = tracker.notePlaced(170, pose(0, 0, -3));
    expect(out.map((e) => e.kind)).toEqual(['jump', 'placed']);
    expect((out[0] as EpisodeEvent).truncated).toBe(true);
    tracker.onFrame({
      ...bare(198, pose(3, 1.5, -0.2)),
      anchor: pose(0, 0, -3),
    });
    const [second] = episodes(tracker.snapshot()).slice(1);
    expect(second?.kind).toBe('jump');
    expect(second?.anchorBefore).toBeNull();
  });

  // Why this matters: frames of two sessions are not consecutive; the first
  // frame of a new session must not be judged against the old one.
  it('starts frame continuity afresh after a session end', () => {
    const tracker = createAnchorJumpTracker();
    tracker.noteSession('start', 0);
    for (const s of walk(5)) tracker.onFrame(s);
    tracker.noteSession('end', 132);
    tracker.noteSession('start', 140);
    for (const s of walk(5, { t0: 150, z0: 10 })) tracker.onFrame(s);
    expect(tracker.events().map((e) => e.kind)).toEqual([
      'session-start',
      'session-end',
      'session-start',
    ]);
  });

  // Why this matters: a failed createAnchor and a frame that threw are part
  // of the answer and must reach the log.
  it('records anchor failures and frame errors', () => {
    const tracker = createAnchorJumpTracker();
    tracker.noteAnchorFailed(5, 'no plane');
    tracker.noteFrameError(6, 'boom');
    expect(tracker.events()).toEqual([
      { kind: 'anchor-failed', t: 5, message: 'no plane' },
      { kind: 'frame-error', t: 6, message: 'boom' },
    ]);
  });

  // Why this matters: a duplicate or backwards frame time would give a
  // division by zero in the compensation; it is skipped, not trusted.
  it('ignores a frame whose time does not advance', () => {
    const tracker = createAnchorJumpTracker();
    tracker.onFrame(bare(0, pose(0, 0, 0)));
    expect(tracker.onFrame(bare(0, pose(5, 0, 0)))).toEqual([]);
    expect(tracker.stats().dtMs).toEqual([]);
  });
});
