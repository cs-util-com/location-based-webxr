import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  DEFAULT_NEARBY_PARAMS,
  nearbyTargets,
} from "gps-plus-slam-app-framework/ar/targets/nearby-targets";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { positionPrecision } from "gps-plus-slam-app-framework/state/position-precision";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { judgedStationBands } from "./station-bands.js";
import {
  codeTargets,
  createTrackerCaptureWiring,
} from "./tracker-capture-wiring.js";

// The library's geo helpers need its licence, which a store activates.
beforeAll(() => {
  createSlamAppStore({ storageBackend: new NullStorageBackend() });
});

const ZERO: LatLong = { lat: 47, lon: 8 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const T0 = 1_800_000_000_000;

function geoAt(north: number, east: number): QrGeoPose {
  const ll = calcGpsCoords(ZERO, [north, 0, east]);
  return { lat: ll.lat, lon: ll.lon, alt: 0, headingDeg: 0 };
}

describe("tracker capture wiring: the station-band property", () => {
  // Why this test matters: a station's code must be searched for wherever
  // the station can be found. A visitor inside a station's found band
  // (found radius plus the band the run and the HUD use) is inside the
  // gate of the code that station belongs to, for any code-to-station
  // offset within the code's reach, any accuracy up to the 25 m ceiling,
  // and under a code hold (acc_fix 1 m, band 1.5 m).
  it("a visitor inside a station's found band is inside its code's gate", () => {
    fc.assert(
      fc.property(
        fc.record({
          stationDistM: fc.double({ min: 0, max: 39, noNaN: true }),
          stationAngle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
          foundRadiusM: fc.double({ min: 0.5, max: 20, noNaN: true }),
          accM: fc.double({ min: 0.5, max: 25, noNaN: true }),
          codeAccM: fc.option(fc.double({ min: 0.5, max: 10, noNaN: true }), {
            nil: undefined,
          }),
          codeHold: fc.boolean(),
          visitorAngle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
          visitorFraction: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        (g) => {
          const code = geoAt(0, 0);
          const sn = g.stationDistM * Math.cos(g.stationAngle);
          const se = g.stationDistM * Math.sin(g.stationAngle);
          const station = { geo: geoAt(sn, se), foundRadiusM: g.foundRadiusM };
          const ll = calcGpsCoords(ZERO, [0, 0, 0]);
          const fix = {
            latitude: ll.lat,
            longitude: ll.lon,
            latLongAccuracy: g.accM,
            timestamp: T0,
          };
          const precision = positionPrecision({
            position: "aligned",
            codeHold: g.codeHold,
            gpsPoints: [fix],
          });
          const band = judgedStationBands(
            { activateRadiusM: 0, foundRadiusM: g.foundRadiusM },
            precision,
          );
          const r = band.foundExitM * g.visitorFraction;
          const vn = sn + r * Math.cos(g.visitorAngle);
          const ve = se + r * Math.sin(g.visitorAngle);
          const levels = new Map([
            [
              "code",
              {
                version: 1,
                qr: {
                  geo: code,
                  ...(g.codeAccM === undefined
                    ? {}
                    : { mintQuality: { gpsAccuracyM: g.codeAccM } }),
                },
              },
            ],
          ]);
          const events = {
            gpsPositions: [fix],
            odometryPositions: [[vn, 0, ve]],
          };
          const wiring = createTrackerCaptureWiring({
            now: () => T0,
            captureIntervalMs: 125,
            gpsEvents: () => events,
            alignment: () => IDENTITY,
            zero: () => ZERO,
            gpsPoints: () => [fix],
            // odom-NUE [n, u, e] is WebXR (e, u, -n).
            arPose: () => ({ position: { x: ve, y: 0, z: -vn } }),
            codeLinedUp: () => g.codeHold,
            levels: () => levels,
            levelIdByText: () => new Map(),
            stations: () => [station],
            detections: () => ({ markers: {} }),
            qrBusy: () => false,
            forcePref: () => false,
            codesOnly: () => false,
          });
          const targets = codeTargets({
            levels,
            levelIdByText: new Map(),
            stations: [station],
            zero: ZERO,
            detections: { markers: {} },
          });
          const result = nearbyTargets({
            targets,
            ...wiring.position(T0),
            nowMs: T0,
            params: DEFAULT_NEARBY_PARAMS,
          });
          expect(result.state).toBe("gps");
          expect(result.open.map((o) => o.key)).toEqual(["code"]);
        },
      ),
    );
  });
});
