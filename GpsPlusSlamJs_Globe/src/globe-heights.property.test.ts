/**
 * Why these properties matter: the editor converts every item's height on
 * the way in (file to scene) and on the way out (scene to file), so any
 * asymmetry between the two directions drifts an item each time it is
 * opened and saved. Over random heights, places, geoids and offsets: the
 * two directions are exact inverses, the offset shifts the drawn height
 * one for one, and a higher GPS altitude is always drawn higher.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  drawnHeightM,
  ellipsoidalHeightM,
  type GlobeGeoid,
} from "./globe-heights.js";

const height = fc.double({ min: -500, max: 9_000, noNaN: true });
const place = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});
const offset = fc.double({ min: -100, max: 100, noNaN: true });
/** A smooth fake geoid in EGM96's range (-107 to +86 m). */
const geoid = fc
  .record({
    a: fc.double({ min: -100, max: 80, noNaN: true }),
    b: fc.double({ min: -5, max: 5, noNaN: true }),
  })
  .map(({ a, b }): GlobeGeoid => ({
    id: "fake",
    undulationMetres: ({ lat, lng }) =>
      a + b * Math.sin((lat * Math.PI) / 180) * Math.cos((lng * Math.PI) / 180),
  }));

describe("the height conversion, over random inputs", () => {
  it("round-trips: ellipsoidal to drawn and back", () => {
    fc.assert(
      fc.property(height, place, geoid, offset, (h, p, g, o) => {
        const back = ellipsoidalHeightM(drawnHeightM(h, p, g, o), p, g, o);
        expect(back).toBeCloseTo(h, 6);
      }),
    );
  });

  it("shifts the drawn height one for one with the offset", () => {
    fc.assert(
      fc.property(height, place, geoid, offset, offset, (h, p, g, o1, o2) => {
        const d = drawnHeightM(h, p, g, o1) - drawnHeightM(h, p, g, o2);
        expect(d).toBeCloseTo(o1 - o2, 6);
      }),
    );
  });

  it("draws a higher altitude higher, by the same amount", () => {
    fc.assert(
      fc.property(height, height, place, geoid, offset, (h1, h2, p, g, o) => {
        const d = drawnHeightM(h1, p, g, o) - drawnHeightM(h2, p, g, o);
        expect(d).toBeCloseTo(h1 - h2, 6);
      }),
    );
  });
});
