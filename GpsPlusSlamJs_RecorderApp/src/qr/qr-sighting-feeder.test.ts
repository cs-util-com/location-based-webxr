import { describe, it, expect, vi } from 'vitest';
import { createQrSightingAccumulator } from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import { createQrSightingFeeder } from './qr-sighting-feeder';
import type { Matrix4 } from 'gps-plus-slam-app-framework/core';

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const PLACEMENT = {
  pose: {
    position: [1, 2, 3] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  },
  sizeM: 0.16,
};

describe('createQrSightingFeeder', () => {
  it('snapshots the alignment AS IT IS at each detection', () => {
    // Why this test matters: the mint falls back to a sighting's own
    // snapshot when the alignment at save describes another odometry segment,
    // and the store keeps only the current one. If the feeder read the
    // alignment once at wiring time, every sighting would carry the same
    // stale matrix and that fallback would place codes through it.
    let sampleCount = 2;
    const readAlignment = vi.fn(() => ({
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: sampleCount,
    }));
    const accumulator = createQrSightingAccumulator();
    const feeder = createQrSightingFeeder({ readAlignment, accumulator });

    feeder.onPlacement('code', PLACEMENT, 0);
    sampleCount = 9;
    feeder.onPlacement('code', PLACEMENT, 125);
    accumulator.flush();

    expect(readAlignment).toHaveBeenCalledTimes(2);
    // The burst keeps its LAST detection's alignment.
    expect(accumulator.sightings('code')[0]?.alignmentSampleCount).toBe(9);
  });

  it('passes the derived pose and size through untouched', () => {
    const accumulator = createQrSightingAccumulator();
    const feeder = createQrSightingFeeder({
      readAlignment: () => ({
        alignmentMatrix: IDENTITY,
        zero: { lat: 48, lon: 11 },
        alignmentSampleCount: 5,
        gpsAccuracyM: 4.5,
      }),
      accumulator,
    });
    feeder.onPlacement('code', PLACEMENT, 1000);
    accumulator.flush();

    const sighting = accumulator.sightings('code')[0];
    expect(sighting?.odomPose.position).toEqual([1, 2, 3]);
    expect(sighting?.sizeM).toBeCloseTo(0.16, 6);
    expect(sighting?.gpsAccuracyM).toBe(4.5);
    expect(sighting?.firstTimestamp).toBe(1000);
  });

  it('forwards a frame change so sightings either side stay separable', () => {
    const accumulator = createQrSightingAccumulator();
    const feeder = createQrSightingFeeder({
      readAlignment: () => ({
        alignmentMatrix: IDENTITY,
        zero: { lat: 48, lon: 11 },
        alignmentSampleCount: 5,
      }),
      accumulator,
    });
    feeder.onPlacement('code', PLACEMENT, 0);
    feeder.noteFrameChange();
    feeder.onPlacement('code', PLACEMENT, 125);
    accumulator.flush();

    expect(accumulator.sightings('code')).toHaveLength(2);
    expect(accumulator.spansFrameChange('code')).toBe(true);
  });

  it('tolerates a session with no alignment yet', () => {
    // Detections happen before the first GPS fix. They must still be folded -
    // the mint decides later whether the evidence is usable, and dropping
    // them here would silently lose the first visit.
    const accumulator = createQrSightingAccumulator();
    const feeder = createQrSightingFeeder({
      readAlignment: () => ({
        alignmentMatrix: null,
        zero: null,
        alignmentSampleCount: 0,
      }),
      accumulator,
    });
    feeder.onPlacement('code', PLACEMENT, 0);
    accumulator.flush();

    const sighting = accumulator.sightings('code')[0];
    expect(sighting).toBeDefined();
    expect(sighting?.alignmentMatrix).toBeNull();
  });
});

