/**
 * QR GPS-vote bridge — fusion integration test.
 *
 * Why this test matters: the pure unit/property tests prove the payload
 * geometry; this proves the payloads are actually CONSUMABLE by the real
 * weighted alignment + outlier-rejection fusion in `gps-plus-slam-js`. It
 * dispatches the 4 synthetic corner votes through a real store and asserts the
 * fusion ingests them and produces a finite alignment, and that adding one
 * grossly-wrong high-weight vote does not crash or produce a non-finite
 * alignment (the bridge relies on outlier rejection, not a trust-QR-absolutely
 * bypass — plan §6).
 *
 * The exact "alignment shifts toward the QR" magnitude is a library-fusion
 * behavior validated end-to-end by the Recorder demonstrator (Phase 6); here we
 * assert the integration contract that holds regardless of fusion internals.
 */

import { describe, it, expect } from 'vitest';
import {
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
  recordGpsEvent,
  getAlignmentMatrix,
  setZeroPos,
} from 'gps-plus-slam-js';
import { createSlamAppStore } from '../../state/create-slam-app-store';
import { NullStorageBackend } from '../../storage/null-storage-backend';
import { buildQrGpsVotes, type QrGeoPose } from './qr-gps-vote';
import type { Pose } from './qr-pose';

const qrGeo: QrGeoPose = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function freshStore() {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  // Anchor the geo frame at the QR center so coordinates stay small & finite.
  store.dispatch(setZeroPos({ lat: qrGeo.lat, lon: qrGeo.lon }));
  return store;
}

describe('QR votes through the real GPS fusion', () => {
  // A QR pose spread in odom space so its 4 corners are non-collinear.
  const qrPoseWorld: Pose = { position: [2, 1.4, -3], rotation: [0, 0, 0, 1] };
  const sizeM = 0.4;

  it('ingests the 4 corner votes and produces a finite alignment', () => {
    const store = freshStore();
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM: 0.05,
      timestamp: 1000,
    });
    for (const v of votes) store.dispatch(recordGpsEvent(v));

    const state = store.getState();
    expect(state.gpsData?.gpsEvents?.odometryPositions.length).toBe(4);

    const alignment = getAlignmentMatrix(state);
    expect(alignment).not.toBeNull();
    expect(alignment!.length).toBe(16);
    expect(alignment!.every((n) => Number.isFinite(n))).toBe(true);
  });

  // Why this test matters: a store listener only ever sees the STORED point,
  // never the payload - so the provenance stamp is useful only if the
  // reducer keeps it. Pinned against the real store of the published core.
  it('keeps the synthetic-QR source on the stored points', () => {
    const store = freshStore();
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM: 5,
      baselineM: 30,
      count: 8,
      timestamp: 1000,
    });
    for (const v of votes) store.dispatch(recordGpsEvent(v));

    const stored = store.getState().gpsData?.gpsEvents?.gpsPositions ?? [];
    expect(stored).toHaveLength(8);
    for (const point of stored) {
      expect(gpsPointSourceOf(point)).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
    }
  });

  it('does not produce a non-finite alignment when a grossly-wrong vote is added', () => {
    const store = freshStore();
    const good = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM: 0.05,
      timestamp: 1000,
    });
    for (const v of good) store.dispatch(recordGpsEvent(v));

    // A single high-weight outlier: same tiny accuracy, but its odom position is
    // 1 km away from a geo position that did not move — an impossible pairing.
    store.dispatch(
      recordGpsEvent({
        odomPosition: [1000, 0, 1000],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: 'qr-bad-0',
          latitude: qrGeo.lat,
          longitude: qrGeo.lon,
          altitude: qrGeo.alt,
          latLongAccuracy: 0.05,
          timestamp: 1001,
        },
      })
    );

    const alignment = getAlignmentMatrix(store.getState());
    expect(alignment).not.toBeNull();
    expect(alignment!.every((n) => Number.isFinite(n))).toBe(true);
  });
});
