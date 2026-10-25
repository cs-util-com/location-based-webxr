import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  type GpsPoint,
} from "gps-plus-slam-app-framework/core";

import { deviceGpsQuality } from "./device-gps-quality";

// Why this test matters: the creator's mint quality and placement gate and
// the visitor's line read their GPS count and accuracy here, and a code's
// votes may land anywhere in the history - before the first fix, between
// fixes, in bursts of sixteen. Wherever they land and however many there
// are, the answer must be the device fixes' alone.

function point(accuracy: number, source?: string): GpsPoint {
  return {
    latitude: 47.5,
    longitude: 8.7,
    altitude: 400,
    latLongAccuracy: accuracy,
    timestamp: 1,
    ...(source === undefined ? {} : { source }),
  } as unknown as GpsPoint;
}

describe("deviceGpsQuality (property)", () => {
  it("is the device fixes' count and median accuracy, whatever votes are mixed in", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.5, max: 200, noNaN: true }), {
          maxLength: 40,
        }),
        fc.array(fc.nat({ max: 40 }), { maxLength: 40 }),
        (accuracies, voteSlots) => {
          const history: GpsPoint[] = accuracies.map((a) => point(a));
          for (const slot of voteSlots) {
            history.splice(
              Math.min(slot, history.length),
              0,
              point(5, GPS_POINT_SOURCE_SYNTHETIC_QR),
            );
          }
          const quality = deviceGpsQuality(history);
          expect(quality.fixes).toBe(accuracies.length);
          const sorted = [...accuracies].sort((a, b) => a - b);
          expect(quality.accuracyM).toBe(
            sorted.length === 0 ? null : sorted[sorted.length >> 1],
          );
        },
      ),
    );
  });
});
