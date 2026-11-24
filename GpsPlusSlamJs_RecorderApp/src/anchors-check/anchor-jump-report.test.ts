import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  buildLog,
  countsLine,
  formatPose,
  onScreenLine,
  percentile,
  verdictCounts,
} from './anchor-jump-report';
import {
  SETTLE_DELAYS_MS,
  createAnchorJumpTracker,
  type EpisodeEvent,
  type FrameSample,
  type TrackerEvent,
  type Verdict,
} from './anchor-jump-tracker';

const pose = (x: number, y: number, z: number): Pose => ({
  position: [x, y, z],
  rotation: [0, 0, 0, 1],
});

const FRAME_MS = 33;
const SPAN = Math.ceil(SETTLE_DELAYS_MS.at(-1)! / FRAME_MS) + 2;

const sample = (t: number, x: number, anchor: Pose | null): FrameSample => ({
  t,
  camera: pose(x, 1.5, 0),
  anchor,
  anchorTracked: anchor === null ? null : true,
  marker: pose(0.4, 0, 0),
});

/**
 * A real tracker run: still camera, a 0.6 m jump in x after 5 frames, the
 * anchor following it (or staying), then `framesAfter` frames.
 */
function run(opts: {
  follows?: boolean;
  framesAfter?: number;
  anchor?: boolean;
}) {
  const { follows = true, framesAfter = SPAN, anchor = true } = opts;
  const a0 = anchor ? pose(0.4, 0, 0) : null;
  const a1 = anchor ? (follows ? pose(1, 0, 0) : a0) : null;
  const tracker = createAnchorJumpTracker();
  for (let i = 0; i < 5; i++) tracker.onFrame(sample(i * FRAME_MS, 0, a0));
  for (let i = 0; i < framesAfter; i++)
    tracker.onFrame(sample((5 + i) * FRAME_MS, 0.6, a1));
  return tracker;
}

const firstEpisode = (events: readonly TrackerEvent[]) =>
  events.find((e): e is EpisodeEvent => e.kind === 'jump')!;

/**
 * A real tracker run: walking 0.04 m per frame in x, the camera covered for
 * 600 ms, walking on; the anchor stays put. D is then just the walk.
 */
