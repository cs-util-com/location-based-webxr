import { describe, expect, it } from "vitest";

import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  type GpsPoint,
} from "gps-plus-slam-app-framework/core";

import { deviceGpsQuality } from "./device-gps-quality";
import { buildVisitLogEntry } from "./visit-log";

// Why these tests matter: a scanned code stores its votes in the same GPS
// history as the phone's fixes, sixteen at a time and each claiming 5 m.
// Counted as fixes, one code seen indoors would read as a well-aligned GPS
// session: the creator's placement gate would open on votes it reads as
// fixes, and every code minted afterwards would carry "160 fixes at 5 m"
// as its quality - which the moved-code check and the settle trust.

function point(accuracy: unknown, source?: string): GpsPoint {
  return {
    latitude: 47.5,
    longitude: 8.7,
    altitude: 400,
    latLongAccuracy: accuracy,
    timestamp: 1,
    ...(source === undefined ? {} : { source }),
  } as unknown as GpsPoint;
}

describe("deviceGpsQuality", () => {
  it("counts the device fixes and leaves a code's votes out", () => {
    const quality = deviceGpsQuality([
      point(12),
      point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
      point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
      point(20, GPS_POINT_SOURCE_DEVICE),
      point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
    ]);
    expect(quality.fixes).toBe(2);
    // The median of [12, 20]: never pulled toward the votes' 5 m.
    expect(quality.accuracyM).toBe(16);
  });

  it("reads one visit's accuracy as the visit log does, so a code's mint stamp and its visit agree", () => {
    // Why: a code minted in a visit carries this accuracy in its mint
    // stamp, and the same visit's log entry carries the visit log's; the
    // two are read side by side when visits are combined, so one rule.
    const history = [
      point(4),
      point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
      point(9, GPS_POINT_SOURCE_DEVICE),
      point(7),
      point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
      point(12),
    ];
    const logged = buildVisitLogEntry({
      visitId: "v",
      atMs: 0,
      gpsPositions: history,
      odometryPositions: [],
      alignment: null,
      pathAlignment: null,
      zero: null,
      codes: [],
    });
    expect(deviceGpsQuality(history).accuracyM).toBe(logged.gpsAccuracyM);
    expect(logged.gpsAccuracyM).toBe(8);
  });

  it("reads a history of votes alone as no fix and no accuracy", () => {
    expect(
      deviceGpsQuality(
        Array.from({ length: 32 }, () =>
          point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
        ),
      ),
    ).toEqual({ fixes: 0, accuracyM: null });
  });

  it("reads an empty history as no fix and no accuracy", () => {
    expect(deviceGpsQuality([])).toEqual({ fixes: 0, accuracyM: null });
  });

  it("counts a fix without a usable accuracy, but takes no accuracy from it", () => {
    // External data: an accuracy that is missing, not finite or not positive
    // states nothing about the fix's error.
    const quality = deviceGpsQuality([
      point(undefined),
      point(Number.NaN),
      point(-3),
      point(0),
      point(9),
    ]);
    expect(quality.fixes).toBe(5);
    expect(quality.accuracyM).toBe(9);
  });
});
