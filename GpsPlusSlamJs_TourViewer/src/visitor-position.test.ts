import { describe, expect, it } from "vitest";
import {
  calcGpsCoords,
  GPS_POINT_SOURCE_DEVICE,
  type GpsPoint,
} from "gps-plus-slam-app-framework/core";
import {
  createSlamAppStore,
  recordGpsEvent,
  selectAlignmentMatrix,
  selectGpsPositions,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { ACCURACY_WINDOW_FIXES, visitorPosition } from "./visitor-position";

/**
 * Why these tests matter: a station is found where this says the visitor
 * stands, and its radius widens with the accuracy this reports. The camera
 * must come through the same alignment as the tour's content (else the HUD
 * says "arrived" where the station is not found), and a single code vote's
 * fixed accuracy must never make a phone in an urban canyon look precise.
 */

const zero = { lat: 47.5, lon: 8.7 };

/** A store aligned by a walk whose GPS reads the odometry shifted by
 *  (north +3, east -2) m. */
function alignedStore() {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  store.dispatch(setZeroPos(zero));
  const walk: [number, number, number][] = [];
  for (let s = 0; s <= 25; s += 1) walk.push([0, 1.5, -s]);
  for (let s = 1; s <= 15; s += 1) walk.push([s, 1.5, -25]);
  walk.forEach(([x, y, z], i) => {
    const geo = calcGpsCoords(zero, [-z + 3, 0, x - 2]);
    store.dispatch(
      recordGpsEvent({
        odomPosition: [x, y, z],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `gps-${String(i)}`,
          latitude: geo.lat,
          longitude: geo.lon,
          altitude: 400,
          latLongAccuracy: 3 + (i % 3),
          timestamp: 1_790_000_000_000 + i * 1000,
        },
      }),
    );
  });
  return store;
}

