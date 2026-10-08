/**
 * The globe's detail shader and the Osm library's ENU frame use one ruler.
 *
 * WHY (globe city plan 2026-10-05-0040 §14, D-K7): the detail texture is
 * baked in the Osm library's `enuFrameAt` metres (`globe-detail-region.js`)
 * and sampled in the globe's shader with `GLOBE_DETAIL`'s copy of the same
 * numbers (the Globe package does not depend on the library). When the
 * library's ruler changed to the AR core's on 2026-10-06, the copy had to
 * change with it, or the detail would slide against its region, by 0.34 %
 * north-south. Nothing else compares the two.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// By file URL from the repository root, as the terrain lab's tests load
// package sources (a route URL here is invisible to the dead-code check).
const REPO = new URL("../../../", import.meta.url);
const { GLOBE_DETAIL } = await import(
  new URL("GpsPlusSlamJs_Globe/src/globe-detail.ts", REPO).href
);
const { enuFrameAt } = await import(
  new URL("GpsPlusSlamJs_Osm/src/mesh/enu.ts", REPO).href
);

describe("GLOBE_DETAIL's metres a degree", () => {
  it("equal the Osm frame's, north and east, from 70 S to 70 N", () => {
    for (let lat = -70; lat <= 70; lat += 10) {
      const origin = { lat, lng: 7.4 };
      const p = enuFrameAt(origin).toEnu({ lat: lat + 0.02, lng: 7.43 });
      const north = 0.02 * GLOBE_DETAIL.metresPerDegLat;
      const east =
        0.03 *
        Math.cos((lat * Math.PI) / 180) *
        GLOBE_DETAIL.metresPerDegLngEquator;
      assert.ok(Math.abs(p.y - north) < 1e-6, `north at ${lat}`);
      assert.ok(Math.abs(p.x - east) < 1e-6, `east at ${lat}`);
    }
  });
});
