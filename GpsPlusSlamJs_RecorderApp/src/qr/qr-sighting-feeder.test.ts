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
    // Why this test matters: the mint uses each sighting's contemporaneous
    // alignment (plan DEC-3) and the store keeps only the current one. If the
    // feeder read the alignment once at wiring time, every sighting would
    // carry the same stale matrix and the whole decision would be inert.
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
