import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGHTING_GAP_MS,
  createQrSightingAccumulator,
  type QrSightingObservation,
} from './qr-sighting-accumulator.js';
import type { Matrix4 as AlignmentMatrix } from '../../core/index.js';

const IDENTITY: AlignmentMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
const ZERO = { lat: 48, lon: 11 };
const TEXT = 'https://gps.csutil.com/?qr=tour';

function obs(
  timestamp: number,
  overrides: Partial<QrSightingObservation> = {}
): QrSightingObservation {
  return {
    text: TEXT,
    timestamp,
    odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    sizeM: 0.16,
    alignmentMatrix: IDENTITY,
    zero: ZERO,
    alignmentSampleCount: 5,
    ...overrides,
  };
}

describe('createQrSightingAccumulator — bursts', () => {
  it('folds one burst of detections into one sighting', () => {
    // Why this test matters: the recorder's detection ring holds the last 100
    // entries, which at the default cadence is ~12 seconds. A three-minute
    // walk with ten sightings would lose every early one, so the mint cannot
    // read the ring at save time - it has to fold as detections arrive.
    const acc = createQrSightingAccumulator();
    for (let i = 0; i < 20; i += 1) acc.observe(obs(1000 + i * 125));
    acc.flush();

    const sightings = acc.sightings(TEXT);
    expect(sightings).toHaveLength(1);
    expect(sightings[0]?.detectionCount).toBe(20);
    expect(sightings[0]?.firstTimestamp).toBe(1000);
    expect(sightings[0]?.lastTimestamp).toBe(1000 + 19 * 125);
  });

  it('splits bursts separated by more than the gap', () => {
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    acc.observe(obs(125));
    acc.observe(obs(125 + DEFAULT_SIGHTING_GAP_MS + 1));
    acc.observe(obs(125 + DEFAULT_SIGHTING_GAP_MS + 200));
    acc.flush();

    const sightings = acc.sightings(TEXT);
    expect(sightings).toHaveLength(2);
    expect(sightings[0]?.detectionCount).toBe(2);
    expect(sightings[1]?.detectionCount).toBe(2);
  });

  it('keeps a single detection as a sighting of its own', () => {
    // A glance in passing is still evidence of where the code is; dropping
    // it would silently discard the only sighting of a code seen once.
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    acc.flush();
    expect(acc.sightings(TEXT)).toHaveLength(1);
  });

  it('never reports an unclosed burst, and flush is idempotent', () => {
    // Why this test matters (cold review finding 11): under recency
    // weighting the LAST sighting counts most, and stopping a recording
    // right after a final scan leaves that burst open. The mint must close
    // it first, and calling flush twice must not duplicate it.
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    expect(acc.sightings(TEXT)).toHaveLength(0);
    acc.flush();
    acc.flush();
    expect(acc.sightings(TEXT)).toHaveLength(1);
  });

  it('keeps codes apart, and interleaving does not change either', () => {
    const other = 'https://gps.csutil.com/?qr=tour&n=2';
    const interleaved = createQrSightingAccumulator();
    const separate = createQrSightingAccumulator();
    for (let i = 0; i < 6; i += 1) {
      interleaved.observe(obs(i * 125));
      interleaved.observe(obs(i * 125, { text: other }));
    }
    for (let i = 0; i < 6; i += 1) separate.observe(obs(i * 125));
    interleaved.flush();
    separate.flush();

    expect(interleaved.sightings(TEXT)).toEqual(separate.sightings(TEXT));
    expect(interleaved.sightings(other)).toHaveLength(1);
    expect([...interleaved.codes()].sort()).toEqual([TEXT, other].sort());
  });
});