describe('createQrSightingFeeder - the alignment at mint time (D28 revised)', () => {
  /** A live alignment the test moves by hand: `count` tags it, `extentM`
   *  is the session's GPS extent so far. */
  function liveFeeder() {
    const live = { count: 4, extentM: 0, matrix: IDENTITY as Matrix4 | null };
    const readAlignment = vi.fn(() => ({
      alignmentMatrix: live.matrix,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: live.count,
      gpsExtentM: live.extentM,
    }));
    const feeder = createQrSightingFeeder({ readAlignment });
    return { live, feeder, readAlignment };
  }

  it('mints a code seen before the walk matured through the alignment at save', () => {
    // Why this test matters: the start-at-code fix. A code scanned as the
    // recording starts is seen through an alignment with no walk behind it;
    // if the walk never reaches the maturity floor, the save hands the mint
    // the session alignment as it stands THEN (with its segment), never the
    // immature snapshot of the sighting.
    const { live, feeder } = liveFeeder();
    feeder.onPlacement('code', PLACEMENT, 0);
    live.count = 30;
    live.extentM = 25;
    feeder.noteAlignment();
    live.count = 75;
    // Still under the 40 m floor (D34) at save.
    live.extentM = 35;

    expect(feeder.alignmentFor('code')).toEqual({
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: 75,
      gpsExtentM: 35,
      segment: 0,
    });
  });

  it('freezes a code at the first mature alignment after its sighting', () => {
    // Why this test matters: the left-behind fix. Once the session's GPS
    // extent reaches the floor the code stops following the alignment, so the
    // SLAM drift of the walk away from it never reaches its anchor.
    const { live, feeder, readAlignment } = liveFeeder();
    feeder.onPlacement('code', PLACEMENT, 0);
    // Just under, then at the 40 m floor (D34).
    live.count = 40;
    live.extentM = 39;
    feeder.noteAlignment();
    live.count = 41;
    live.extentM = 40;
    feeder.noteAlignment();
    live.count = 500;
    live.extentM = 600;
    feeder.noteAlignment();

    expect(feeder.alignmentFor('code').alignmentSampleCount).toBe(41);
    // The alignment is read on each report, not once at wiring.
    expect(readAlignment.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('re-opens a code when it is seen again', () => {
    // Why this test matters: the rule is the first mature alignment after
    // the LAST sighting; a later visit must move the code to an alignment
    // at or after that visit.
    const { live, feeder } = liveFeeder();
    live.extentM = 100;
    live.count = 20;
    feeder.onPlacement('code', PLACEMENT, 0);
    live.count = 300;
    feeder.noteAlignment();
    live.count = 310;
    feeder.onPlacement('code', PLACEMENT, 90_000);
    live.count = 900;
    feeder.noteAlignment();

    expect(feeder.alignmentFor('code').alignmentSampleCount).toBe(310);
  });

  it('keeps the alignment a segment closed with for a code still waiting', () => {
    // Why this test matters (milestone review M1): after a tracking restart
    // the live alignment describes another odometry frame, and the
    // restart's reducer wipes it. A code seen in the closed segment that had
    // not matured is placed through the alignment that segment ended with -
    // read at the frame change, not later.
    const { live, feeder } = liveFeeder();
    feeder.onPlacement('code', PLACEMENT, 0);
    live.count = 60;
    live.extentM = 30;
    feeder.noteFrameChange();
    live.count = 2;
    live.extentM = 0;

    expect(feeder.alignmentFor('code').alignmentSampleCount).toBe(60);
    expect(feeder.alignmentFor('code').segment).toBe(0);
    // A code it never saw gets the live alignment of the current segment.
    expect(feeder.alignmentFor('other').alignmentSampleCount).toBe(2);
    expect(feeder.alignmentFor('other').segment).toBe(1);
  });

  it('forgets the codes and their alignments on reset', () => {
    // Why this test matters: a Start Recording store swap discards the
    // sightings (they are not in the recorded stream); a frozen alignment
    // from before it must go with them.
    const { live, feeder } = liveFeeder();
    live.extentM = 100;
    live.count = 20;
    feeder.onPlacement('code', PLACEMENT, 0);
    feeder.reset();
    live.extentM = 1;
    live.count = 3;

    expect(feeder.accumulator.codes()).toEqual([]);
    expect(feeder.alignmentFor('code').alignmentSampleCount).toBe(3);
  });
});