function walkingLoss() {
  const a0 = pose(0.4, 0, 0);
  const tracker = createAnchorJumpTracker();
  for (let i = 0; i < 5; i++)
    tracker.onFrame(sample(i * FRAME_MS, i * 0.04, a0));
  tracker.onFrame({ ...sample(165, 0, a0), camera: null });
  for (let i = 0; i < SPAN; i++)
    tracker.onFrame(sample(800 + i * FRAME_MS, 1 + i * 0.04, a0));
  return tracker
    .events()
    .find((e): e is EpisodeEvent => e.kind === 'tracking-loss')!;
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
  // must name the counted verdict, every delay's verdict and the band.
  it('names the final verdict, the verdict per delay and the band', () => {
    const jump = firstEpisode(run({}).events());
    expect(onScreenLine(jump)).toBe(
      'Jump 1: frame switch (0 ms switch, 100 ms switch, 300 ms switch, 1000 ms switch, 2000 ms switch); unexplained 0.60 m / 0.0 deg, 0.3-1 m'
    );
  });

  // Why this matters: the settling label must come from the real snapshot's
  // flag; a hand-built event cannot show that it is wired the right way.
  it('labels the snapshot pending episode as settling', () => {
    const tracker = run({ framesAfter: 5 });
    expect(onScreenLine(firstEpisode(tracker.snapshot()))).toMatch(
      /^Jump 1: settling, frame switch so far \(0 ms switch, 100 ms switch\)/
    );
  });

  // Why this matters: a cut-short verdict must not read as a full one.
  it('labels a truncated episode as not counted', () => {
    const tracker = run({ framesAfter: 5 });
    tracker.noteSession('end', 500);
    expect(onScreenLine(firstEpisode(tracker.events()))).toMatch(
      /^Jump 1: truncated, not counted \(frame switch at 100 ms\)/
    );
  });

  // Why this matters: a jump before any anchor exists says nothing about
  // anchors and must not read as a judged "unclear".
  it('says plainly when no anchor was tracked', () => {
    const jump = firstEpisode(run({ anchor: false }).events());
    expect(onScreenLine(jump)).toContain(': no anchor, not counted (');
    expect(onScreenLine(jump)).toContain('2000 ms none');
  });

  // Why this matters: a loss taken while walking is logged but its verdict
  // is the walk, not the anchor; the line must say it is not counted, and
  // give the raw step, since nothing was compensated.
  it('labels a moving loss as not counted, with its raw step', () => {
    // The log gives the motion over the window before it, and its shift
    // at the anchor over the loss.
    expect(buildLogFor(walkingLoss())).toContain(
      'stillness over 132 ms: 1.21 m/s / 0.0 deg/s; anchor 1.52 m away, moved 0.810 m by that motion over the episode'
    );
    expect(onScreenLine(walkingLoss())).toMatch(
      /^Tracking loss 1 \(0\.7 s\): moving, not counted \(drift correction\) \(.*\); raw step 0\.84 m \/ 0\.0 deg, 0\.3-1 m$/
    );
  });

  // Why this matters: each reason an episode is left out must read as such,
  // with the verdict it would have had.
  it('labels each reason an episode is not counted', () => {
    const fs = firstEpisode(run({}).events());
    for (const why of [
      'long frame',
      'unsteady rate',
      'no correction',
    ] as const) {
      expect(onScreenLine({ ...fs, notCounted: why })).toMatch(
        new RegExp(`^Jump 1: ${why}, not counted \\(frame switch\\) `)
      );
    }
  });

  it('describes losses, gaps, placements and notes', () => {
    const tracker = createAnchorJumpTracker();
    expect(onScreenLine(tracker.notePlaced(5, pose(0, 0, -1))[0]!)).toBe(
      'Anchor and marker placed'
    );
    expect(onScreenLine(tracker.noteAnchorFailed(6, 'no plane')[0]!)).toBe(
      'Could not create the anchor: no plane'
    );
    expect(onScreenLine(tracker.noteError('frame-error', 7, 'boom')[0]!)).toBe(
      'A frame failed: boom'
    );
    expect(
      onScreenLine(tracker.noteError('anchor-read-error', 7, 'gone')[0]!)
    ).toBe('An anchor read failed: gone');
    expect(onScreenLine(tracker.noteSession('start', 8)[0]!)).toBe(
      'AR session started'
    );
    const loss: EpisodeEvent = {
      ...firstEpisode(run({}).events()),
      kind: 'tracking-loss',
      dtMs: 1500,
    };
    expect(onScreenLine(loss)).toMatch(/^Tracking loss 1 \(1\.5 s\): /);
    expect(onScreenLine({ ...loss, kind: 'frame-gap', dtMs: 600 })).toMatch(
      /^Frame gap 1 \(600 ms\): /
    );
  });
});

describe('verdictCounts and countsLine', () => {
  // Why this matters: "two or more judged" is the stop condition of the
  // walk; truncated and still-settling episodes are not judged.
  it('counts only full episodes, by their final main verdict', () => {
    const fs = firstEpisode(run({}).events());
    const dc = firstEpisode(run({ follows: false }).events());
    const none = firstEpisode(run({ anchor: false }).events());
    const cut = run({ framesAfter: 5 });
    cut.noteSession('end', 500);
    const truncated = firstEpisode(cut.events());
    const pending = firstEpisode(run({ framesAfter: 5 }).snapshot());
    const long: EpisodeEvent = { ...fs, notCounted: 'long frame' };
    const unsteady: EpisodeEvent = { ...fs, notCounted: 'unsteady rate' };
    const counts = verdictCounts(
      [fs, fs, dc, none, truncated, pending, long, unsteady],
      'jump'
    );
    expect(counts).toEqual({
      judged: 3,
      'frame switch': 2,
      'drift correction': 1,
      unclear: 0,
      'no correction': 0,
      'unsteady rate': 1,
      'long frame': 1,
      moving: 0,
      'no anchor': 1,
      truncated: 1,
      settling: 1,
    } satisfies Record<
      | Verdict
      | 'judged'
      | 'no correction'
      | 'unsteady rate'
      | 'long frame'
      | 'moving'
      | 'no anchor'
      | 'truncated'
      | 'settling',
      number
    >);
    expect(verdictCounts([fs], 'tracking-loss').judged).toBe(0);
    // Why this matters: the walking loss reads "drift correction"; counted,
    // it would decide the spike's answer on an artefact.
    const moving = verdictCounts([walkingLoss()], 'tracking-loss');
    expect([moving.judged, moving['drift correction'], moving.moving]).toEqual([
      0, 0, 1,
    ]);
  });

  // Why this matters: the walker stops on this line, so it must say what
  // was logged but left out, and why, not only what was judged.
  it('says how many jumps and losses are judged and why others are not', () => {
    expect(countsLine([])).toBe('Nothing judged yet.');
    const fs = firstEpisode(run({}).events());
    expect(countsLine([fs, { ...fs, kind: 'tracking-loss' }])).toBe(
      'Judged: 1 jump (frame switch 1, drift correction 0, unclear 0); 1 tracking loss (frame switch 1, drift correction 0, unclear 0). Not counted: no correction 0, unsteady rate 0, long frame 0, moving 0, no anchor 0, truncated 0.'
    );
    const none = firstEpisode(run({ anchor: false }).events());
    expect(countsLine([none, walkingLoss()])).toBe(
      'Judged: 0 jumps (frame switch 0, drift correction 0, unclear 0); 0 tracking losses (frame switch 0, drift correction 0, unclear 0). Not counted: no correction 0, unsteady rate 0, long frame 0, moving 1, no anchor 1, truncated 0.'
    );
  });
});