describe('createQrSightingAccumulator — the odometry frame', () => {
  it('segments on a frame change and closes the open burst', () => {
    // Why this test matters (cold review blocker 4): a tracking restart or a
    // loop closure changes the odometry frame while stored QR poses stay in
    // the old one. Sightings either side describe DIFFERENT frames, and
    // comparing them would either read as a moved poster or, worse, average
    // two frames into a plausible-looking anchor.
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    acc.observe(obs(125));
    acc.noteFrameChange();
    acc.observe(obs(250));
    acc.flush();

    const sightings = acc.sightings(TEXT);
    expect(sightings).toHaveLength(2);
    expect(sightings[0]?.segment).toBe(0);
    expect(sightings[1]?.segment).toBe(1);
    // Even though the two bursts are only 125 ms apart - well inside the
    // gap - the frame change splits them.
    expect(sightings[1]?.firstTimestamp).toBe(250);
  });

  it('reports whether a code spans more than one frame segment', () => {
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    acc.flush();
    expect(acc.spansFrameChange(TEXT)).toBe(false);
    acc.noteFrameChange();
    acc.observe(obs(250));
    acc.flush();
    expect(acc.spansFrameChange(TEXT)).toBe(true);
  });
});

describe('createQrSightingAccumulator — what a sighting carries', () => {
  it('aggregates the burst robustly and reports its spreads', () => {
    const acc = createQrSightingAccumulator();
    // Eight identical poses plus one wild outlier: the robust aggregate must
    // sit on the cluster, not be dragged toward the outlier.
    for (let i = 0; i < 8; i += 1) {
      acc.observe(
        obs(i * 125, {
          odomPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
        })
      );
    }
    acc.observe(
      obs(8 * 125, {
        odomPose: { position: [50, 50, 50], rotation: [0, 0, 0, 1] },
      })
    );
    acc.flush();

    const sighting = acc.sightings(TEXT)[0];
    expect(sighting?.odomPose.position[0]).toBeCloseTo(1, 6);
    expect(sighting?.odomPose.position[1]).toBeCloseTo(2, 6);
    expect(sighting?.translationSpreadM).toBeGreaterThan(0);
    expect(sighting?.rotationSpreadDeg).toBeCloseTo(0, 6);
  });

  it('takes the median size and the LAST alignment of the burst', () => {
    // Why the last (DEC-3): the mint uses each sighting's contemporaneous
    // alignment, and the end of a burst is the moment the session knew most.
    // A different alignment: identity with a 7 m translation column.
    const later: AlignmentMatrix = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 1,
    ];
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0, { sizeM: 0.1, alignmentSampleCount: 3 }));
    acc.observe(obs(125, { sizeM: 0.2, alignmentSampleCount: 4 }));
    acc.observe(
      obs(250, {
        sizeM: 0.3,
        alignmentMatrix: later,
        alignmentSampleCount: 9,
        gpsAccuracyM: 6,
      })
    );
    acc.flush();

    const sighting = acc.sightings(TEXT)[0];
    expect(sighting?.sizeM).toBeCloseTo(0.2, 6);
    expect(sighting?.sizeSpreadM).toBeGreaterThan(0);
    expect(sighting?.alignmentMatrix?.[12]).toBe(7);
    expect(sighting?.alignmentSampleCount).toBe(9);
    expect(sighting?.gpsAccuracyM).toBe(6);
  });

  it('bounds how many detections one burst keeps', () => {
    // Why this test matters: a visitor standing at a poster produces
    // detections indefinitely. The accumulator exists to make memory O(the
    // number of sightings), so one burst must not grow without limit - while
    // still COUNTING every detection it saw.
    const acc = createQrSightingAccumulator({ maxPosesPerSighting: 8 });
    for (let i = 0; i < 500; i += 1) acc.observe(obs(i * 125));
    acc.flush();
    const sighting = acc.sightings(TEXT)[0];
    expect(sighting?.detectionCount).toBe(500);
    expect(sighting?.posesUsed).toBe(8);
  });

  it('ignores a detection with a non-finite pose', () => {
    const acc = createQrSightingAccumulator();
    acc.observe(
      obs(0, {
        odomPose: { position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] },
      })
    );
    acc.flush();
    expect(acc.sightings(TEXT)).toHaveLength(0);
  });

  it('forgets everything on reset', () => {
    const acc = createQrSightingAccumulator();
    acc.observe(obs(0));
    acc.flush();
    acc.reset();
    expect(acc.codes()).toHaveLength(0);
    expect(acc.sightings(TEXT)).toHaveLength(0);
  });
});
