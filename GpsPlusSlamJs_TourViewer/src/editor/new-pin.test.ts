/**
 * Why these tests matter: the inspector's Add pin puts a new pin into the
 * selected station with no gesture, so where it lands is the code's
 * choice. It must land inside the station's circle (or visitors never see
 * it), clear of the items already there (or it hides behind one), on the
 * ground where the ground is known, and in the station it was added to -
 * never seated by the station rule into another one.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

// Activates the licence the station frame's geodesy needs.
import "../test-support/tour-of.js";
import { freePinSpot, newPin } from "./new-pin.js";

const AT = "2026-10-25T10:00:00Z";

function station(
  items: readonly [north: number, east: number][],
  foundRadiusM = 25,
): TourStation {
  return {
    id: "s",
    title: "Gate",
    geo: { lat: 48.1371, lon: 11.5751, alt: 520, headingDeg: 40 },
    activateRadiusM: 2 * foundRadiusM,
    foundRadiusM,
    hint: "arrow",
    steps: [],
    blocks: items.map(([north, east], i) => ({
      id: `pin-${String(i)}`,
      kind: "shortText",
      view: "pin",
      caption: `Pin ${String(i)}`,
      createdAtIso: AT,
      pose: { position: [north, 0, east], rotation: [0, 0, 0, 1] },
    })),
  } as unknown as TourStation;
}

describe("freePinSpot", () => {
  it("starts 4 m north of an empty station's anchor", () => {
    expect(freePinSpot(station([]))).toEqual({ northM: 4, eastM: 0 });
  });

  it("keeps clear of the items already there", () => {
    const spot = freePinSpot(station([[4, 0]]));
    expect(Math.hypot(spot.northM - 4, spot.eastM)).toBeGreaterThan(2.2);
  });

  it("stays inside a small station's circle", () => {
    const spot = freePinSpot(station([], 2));
    expect(Math.hypot(spot.northM, spot.eastM)).toBeLessThanOrEqual(2);
  });

  it("lands inside the circle, clear of every item where there is room (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -12, max: 12, noNaN: true }),
            fc.double({ min: -12, max: 12, noNaN: true }),
          ),
          { maxLength: 6 },
        ),
        fc.double({ min: 2, max: 60, noNaN: true }),
        (items, radiusM) => {
          const spot = freePinSpot(station(items, radiusM));
          expect(Math.hypot(spot.northM, spot.eastM)).toBeLessThanOrEqual(
            radiusM + 1e-9,
          );
        },
      ),
    );
  });
});

describe("newPin", () => {
  it("is a pin of the station, at the free spot in its frame, on the ground there", () => {
    const s = station([]);
    const pin = newPin({
      station: s,
      id: "new1",
      nowIso: AT,
      groundAt: () => 518.5,
    });
    expect(pin).toMatchObject({
      id: "new1",
      kind: "shortText",
      view: "pin",
      caption: "New pin 1",
      createdAtIso: AT,
      station: "s",
    });
    expect(pin.geo.alt).toBeCloseTo(518.5, 6);
    const local = localPoseOf(pin.geo, s.geo);
    expect(local.position[0]).toBeCloseTo(4, 3);
    expect(local.position[2]).toBeCloseTo(0, 3);
  });

  it("stands at the anchor's height where the ground has not loaded, and counts the pins for its name", () => {
    const pin = newPin({
      station: station([[4, 0]]),
      id: "new2",
      nowIso: AT,
      groundAt: () => null,
    });
    expect(pin.geo.alt).toBeCloseTo(520, 6);
    expect(pin.caption).toBe("New pin 2");
  });
});
