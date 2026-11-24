import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  composeRigid,
  invertRigid,
} from 'gps-plus-slam-app-framework/ar/ar-space-correction';
import { FRAME_JUMP_THRESHOLD_M } from 'gps-plus-slam-app-framework/ar/deferred-anchors';
import {
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  FRAME_GAP_MS,
  MAX_EXTRAPOLATION_RATIO,
  STILL_SPEED_M_PER_S,
  STILL_TURN_DEG_PER_S,
  STILL_WINDOW_MS,
  STILL_DISPLACEMENT_M,
  STEADY_RATE_FRACTION,
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
    expect(STILL_SPEED_M_PER_S).toBe(0.3);
    expect(STILL_TURN_DEG_PER_S).toBe(20);
    expect(STILL_WINDOW_MS).toBe(100);
    expect(STILL_DISPLACEMENT_M).toBe(VERDICT_TOLERANCES.main.positionM / 2);
    expect(STEADY_RATE_FRACTION).toBe(0.5);
    expect(MAX_EXTRAPOLATION_RATIO).toBe(1.5);
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
    // The first pair has no rate yet, and the second's rate frame had none
    // of its own, so 47 pairs on a steady rate.
    expect(stats.unexplainedM).toHaveLength(47);
    expect(Math.max(...stats.unexplainedM)).toBeLessThan(1e-9);
  });

  // Why this matters: a quick wrist turn is 5 deg or more per frame at 30 Hz.
  // Judged on the raw step it reads as a jump, counts towards the stop rule
  // and closes a real jump's window; judged after the motion compensation it
  // is ordinary motion. Only the first pair has no rate: it is logged, but
  // with no translation it proves no correction and is not counted.
  it('logs no compensated jump for a steady fast turn', () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      bare(i * FRAME_MS, pose(0, 1.5, 0, i * 6))
    );
    expect(notCountedOf(samples)).toEqual([[FRAME_MS, false, 'no correction']]);
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
    // How well the rate frame was itself extrapolated, for the steady rule.
    expect(jump?.rateUnexplainedStep?.translationM).toBeLessThan(1e-9);
  });

  // Why this matters: after a jump the camera keeps its own speed; taking
  // the jump itself as velocity would log a second, false jump on the next
  // frame and truncate the first.
  it('logs one jump, not two, when the walk goes on after it', () => {
    const d = pose(0.6, 0, 0.2, 3);
    const events = episodes(feed(jumpWalk(d, pose(0, 0, -3), () => null)));
    expect(events).toHaveLength(1);
    expect(events[0]?.truncated).toBe(false);
    expect(events[0]?.compensated).toBe(true);
    expect(events[0]?.notCounted).toBeNull();
  });

  // Why this matters: D's own translation grows with the distance from the
  // session origin; a 3 deg turn of a camera 20 m out moves the origin by
  // about 1 m. Detection must read the step at the camera (0 m, 3 deg), or
  // every small glitch far from the start reads as a big jump.
  it('judges a turn far from the origin at the camera, not by D', () => {
    const before = pose(20, 1.5, 0, 0);
    const after = pose(20, 1.5, 0, 3);
    const d = composeRigid(after, invertRigid(before));
    expect(Math.hypot(...d.position)).toBeGreaterThan(JUMP_TRANSLATION_M);
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => bare(i * FRAME_MS, before)),
      ...Array.from({ length: 10 }, (_, i) => bare((10 + i) * FRAME_MS, after)),
    ];
    expect(episodes(feed(samples))).toEqual([]);
  });

  // Why this matters: the compensation extrapolates the last frame interval
  // over the new one. Over a 200 ms stall at 30 Hz (6 times the interval)
  // the onset of a turn, 300 deg/s^2, leaves about 7 deg unexplained: logged
  // in full, but never counted as a verdict.
  it('does not count a jump that a long frame alone can explain', () => {
    const turn = (t: number) => 0.5 * 300 * (t / 1000) ** 2;
    const times = [0, 33, 66, 99, 132, 165, 365];
    const samples = times.map((t) => bare(t, pose(0, 1.5, 0, turn(t))));
    for (let i = 1; i <= SETTLE_SPAN; i++)
      samples.push(bare(365 + i * FRAME_MS, pose(0, 1.5, 0, turn(365))));
    const events = episodes(feed(samples));
    expect(events).toHaveLength(1);
    const jump = events[0]!;
    expect(jump.kind).toBe('jump');
    expect(jump.unexplainedStep.rotationDeg).toBeGreaterThan(JUMP_ROTATION_DEG);
    expect(jump.dtMs / (jump.cameraBefore.t - jump.cameraPrev!.t)).toBeCloseTo(
      200 / 33,
      9
    );
    expect(jump.notCounted).toBe('long frame');
  });

  // Why this matters: the first frame after a start, a loss or a gap has no
  // rate. A real jump there is logged as such (uncompensated). The next
  // frame reads it as velocity and misses by the jump again: that echo is
  // logged too, but its rate frame was never extrapolated, so it never
  // counts.
  it('logs a jump on the first frame after a start, uncompensated, its echo not counted', () => {
    const shifted = pose(0.8, 1.5, 0);
    const samples = [
      bare(0, pose(0, 1.5, 0)),
      ...hold(FRAME_MS, SETTLE_SPAN, shifted),
    ];
    // No 100 ms before it are known, so it is not shown to be still.
    expect(notCountedOf(samples)).toEqual([
      [FRAME_MS, false, 'moving'],
      [2 * FRAME_MS, true, 'unsteady rate'],
    ]);
    expect(episodes(feed(samples))[0]!.cameraPrev).toBeNull();
  });

  it('logs a jump on the first frame after a loss, uncompensated', () => {
    const still = pose(0, 1.5, 0);
    const shifted = pose(0.8, 1.5, 0);
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => bare(i * FRAME_MS, still)),
      bare(200, null),
      bare(900, null),
      bare(933, still),
      ...Array.from({ length: SETTLE_SPAN }, (_, i) =>
        bare(966 + i * FRAME_MS, shifted)
      ),
    ];
    const events = episodes(feed(samples));
    expect(events.map((e) => [e.kind, e.t, e.truncated, e.notCounted])).toEqual(
      [
        ['tracking-loss', 933, true, 'no correction'],
        ['jump', 966, true, 'moving'],
        ['jump', 999, false, 'unsteady rate'],
      ]
    );
    expect(events[1]!.compensated).toBe(false);
    expect(events[1]!.cameraStep.translationM).toBeCloseTo(0.8, 9);
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
    // The window before the loss start, for the stillness check.
    expect(loss.stillness).toEqual({
      spanMs: 132,
      speedMPerS: 0,
      turnDegPerS: 0,
      anchorDistanceM: 2.5,
      displacementM: 0,
    });
    expect(loss.cameraPrev).toBeNull();
    expect(loss.compensated).toBe(false);
    expect(loss.notCounted).toBeNull();
    expect(loss.cameraStep.translationM).toBeCloseTo(2, 9);
    expect(loss.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'frame switch'
    );
  });

  // Why this matters: across a loss D is uncompensated, so while the walker
  // moves D is just the walk, and an anchor that stays put reads as a
  // "drift correction" that never happened. Such a loss is logged in full
  // (with the frame before it) but not counted.
  it('does not count a tracking loss taken while walking', () => {
    const anchor0 = pose(0, 0, -2);
    const samples = [
      ...walk(5, { anchor: anchor0 }),
      bare(200, null),
      ...walk(SETTLE_SPAN, { t0: 800, z0: -1, anchor: anchor0 }),
    ];
    const [loss] = episodes(feed(samples));
    expect(loss?.kind).toBe('tracking-loss');
    expect(loss?.stillness?.speedMPerS).toBeCloseTo(0.16 / 0.132, 9);
    expect(loss?.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'drift correction'
    );
    expect(loss?.notCounted).toBe('moving');
  });

  // Why this matters: a long frame gap is "cannot compensate", never a jump.
  // The same stillness rule as for a loss decides whether its verdict counts.
  it('logs a frame gap over the gap rule, counted only when still', () => {
    const anchor0 = pose(0, 0, -2);
    const walking = walk(5, { anchor: anchor0 });
    walking.push(
      ...walk(SETTLE_SPAN, { t0: 132 + 600, z0: -1.5, anchor: anchor0 })
    );
    const [moving] = episodes(feed(walking));
    expect([moving?.kind, moving?.dtMs, moving?.notCounted]).toEqual([
      'frame-gap',
      600,
      'moving',
    ]);
    const still = walk(5, { anchor: anchor0, speed: 0 });
    // Still before, and the world 0.5 m off after: a correction.
    still.push(
      ...walk(SETTLE_SPAN, { t0: 732, z0: -0.5, speed: 0, anchor: anchor0 })
    );
    const [gap] = episodes(feed(still));
    expect(gap?.kind).toBe('frame-gap');
    expect(gap?.notCounted).toBeNull();
    expect(gap?.readings.at(-1)?.comparison).not.toBeNull();
  });

  // Why this matters: stillness is a speed, not a step per frame. A slow
  // 1 m/s walk at 60 Hz moves under 0.02 m per frame; judged per frame it
  // would pass as still and its loss would count as a false verdict.
  it('reads stillness as a speed, the same at 30 and 60 Hz', () => {
    /**
     * A one-frame loss after 150 ms at `frameMs`, moving at `mPerS` along -z;
     * the world 1 m off after it. The loss is short, so the motion carried
     * over it stays under the displacement limit and the speed decides.
     */
    const lossAfter = (frameMs: number, mPerS: number, degPerS = 0) => {
      const n = Math.ceil(150 / frameMs);
      const s: FrameSample[] = Array.from({ length: n }, (_, i) =>
        bare(
          i * frameMs,
          pose(
            0,
            1.5,
            (-mPerS * i * frameMs) / 1000,
            (degPerS * i * frameMs) / 1000
          )
        )
      );
      s.push(
        bare(n * frameMs, null),
        ...hold((n + 1) * frameMs, SETTLE_SPAN, pose(1, 1.5, 0))
      );
      return episodes(feed(s))[0]?.notCounted;
    };
    expect(lossAfter(1000 / 60, 1)).toBe('moving');
    expect(lossAfter(1000 / 30, 1)).toBe('moving');
    expect(lossAfter(1000 / 60, 0)).toBeNull();
    expect(lossAfter(1000 / 30, 0)).toBeNull();
    // The edges, at both rates.
    for (const frameMs of [1000 / 30, 1000 / 60]) {
      expect(lossAfter(frameMs, STILL_SPEED_M_PER_S * 0.9)).toBeNull();
      expect(lossAfter(frameMs, STILL_SPEED_M_PER_S * 1.1)).toBe('moving');
      expect(lossAfter(frameMs, 0, STILL_TURN_DEG_PER_S * 0.9)).toBeNull();
      expect(lossAfter(frameMs, 0, STILL_TURN_DEG_PER_S * 1.1)).toBe('moving');
    }
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

/** `count` frames `frameMs` apart from `t0`, all at `camera`. */
function hold(
  t0: number,
  count: number,
  camera: Pose,
  anchor: Pose | null = null,
  frameMs = FRAME_MS
): FrameSample[] {
  return Array.from({ length: count }, (_, i) => ({
    ...bare(t0 + i * frameMs, camera),
    anchor,
    anchorTracked: anchor === null ? null : true,
    marker: anchor,
  }));
}

const notCountedOf = (samples: readonly FrameSample[]) =>
  episodes(feed(samples)).map((e) => [e.t, e.compensated, e.notCounted]);

describe('what is counted: never wrong, not complete', () => {
  // Why this matters: a frame with no rate that jumps is logged at once.
  // The next frame is judged on its own, so a second real jump there is
  // logged (not swallowed as the first one's echo), and since its rate
  // frame was never extrapolated itself, neither it nor its echo counts.
  it('logs a second real jump on the frame after an unrated jump, counting none', () => {
    const samples = [
      bare(0, pose(0, 1.5, 0)),
      bare(33, pose(0.8, 1.5, 0)),
      ...hold(66, SETTLE_SPAN, pose(0.8, 1.5, 0.8)),
    ];
    expect(notCountedOf(samples)).toEqual([
      [33, false, 'moving'],
      [66, true, 'unsteady rate'],
      [99, true, 'unsteady rate'],
    ]);
  });

  // Why this matters: a correction under the limits on a frame with no rate
  // is not logged, but the next frame extrapolates it as velocity and misses
  // by more than the limits. That echo must not count as a jump.
  it('does not count the echo of a step under the limits on a frame with no rate', () => {
    const samples = [
      bare(0, pose(0, 1.5, 0)),
      bare(33, pose(0.2, 1.5, 0)),
      ...hold(66, SETTLE_SPAN, pose(0.1, 1.5, 0)),
    ];
    expect(notCountedOf(samples)).toEqual([[66, true, 'unsteady rate']]);
  });

  // Why this matters: a 0.2 m correction is under the limits, but it is in
  // the rate of the next frame; over a frame twice as long it is
  // extrapolated into a 0.4 m "jump" that never happened.
  it('does not count a jump whose rate frame held a correction under the limits', () => {
    const samples = [
      ...hold(0, 10, pose(0, 1.5, 0)),
      bare(330, pose(0.2, 1.5, 0)),
      ...hold(396, SETTLE_SPAN, pose(0.2, 1.5, 0)),
    ];
    expect(notCountedOf(samples)).toEqual([[396, true, 'unsteady rate']]);
    const [jump] = episodes(feed(samples));
    expect(jump?.rateUnexplainedStep?.translationM).toBeCloseTo(0.2, 9);
  });

  // Why this matters: with no correction across a loss, D is only what the
  // camera did meanwhile. A 1 deg tilt turns an anchor 10 m away by 0.18 m:
  // the anchor that stays reads "drift correction" for nothing.
  it('does not count a still loss with no correction, a 1 deg tilt and the anchor 10 m away', () => {
    const camera = pose(0, 1.5, 0);
    const h = Math.PI / 360;
    const tilted: Pose = {
      position: camera.position,
      rotation: [Math.sin(h), 0, 0, Math.cos(h)],
    };
    const anchor = pose(0, 0, -10);
    const samples = [
      ...hold(0, 10, camera, anchor),
      bare(330, null),
      ...hold(600, SETTLE_SPAN, tilted, anchor),
    ];
    const [loss] = episodes(feed(samples));
    expect(loss?.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'drift correction'
    );
    expect(loss?.notCounted).toBe('no correction');
  });

  // Why this matters: the comparator edge. A frame exactly 1.5 times the
  // one before is counted, one just over it is not.
  it('counts a jump over a frame 1.5 times the one before, not over a longer one', () => {
    const at = (dtMs: number) =>
      notCountedOf([
        ...hold(0, 10, pose(0, 1.5, 0), null, 40),
        ...hold(360 + dtMs, SETTLE_SPAN, pose(0.5, 1.5, 0)),
      ]).map((e) => e[2]);
    expect(at(60)).toEqual([null]);
    expect(at(61)).toEqual(['long frame']);
  });

  // Why this matters: one still frame pair says little; the camera must be
  // seen still over at least 100 ms before the loss.
  it('needs 100 ms of still frames before a loss, not one still pair', () => {
    const lossAfter = (count: number) =>
      notCountedOf([
        ...hold(0, count, pose(0, 1.5, 0)),
        bare(count * FRAME_MS, null),
        ...hold(800, SETTLE_SPAN, pose(1, 1.5, 0)),
      ]).map((e) => e[2]);
    expect(lossAfter(3)).toEqual(['moving']);
    expect(lossAfter(5)).toEqual([null]);
  });

  // Why this matters: over a loss the camera's own motion goes into D. A
  // 2 deg/s drift over 300 ms moves an anchor 10 m away by 0.1 m, enough to
  // decide the verdict alone; with the anchor 1 m away it moves 0.01 m.
  it('does not count a loss whose slow motion alone would move the anchor', () => {
    const lossWith = (anchorZ: number) => {
      const anchor = pose(0, 1.5, anchorZ);
      const turning = Array.from({ length: 10 }, (_, i) => ({
        ...bare(i * FRAME_MS, pose(0, 1.5, 0, (2 * i * FRAME_MS) / 1000)),
        anchor,
        anchorTracked: true,
        marker: anchor,
      }));
      return notCountedOf([
        ...turning,
        bare(330, null),
        ...hold(600, SETTLE_SPAN, pose(1, 1.5, 0), anchor),
      ]).map((e) => e[2]);
    };
    expect(lossWith(-10)).toEqual(['moving']);
    expect(lossWith(-1)).toEqual([null]);
  });

  // Why this matters: the unexplained-step distributions are the noise floor
  // the jump limits are read against; a jump frame, or a frame whose rate
  // held a jump, would put the jump itself into it.
  it('keeps jump frames and their echoes out of the noise floor', () => {
    const statsOf = (samples: readonly FrameSample[]) => {
      const tracker = createAnchorJumpTracker();
      for (const s of samples) tracker.onFrame(s);
      return Math.max(...tracker.stats().unexplainedM);
    };
    expect(
      statsOf(jumpWalk(pose(0.6, 0, 0.2, 3), pose(0, 0, -3), () => null))
    ).toBeLessThan(1e-9);
    expect(
      statsOf([
        bare(0, pose(0, 1.5, 0)),
        bare(33, pose(0.2, 1.5, 0)),
        ...hold(66, 10, pose(0.1, 1.5, 0)),
      ])
    ).toBeLessThan(1e-9);
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
    tracker.noteError('frame-error', 6, 'boom');
    tracker.noteError('anchor-read-error', 7, 'gone');
    expect(tracker.events()).toEqual([
      { kind: 'anchor-failed', t: 5, message: 'no plane' },
      { kind: 'frame-error', t: 6, message: 'boom' },
      { kind: 'anchor-read-error', t: 7, message: 'gone' },
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
