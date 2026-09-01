/**
 * buildSessionSummary tests
 *
 * Why these tests matter:
 * The summary derivation was extracted from `performStop` (recording-session-
 * handlers.ts) into a PURE function precisely so its math and field mapping
 * can be pinned without the recording-lifecycle mock forest. The handler
 * tests keep covering the wiring (that performStop feeds the right closure
 * values in); these tests pin the derivation itself:
 *   - distance integration over NUE odometry positions (3D Euclidean sum),
 *   - NUE→GPS alignment-snapshot mapping incl. the zeroRef gate (Issue #1),
 *   - assembly of the remaining SessionSummaryData fields.
 *
 * Uses the REAL `calcGpsCoords` / `computeFusedPath` / mapping helpers (the
 * handler suite mocks them) so the geodesy wiring is exercised end-to-end.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import {
  calcGpsCoords,
  validateLicenseKey,
} from 'gps-plus-slam-app-framework/core';
import type { Matrix4, Vector3 } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import type { ZipExportResult } from 'gps-plus-slam-app-framework/storage/zip-export';
import type { RefPointEntry } from '../state/ref-points-slice';
import {
  buildSessionSummary,
  type SessionSummaryInputs,
} from './build-session-summary';

// Activate the gps-plus-slam-js license once for this suite so the real
// `calcGpsCoords` calls (snapshot mapping, fused path) succeed without a
// store being constructed first.
validateLicenseKey(COMMUNITY_LICENSE_KEY);

const ZERO_REF = { lat: 48.137154, lon: 11.576124 };

const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/** Minimal valid inputs — every test overrides only what it pins. */
function baseInputs(
  overrides: Partial<SessionSummaryInputs> = {}
): SessionSummaryInputs {
  return {
    endTime: 2_000,
    startTime: 1_000,
    imageCount: 0,
    depthSampleCount: 0,
    errors: [],
    qrAnchors: [],
    failedWriteCount: 0,
    gpsPositions: [],
    odometryPositions: [],
    alignmentMatrix: null,
    alignmentSnapshotNuePositions: [],
    refPoints: [],
    syncResult: null,
    zipFilename: undefined,
    ...overrides,
  };
}

function gpsPoint(lat: number, lng: number, latLongAccuracy?: number) {
  return {
    latitude: lat,
    longitude: lng,
    latLongAccuracy,
    zeroRef: ZERO_REF,
  };
}

describe('buildSessionSummary — distance integration', () => {
  it('sums 3D Euclidean segment lengths over a multi-segment path', () => {
    // 3-4-5 triangle in the N/E plane (5 m) then 12 m straight up ⇒ 17 m.
    const odometryPositions: Vector3[] = [
      [0, 0, 0],
      [3, 0, 4],
      [3, 12, 4],
    ];
    const summary = buildSessionSummary(baseInputs({ odometryPositions }));
    expect(summary.totalDistanceMeters).toBeCloseTo(17, 10);
  });

  it('returns 0 for an empty odometry path', () => {
    const summary = buildSessionSummary(baseInputs({ odometryPositions: [] }));
    expect(summary.totalDistanceMeters).toBe(0);
  });

  it('returns 0 for a single-point path (no segments)', () => {
    const summary = buildSessionSummary(
      baseInputs({ odometryPositions: [[7, 8, 9]] })
    );
    expect(summary.totalDistanceMeters).toBe(0);
  });
});

describe('buildSessionSummary — NUE→GPS alignment-snapshot mapping (Issue #1)', () => {
  it('maps snapshot NUE positions to lat/lng via calcGpsCoords against the first zeroRef', () => {
    const snapshots: Vector3[] = [
      [10, 0, 5],
      [20, 1, 10],
    ];
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [gpsPoint(48.1372, 11.5761)],
        alignmentSnapshotNuePositions: snapshots,
      })
    );

    // Pin against the SAME geodesy the production path uses (the handler
    // suite mocks calcGpsCoords, so this is the only place the real
    // conversion + lon→lng rename is exercised for snapshots).
    const expected = snapshots.map((nue) => {
      const gps = calcGpsCoords(ZERO_REF, nue);
      return { lat: gps.lat, lng: gps.lon };
    });
    expect(summary.alignmentSnapshotPath).toEqual(expected);
  });

  it('maps the NUE origin to (approximately) the zeroRef itself', () => {
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [gpsPoint(48.2, 11.6)],
        alignmentSnapshotNuePositions: [[0, 0, 0]],
      })
    );
    expect(summary.alignmentSnapshotPath).toHaveLength(1);
    expect(summary.alignmentSnapshotPath![0]!.lat).toBeCloseTo(ZERO_REF.lat, 9);
    expect(summary.alignmentSnapshotPath![0]!.lng).toBeCloseTo(ZERO_REF.lon, 9);
  });

  it('returns an empty path when no GPS fix exists (no zeroRef ⇒ no NUE→GPS mapping)', () => {
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [],
        alignmentSnapshotNuePositions: [[10, 0, 5]],
      })
    );
    expect(summary.alignmentSnapshotPath).toEqual([]);
  });
});

