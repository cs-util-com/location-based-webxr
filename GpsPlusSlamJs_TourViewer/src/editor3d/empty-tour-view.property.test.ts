/**
 * Why these tests matter: the empty tour's view is computed from the
 * browser's time-zone offset, which a page cannot vouch for. Whatever
 * number arrives, the centre must be a place on the globe (the view core
 * places a camera only there), and the view must look down at it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_SWITCH } from "../editor/globe-switch.js";
import { emptyTourCentre, emptyTourView } from "./empty-tour-view.js";

const EARTH_RADIUS_KM = 6_371;
const DEG = Math.PI / 180;

/** The great-circle angle (deg) between two places. */
function arcDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const cos =
    Math.sin(a.lat * DEG) * Math.sin(b.lat * DEG) +
    Math.cos(a.lat * DEG) *
      Math.cos(b.lat * DEG) *
      Math.cos((a.lng - b.lng) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

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

  // Why: the view is meant to show the creator's own part of the world.
  // A city of each kind of zone - far south, far east, south-west, north,
  // west - must lie inside the cap the start height sees (its horizon,
  // less a margin so it is not on the very rim). At 30 N, Sydney, Auckland
  // and Buenos Aires lay past the horizon.
  it.each([
    ["Sydney", 10, -33.87, 151.21],
    ["Auckland", 13, -36.85, 174.76],
    ["Buenos Aires", -3, -34.6, -58.38],
    ["Oslo", 1, 59.91, 10.75],
    ["Los Angeles", -8, 34.05, -118.24],
  ])(
    "shows %s (UTC offset %d h) inside the start height's cap",
    (_, hours, lat, lng) => {
      const km = GLOBE_SWITCH.startKm.fallback;
      const horizonDeg =
        Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + km)) / DEG;
      const centre = emptyTourCentre(-hours * 60);
      expect(arcDeg(centre, { lat, lng })).toBeLessThan(horizonDeg - 8);
    },
  );
});
