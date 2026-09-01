import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";

import {
  computeCaptureGeoJoin,
  type ReplayedJoinState,
} from "./capture-geo-join";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

/**
 * Why this property matters (geo-join plan Rev 2 §4): the join's whole
 * contract is that going odom → alignment → geo and back into the VIEWER's
 * NUE frame lands each photo at the aligned position — for EVERY
 * translation and capture position, not the two examples the unit tests
 * pick. A sign flip, an axis swap, or a degrees/metres confusion anywhere
 * in the chain breaks the round-trip by metres and fails loudly here;
 * geodesy round-trip error at these scales is millimetres.
 */
describe("capture-geo-join — round-trip property", () => {
  it("geo output re-projected into the recording zero's NUE equals the aligned odom position", () => {
    const metres = (range: number) =>
      fc.double({ min: -range, max: range, noNaN: true }).map((v) => v + 0);
    fc.assert(
      fc.property(
        fc.record({
          tN: metres(100),
          tU: metres(30),
          tE: metres(100),
          pN: metres(50),
          pU: metres(10),
          pE: metres(50),
        }),
        ({ tN, tU, tE, pN, pU, pE }) => {
          const zero = { lat: 47.5, lon: 8.7 };
          const state: ReplayedJoinState = {
            gpsData: {
              zero,
              gpsEvents: {
                gpsPositions: [{}, {}, {}],
                // Column-major identity rotation + translation.
                alignmentMatrix: [
                  1,
                  0,
                  0,
                  0,
                  0,
                  1,
                  0,
                  0,
                  0,
                  0,
                  1,
                  0,
                  tN,
                  tU,
                  tE,
                  1,
                ],
                alignmentRotation: [0, 0, 0, 1],
                gpsAccuracyMedian: null,
              },
              odometryPath: {
                points: [
                  {
                    imageFile: "images/p.jpg",
                    position: [pN, pU, pE],
                    rotation: [0, 0, 0, 1],
                  },
                ],
              },
            },
          };
          const [pose] = computeCaptureGeoJoin(state);
          const nue = calcRelativeCoordsInMeters(
            zero,
            { lat: pose!.geo.lat, lon: pose!.geo.lon },
            pose!.geo.altitude,
            0,
          );
          expect(nue[0]).toBeCloseTo(pN + tN, 2);
          expect(nue[1]).toBeCloseTo(pU + tU, 2);
          expect(nue[2]).toBeCloseTo(pE + tE, 2);
        },
      ),
    );
  });
});
