import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { enuFrameAt } from "gps-plus-slam-osm";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * ONE RULER FOR THE CITY AND THE PHONE (globe city plan 2026-10-05-0040 §14,
 * the owner's D-K7).
 *
 * AR mode builds the city in the Osm library's local metres (`enuFrameAt`)
 * and places the phone in the AR core's (`calcRelativeCoordsInMeters`, which
 * the framework's GPS anchor uses). Until 2026-10-06 the two used different
 * metres per degree of latitude (111,320 against 110,946), so every building
 * stood 0.34 % too far north or south of the phone: 0.34 m at 100 m, 3.4 m at
 * 1 km, while a comment in `ar-fused-gps.ts` called them "the same
 * arithmetic". This compares the two conversions themselves, not their
 * constants, over origins from 70 S to 70 N and offsets up to 5 km.
 */
describe("the Osm library's ENU frame and the AR core's conversion", () => {
  beforeAll(() => {
    // The core's conversion is licence-gated; the framework's store
    // activates the community licence, as OsmDemo's own store does.
    createSlamAppStore({ storageBackend: new NullStorageBackend() });
  });

  it("agree to a millimetre within 5 km of the origin", () => {
    let worst = 0;
    for (let lat = -70; lat <= 70; lat += 7.5) {
      for (const lng of [-170, -3.2, 0, 7.4474, 151.2]) {
        const origin = { lat, lng };
        const frame = enuFrameAt(origin);
        for (const [dLat, dLng] of [
          [0.045, 0],
          [0, 0.06],
          [-0.03, 0.04],
          [0.01, -0.07],
        ] as const) {
          const point = { lat: lat + dLat, lng: lng + dLng };
          const enu = frame.toEnu(point);
          // The core's frame is North, Up, East.
          const [north, , east] = calcRelativeCoordsInMeters(
            { lat, lon: lng },
            { lat: point.lat, lon: point.lng },
          );
          worst = Math.max(
            worst,
            Math.abs(enu.x - (east ?? Number.NaN)),
            Math.abs(enu.y - (north ?? Number.NaN)),
          );
        }
      }
    }
    expect(worst).toBeLessThan(0.001);
  });
});
