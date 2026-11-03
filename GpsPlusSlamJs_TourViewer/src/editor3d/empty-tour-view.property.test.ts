/**
 * Why these tests matter: the empty tour's view is computed from the
 * browser's time-zone offset, which a page cannot vouch for. Whatever
 * number arrives, the centre must be a place on the globe (the view core
 * places a camera only there), and the view must look down at it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { emptyTourCentre, emptyTourView } from "./empty-tour-view.js";

describe("the empty tour's view (properties)", () => {
  it("always centres on a place on the globe", () => {
    fc.assert(
      fc.property(fc.double(), (offset) => {
        const { lat, lng, altM } = emptyTourCentre(offset);
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThan(180);
        expect(Math.abs(lat)).toBeLessThan(90);
        expect(altM).toBe(0);
      }),
    );
  });

  it("looks down at the centre from any positive height", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -900, max: 900 }),
        fc.double({ min: 0.001, max: 1e5, noNaN: true }),
        (offset, km) => {
          const centre = emptyTourCentre(offset);
          const pose = emptyTourView(centre, km);
          expect([pose.lat, pose.lng]).toEqual([centre.lat, centre.lng]);
          expect(pose.altitudeKm).toBe(km);
          expect(pose.pitchDeg).toBeLessThan(-80);
        },
      ),
    );
  });
});