const buildLogFor = (e: TrackerEvent) =>
  buildLog({
    nowIso: '2026-01-01T00:00:00.000Z',
    environment: {},
    events: [e],
    stats: createAnchorJumpTracker().stats(),
    anchorNow: null,
    anchorNowTracked: null,
    markerNow: null,
  });

describe('buildLog', () => {
  // Why this matters: the pasted log is the whole result of the walk; it
  // must carry the limits it was taken with, the distributions, and every
  // event with what an offline recompute needs: the rate frame, the camera
  // before and after, D, D * anchorBefore and each reading with its
  // tracked flag and verdicts.
  it('holds the header, the distributions and every event in full', () => {
    expect(buildLogFor(walkingLoss())).toContain(
      'tracking-loss 1: dt 668 ms, camera step 0.840 m / 0.00 deg, raw step, D uncompensated (0.3-1 m), not counted: moving'
    );
    const tracker = run({});
    tracker.noteAnchorFailed(3000, 'no plane');
    tracker.noteSession('end', 3100);
    const text = buildLog({
      nowIso: '2026-01-01T00:00:00.000Z',
      environment: { userAgent: 'UA', anchors: 'granted' },
      events: tracker.snapshot(),
      stats: tracker.stats(),
      anchorNow: pose(1, 0, 0),
      anchorNowTracked: true,
      markerNow: pose(0.4, 0, 0),
    });
    for (const needle of [
      'WebXR anchors check',
      'userAgent: UA',
      'anchors: granted',
      'jump logged when the step left after the motion compensation is above 0.25 m or 5 deg',
      'frame gap above 500 ms',
      'anchor read at 0, 100, 300, 1000, 2000 ms',
      'tight 0.05 m / 1.5 deg',
      'frame dt ms: p50 33.0',
      'unexplained step per steady frame m:',
      'jumps judged 1 (frame switch 1, drift correction 0, unclear 0); not counted: no correction 0, unsteady rate 0, long frame 0, moving 0, no anchor 0, truncated 0; settling 0',
      "counted: conservative by construction (the events below are the authoritative record to re-judge offline); a loss, a gap or a jump with no rate only when its raw step is over 0.25 m, the camera moved at most 0.3 m/s and 20 deg/s over the 100 ms before it, and that motion carried over the episode moves the anchor under 0.05 m; a jump with a rate only when the rate frame's own unexplained step is under 0.5 of the jump limits and the jump's frame is at most 1.5 times the one before",
      'poses: raw WebXR local space; D is motion-compensated for a jump on a frame with a rate (the rate frame is logged with it), else it is the raw step',
      'stillness over 132 ms: 0.00 m/s / 0.0 deg/s; anchor 1.55 m away',
      'rate frame: [t 99 ms] p=(0.000, 1.500, 0.000) q=(0.0000, 0.0000, 0.0000, 1.0000); its own unexplained step 0.000 m / 0.00 deg; extrapolation ratio 1.00',
      'anchor now (tracked yes): p=(1.000',
      'anchor to marker now: 0.600 m',
      'jump 1: dt 33 ms',
      'camera before: [t 132 ms] p=(0.000',
      'camera after: p=(0.600',
      'D: p=(0.600',
      'anchorBefore (tracked yes): p=(0.400',
      'D * anchorBefore: p=(1.000',
      'anchor at 0 ms (read at 0 ms, tracked yes): p=(1.000',
      'anchor at 2000 ms (read at 2013 ms, tracked yes)',
      'verdict tight frame switch, main frame switch, loose frame switch',
      'could not create the anchor: no plane',
      'session end',
    ]) {
      expect(text).toContain(needle);
    }
  });
});