describe('buildSessionSummary — assembly', () => {
  it('assembles counts, duration, and first/last GPS from the inputs', () => {
    const summary = buildSessionSummary(
      baseInputs({
        startTime: 1_000,
        endTime: 61_000,
        imageCount: 42,
        depthSampleCount: 7,
        failedWriteCount: 3,
        errors: ['5 image write failures'],
        gpsPositions: [
          gpsPoint(48.1, 11.5),
          gpsPoint(48.2, 11.6),
          gpsPoint(48.3, 11.7),
        ],
      })
    );

    expect(summary.duration).toEqual({ startTime: 1_000, endTime: 61_000 });
    expect(summary.gpsEventCount).toBe(3);
    expect(summary.imageCount).toBe(42);
    expect(summary.depthSampleCount).toBe(7);
    expect(summary.failedWriteCount).toBe(3);
    expect(summary.errors).toEqual(['5 image write failures']);
    expect(summary.firstGps).toEqual({ lat: 48.1, lng: 11.5 });
    expect(summary.lastGps).toEqual({ lat: 48.3, lng: 11.7 });
  });

  it('falls back to endTime for the duration start when startTime is missing', () => {
    // Mirrors the performStop warning path: inconsistent metadata must yield
    // a ~0 duration, not an epoch-length one.
    const summary = buildSessionSummary(
      baseInputs({ startTime: undefined, endTime: 5_000 })
    );
    expect(summary.duration).toEqual({ startTime: 5_000, endTime: 5_000 });
  });

  it('reports null first/last GPS and zero counts when nothing was recorded', () => {
    const summary = buildSessionSummary(baseInputs());
    expect(summary.firstGps).toBeNull();
    expect(summary.lastGps).toBeNull();
    expect(summary.gpsEventCount).toBe(0);
    expect(summary.refPointCount).toBe(0);
    expect(summary.rawGpsPath).toEqual([]);
  });

  it('includes per-sample accuracy in rawGpsPath only when positive', () => {
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [
          gpsPoint(48.1, 11.5, 4.2), // positive → included
          gpsPoint(48.2, 11.6, 0), // zero → omitted
          gpsPoint(48.3, 11.7), // undefined → omitted
        ],
      })
    );
    expect(summary.rawGpsPath).toEqual([
      { lat: 48.1, lng: 11.5, accuracy: 4.2 },
      { lat: 48.2, lng: 11.6 },
      { lat: 48.3, lng: 11.7 },
    ]);
  });

  it('computes the fused path with the real pipeline (identity alignment ⇒ odometry as NUE)', () => {
    const odometryPositions: Vector3[] = [
      [0, 0, 0],
      [10, 0, 5],
    ];
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [gpsPoint(48.1372, 11.5761)],
        odometryPositions,
        alignmentMatrix: IDENTITY_MATRIX,
      })
    );
    const expected = odometryPositions.map((p) => {
      const gps = calcGpsCoords(ZERO_REF, p);
      return { lat: gps.lat, lng: gps.lon };
    });
    expect(summary.fusedPath).toEqual(expected);
  });

  it('yields an empty fused path when no alignment matrix exists', () => {
    const summary = buildSessionSummary(
      baseInputs({
        gpsPositions: [gpsPoint(48.1372, 11.5761)],
        odometryPositions: [[1, 2, 3]],
        alignmentMatrix: null,
      })
    );
    expect(summary.fusedPath).toEqual([]);
  });

  it('maps ref points through the shared minimap mapping (fused point preferred, id as name fallback)', () => {
    const refPoints: RefPointEntry[] = [
      {
        id: 'h3-cell-a',
        timestamp: 111,
        rawGpsPoint: {
          id: 'raw-1',
          latitude: 48.1,
          longitude: 11.5,
          timestamp: 111,
        },
        gpsPoint: {
          id: 'fused-1',
          latitude: 48.1001,
          longitude: 11.5001,
          timestamp: 111,
        },
      },
      {
        id: 'h3-cell-b',
        name: 'Door',
        timestamp: 222,
        rawGpsPoint: {
          id: 'raw-2',
          latitude: 48.2,
          longitude: 11.6,
          timestamp: 222,
        },
      },
    ];
    const summary = buildSessionSummary(baseInputs({ refPoints }));
    expect(summary.refPointCount).toBe(2);
    expect(summary.referencePointsForMap).toEqual([
      { lat: 48.1001, lng: 11.5001, name: 'h3-cell-a', timestamp: 111 },
      { lat: 48.2, lng: 11.6, name: 'Door', timestamp: 222 },
    ]);
  });

  it('exposes ZIP stats, blob, and filename when a sync result exists', () => {
    const blob = new Blob(['zip-bytes']);
    const syncResult: ZipExportResult = { blob, fileCount: 12 };
    const summary = buildSessionSummary(
      baseInputs({ syncResult, zipFilename: 'session-2026-07-11.zip' })
    );
    expect(summary.zipSizeBytes).toBe(blob.size);
    expect(summary.zipFileCount).toBe(12);
    expect(summary.zipBlob).toBe(blob);
    expect(summary.zipFilename).toBe('session-2026-07-11.zip');
  });

  it('leaves all ZIP fields undefined without a sync result — even if a filename slipped in', () => {
    // Defensive re-guard: performStop only supplies a filename alongside a
    // sync result, but the builder must not surface one without a ZIP.
    const summary = buildSessionSummary(
      baseInputs({ syncResult: null, zipFilename: 'stray.zip' })
    );
    expect(summary.zipSizeBytes).toBeUndefined();
    expect(summary.zipFileCount).toBeUndefined();
    expect(summary.zipBlob).toBeUndefined();
    expect(summary.zipFilename).toBeUndefined();
  });
});