describe("visitorPosition", () => {
  it("puts the camera into GPS-world NUE through the solved alignment", () => {
    const store = alignedStore();
    const p = visitorPosition({
      alignment: selectAlignmentMatrix(store.getState()),
      // WebXR: x East, y Up, z South. 10 m North, 4 m East of the start.
      arPose: { position: { x: 4, y: 1.5, z: -10 } },
      gpsPositions: selectGpsPositions(store.getState()),
    });
    expect(p.nue).not.toBeNull();
    const [n, , e] = p.nue!;
    expect(n).toBeCloseTo(13, 0);
    expect(e).toBeCloseTo(2, 0);
  });

  it("has no position without an alignment, a pose, or with a pose that is not finite", () => {
    const gpsPositions: GpsPoint[] = [];
    expect(
      visitorPosition({
        alignment: null,
        arPose: { position: { x: 0, y: 0, z: 0 } },
        gpsPositions,
      }).nue,
    ).toBeNull();
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(
      visitorPosition({ alignment: identity, arPose: null, gpsPositions }).nue,
    ).toBeNull();
    expect(
      visitorPosition({
        alignment: identity,
        arPose: { position: { x: Number.NaN, y: 0, z: 0 } },
        gpsPositions,
      }).nue,
    ).toBeNull();
    expect(
      visitorPosition({
        alignment: [1, 2, 3],
        arPose: { position: { x: 0, y: 0, z: 0 } },
        gpsPositions,
      }).nue,
    ).toBeNull();
  });

  it("reads where the latest DEVICE fix puts the visitor, never a code's vote (K4 review R1)", () => {
    // Why this test matters (K4 review R1): a code's votes pull the fused
    // position onto the code's saved spot, so only a raw device fix can
    // tell whether a scanned code is where the visitor's GPS says.
    const at = (north: number, east: number, source: string): GpsPoint => {
      const g = calcGpsCoords(zero, [north, 0, east]);
      return {
        latitude: g.lat,
        longitude: g.lon,
        altitude: 400,
        latLongAccuracy: 4,
        timestamp: 1,
        source,
      } as unknown as GpsPoint;
    };
    const points = [
      at(50, 50, GPS_POINT_SOURCE_DEVICE),
      at(10, -5, GPS_POINT_SOURCE_DEVICE),
      ...Array.from({ length: 16 }, () => at(100, 0, "synthetic-qr")),
    ];
    const p = visitorPosition({
      alignment: null,
      arPose: null,
      gpsPositions: points,
      zero,
    });
    expect(p.fixNue).not.toBeNull();
    expect(p.fixNue![0]).toBeCloseTo(10, 3);
    expect(p.fixNue![2]).toBeCloseTo(-5, 3);
    // No zero, or no device fix: unknown.
    expect(
      visitorPosition({ alignment: null, arPose: null, gpsPositions: points })
        .fixNue,
    ).toBeNull();
    expect(
      visitorPosition({
        alignment: null,
        arPose: null,
        gpsPositions: points.slice(2),
        zero,
      }).fixNue,
    ).toBeNull();
  });

  // Why (M5a review M3): the station guide falls back to the raw fix only
  // while there is no alignment at all, and only while that fix is fresh.
  // A tracking drop in an aligned session has no camera position either,
  // so the guide must tell the two apart, and needs the fix's own time.
  it("says whether the session is aligned, and when its latest DEVICE fix was taken", () => {
    const fix = (timestamp: number, source: string): GpsPoint =>
      ({
        latitude: 47.5,
        longitude: 8.7,
        altitude: 400,
        latLongAccuracy: 4,
        timestamp,
        source,
      }) as unknown as GpsPoint;
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const points = [
      fix(1_000, GPS_POINT_SOURCE_DEVICE),
      fix(2_000, GPS_POINT_SOURCE_DEVICE),
      fix(9_000, "synthetic-qr"),
    ];
    const dropped = visitorPosition({
      alignment: identity,
      arPose: null,
      gpsPositions: points,
      zero,
    });
    expect(dropped.nue).toBeNull();
    expect(dropped.aligned).toBe(true);
    // The device fix's own time, never a vote's.
    expect(dropped.fixAtMs).toBe(2_000);
    const early = visitorPosition({
      alignment: null,
      arPose: { position: { x: 0, y: 0, z: 0 } },
      gpsPositions: points,
      zero,
    });
    expect(early.aligned).toBe(false);
    expect(early.fixAtMs).toBe(2_000);
    // No device fix, or no zero: no fix, so no time either.
    expect(
      visitorPosition({
        alignment: null,
        arPose: null,
        gpsPositions: points.slice(2),
        zero,
      }).fixAtMs,
    ).toBeNull();
    expect(
      visitorPosition({ alignment: null, arPose: null, gpsPositions: points })
        .fixAtMs,
    ).toBeNull();
  });

  // Why: the fix's time is external data. A missing or NaN timestamp gave
  // `fixAtMs: NaN` - a number, so a reader trusting the type compared NaN
  // against its age limit and read the fix as never stale. A time that is
  // not finite is no time: null, while the fix's position still stands.
  it("has no fix time when the device fix's timestamp is missing or not finite", () => {
    for (const timestamp of [Number.NaN, undefined, Number.POSITIVE_INFINITY]) {
      const p = visitorPosition({
        alignment: null,
        arPose: null,
        gpsPositions: [
          {
            latitude: 47.5,
            longitude: 8.7,
            altitude: 400,
            latLongAccuracy: 4,
            timestamp,
            source: GPS_POINT_SOURCE_DEVICE,
          } as unknown as GpsPoint,
        ],
        zero,
      });
      expect(p.fixNue, String(timestamp)).not.toBeNull();
      expect(p.fixAtMs, String(timestamp)).toBeNull();
    }
  });

  it("reads the accuracy from the latest DEVICE fixes only, as their median", () => {
    const fix = (accuracy: number | undefined, source?: string): GpsPoint =>
      ({
        latitude: 47.5,
        longitude: 8.7,
        altitude: 400,
        ...(accuracy === undefined ? {} : { latLongAccuracy: accuracy }),
        timestamp: 1,
        ...(source === undefined ? {} : { source }),
      }) as unknown as GpsPoint;
    // Old fixes at 30 m, then ten at 4-8 m, then a code's votes at 5 m.
    const points = [
      ...Array.from({ length: 5 }, () => fix(30, GPS_POINT_SOURCE_DEVICE)),
      ...[4, 5, 6, 7, 8, 4, 5, 6, 7, 8].map((a) =>
        fix(a, GPS_POINT_SOURCE_DEVICE),
      ),
      ...Array.from({ length: 20 }, () => fix(0.5, "synthetic-qr")),
    ];
    expect(ACCURACY_WINDOW_FIXES).toBe(10);
    const p = visitorPosition({
      alignment: null,
      arPose: null,
      gpsPositions: points,
    });
    expect(p.accuracyM).toBe(6);
    // No usable accuracy at all: unknown, never 0.
    expect(
      visitorPosition({
        alignment: null,
        arPose: null,
        gpsPositions: [
          fix(undefined, GPS_POINT_SOURCE_DEVICE),
          fix(-1, GPS_POINT_SOURCE_DEVICE),
        ],
      }).accuracyM,
    ).toBeNull();
  });

  // Why (r881 re-review M-A): before the alignment is ready the latest fix
  // alone is the position, but the accuracy above is the median of ten.
  // One ±40 m Wi-Fi fix after a run of ±5 m GPS fixes left the median at
  // 5 m, and that single fix could latch a station found. The guide needs
  // the fix's OWN accuracy too.
  it("reports the latest DEVICE fix's own accuracy beside the median", () => {
    const fix = (
      accuracy: number | undefined,
      timestamp: number,
      source: string = GPS_POINT_SOURCE_DEVICE,
    ): GpsPoint =>
      ({
        latitude: 47.5,
        longitude: 8.7,
        altitude: 400,
        latLongAccuracy: accuracy,
        timestamp,
        source,
      }) as unknown as GpsPoint;
    const run = Array.from({ length: 9 }, (_, i) => fix(5, i * 1000));
    const p = visitorPosition({
      alignment: null,
      arPose: null,
      gpsPositions: [...run, fix(40, 9_000), fix(1, 9_500, "synthetic-qr")],
      zero,
    });
    expect(p.accuracyM).toBe(5);
    // The latest DEVICE fix's own, never a vote's.
    expect(p.fixAccuracyM).toBe(40);
    // That fix states no usable accuracy: unknown, even with older ones.
    for (const bad of [undefined, -1, 0, Number.NaN]) {
      expect(
        visitorPosition({
          alignment: null,
          arPose: null,
          gpsPositions: [...run, fix(bad, 9_000)],
          zero,
        }).fixAccuracyM,
      ).toBeNull();
    }
    // No fix position (no zero): no fix accuracy either.
    expect(
      visitorPosition({
        alignment: null,
        arPose: null,
        gpsPositions: [...run, fix(40, 9_000)],
      }).fixAccuracyM,
    ).toBeNull();
  });
});
