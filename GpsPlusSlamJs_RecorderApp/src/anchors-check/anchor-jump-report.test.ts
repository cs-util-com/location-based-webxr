import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  buildLog,
  formatPose,
  onScreenLine,
  percentile,
  verdictCounts,
} from './anchor-jump-report';
import {
  createAnchorJumpTracker,
  type JumpEvent,
  type TrackerEvent,
} from './anchor-jump-tracker';

const pose = (x: number, y: number, z: number): Pose => ({
  position: [x, y, z],
  rotation: [0, 0, 0, 1],
});

function jumpWith(
  main: 'frame switch' | 'drift correction' | 'unclear' | null,
  settled = true
): JumpEvent {
  const cmp =
    main === null
      ? null
      : {
          anchorAfter: pose(1, 0, 0),
          toPredicted: { translationM: 0.01, rotationDeg: 0.2 },
          toBefore: { translationM: 0.6, rotationDeg: 3 },
          verdicts: { tight: 'unclear' as const, main, loose: main },
        };
  return {
    kind: 'jump',
    index: 3,
    t: 1000,
    dtMs: 33,
    cameraBefore: pose(0, 1.5, 0),
    cameraAfter: pose(0.6, 1.5, 0),
    cameraStep: { translationM: 0.6, rotationDeg: 3.1 },
    stepClass: '0.3-1 m',
    d: pose(0.6, 0, 0),
    anchorBefore: pose(0.4, 0, 0),
    predicted: pose(1, 0, 0),
    marker: pose(0.4, 0, 0),
    atJump: cmp,
    settled: settled ? cmp : null,
    settledFrames: settled ? 10 : 0,
  };
}

describe('percentile', () => {
  // Why this matters: the noise floor for the jump guard is read off these
  // figures; nearest rank on a sorted copy, nothing for no data.
  it('uses nearest rank on a sorted copy and null for no data', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 100)).toBe(5);
    expect(percentile(values, 0)).toBe(1);
    expect(values).toEqual([5, 1, 4, 2, 3]);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('formatPose', () => {
  // Why this matters: the log is read by a person and parsed by eye; fixed
  // decimals keep columns comparable.
  it('prints millimetres and four quaternion decimals', () => {
    expect(formatPose(pose(1, -0.5, 2.12345))).toBe(
      'p=(1.000, -0.500, 2.123) q=(0.0000, 0.0000, 0.0000, 1.0000)'
    );
    expect(formatPose(null)).toBe('none');
  });
});

describe('onScreenLine', () => {
  // Why this matters: the on-screen verdict is what the walker watches; it
  // must name the settled main-tolerance verdict and the step band.
  it('names the settled verdict, the camera step and its band', () => {
    expect(onScreenLine(jumpWith('frame switch'))).toBe(
      'Jump 3: frame switch (camera 0.60 m / 3.1 deg, 0.3-1 m)'
    );
  });
  it('falls back to the jump-frame verdict while settling', () => {
    expect(onScreenLine(jumpWith('drift correction', false))).toContain(
      'drift correction (settling)'
    );
  });
  it('says plainly when no anchor was tracked', () => {
    expect(onScreenLine(jumpWith(null))).toContain('no anchor tracked');
  });
  it('describes losses, gaps and placements', () => {
    const tracker = createAnchorJumpTracker();
    expect(onScreenLine(tracker.notePlaced(5, pose(0, 0, -1))[0]!)).toBe(
      'Anchor and marker placed'
    );
    const loss: TrackerEvent = {
      kind: 'tracking-loss',
      tLost: 0,
      tRecovered: 1500,
      durationMs: 1500,
      cameraStep: { translationM: 2, rotationDeg: 1 },
      anchorBefore: null,
      anchorAfter: null,
      anchorStep: null,
    };
    expect(onScreenLine(loss)).toBe(
      'Tracking lost for 1.5 s, camera step 2.00 m / 1.0 deg'
    );
    expect(onScreenLine({ ...loss, kind: 'frame-gap', t: 1, dtMs: 600 })).toBe(
      'Frame gap of 600 ms, camera step 2.00 m / 1.0 deg'
    );
  });
});

describe('verdictCounts', () => {
  // Why this matters: "two or more jumps" is the stop condition of the walk.
  it('counts jumps by settled main verdict', () => {
    const counts = verdictCounts([
      jumpWith('frame switch'),
      jumpWith('frame switch'),
      jumpWith('drift correction'),
      jumpWith(null),
    ]);
    expect(counts).toEqual({
      jumps: 4,
      'frame switch': 2,
      'drift correction': 1,
      unclear: 1,
    });
  });
});

describe('buildLog', () => {
  // Why this matters: the pasted log is the whole result of the walk; it
  // must carry the limits it was taken with, the distributions, every event
  // with D * anchorBefore and the verdict at all three tolerances.
  it('holds the header, the distributions and every event in full', () => {
    const text = buildLog({
      nowIso: '2026-01-01T00:00:00.000Z',
      environment: { userAgent: 'UA', anchors: 'granted' },
      events: [jumpWith('frame switch')],
      stats: {
        frames: 3,
        lostFrames: 0,
        dtMs: [16, 33],
        translationM: [0.01, 0.02],
        rotationDeg: [0.1, 0.2],
      },
      anchorNow: pose(1, 0, 0),
      markerNow: pose(0.4, 0, 0),
    });
    for (const needle of [
      'WebXR anchors check',
      'userAgent: UA',
      'anchors: granted',
      'jump logged above 0.25 m or 5 deg',
      'frame gap above 500 ms',
      'tight 0.05 m / 1.5 deg',
      'frame dt ms: p50 16.0, p95 33.0',
      'jumps: 1 (frame switch 1, drift correction 0, unclear 0;',
      'anchor to marker now: 0.600 m',
      'jump 3',
      'D: p=(0.600',
      'D * anchorBefore: p=(1.000',
      'verdict tight unclear, main frame switch, loose frame switch',
      'settled after 10 frames',
    ]) {
      expect(text).toContain(needle);
    }
  });
});
