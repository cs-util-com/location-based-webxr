import { describe, expect, it } from "vitest";

import type { Tour, TourCoord } from "../../../store/types.js";
import { computePreviewStart, tourStartCoord } from "./preview-start.js";
import { createPreviewFrame } from "./preview-frame.js";

const GATE: TourCoord = { lat: 48.137, lon: 11.575 };
const TOWER: TourCoord = { lat: 48.1375, lon: 11.5755 };

function tourWith(overrides: Partial<Tour>): Tour {
  return {
    id: "tour-castle",
    name: "Castle walk",
    description: "",
    assets: [],
    waypoints: [
      {
        id: "wp-gate",
        position: GATE,
        prefetchRadius: 25,
        activeRadius: 10,
        content: {},
      },
      {
        id: "wp-tower",
        position: TOWER,
        prefetchRadius: 25,
        activeRadius: 10,
        content: {},
      },
    ],
    breadcrumb: [],
    ...overrides,
  };
}

describe("preview start", () => {
  it("starts where the author started walking, facing the first stop", () => {
    const trailhead: TourCoord = { lat: 48.1365, lon: 11.575 };
    const tour = tourWith({ breadcrumb: [trailhead, GATE] });

    const { origin, start, route } = computePreviewStart(tour);

    expect(origin).toEqual({ lat: trailhead.lat, lon: trailhead.lon });
    expect(start.x).toBeCloseTo(0, 5);
    expect(start.z).toBeCloseTo(0, 5);
    // The gate is due north of the trailhead, so heading 0.
    expect(start.headingRad).toBeCloseTo(0, 2);
    expect(route).toEqual([trailhead, GATE]);
  });

  it("stands the visitor back from the first stop when there is no breadcrumb", () => {
    const tour = tourWith({ breadcrumb: [] });

    const { origin, start } = computePreviewStart(tour);
    const frame = createPreviewFrame(origin);
    const gate = frame.toWorld(GATE);

    // Far enough out that the first stop is not already active at entry…
    const distance = Math.hypot(gate.x - start.x, gate.z - start.z);
    expect(distance).toBeGreaterThan(10);
    // …and near enough that it is visible ahead, straight down the heading.
    expect(distance).toBeLessThan(30);
    expect(Math.atan2(gate.z - start.z, gate.x - start.x)).toBeCloseTo(
      start.headingRad,
      3,
    );
  });

  it("falls back to a bare origin for a tour with nothing in it", () => {
    const tour = tourWith({ waypoints: [], breadcrumb: [] });

    expect(computePreviewStart(tour)).toEqual({
      origin: { lat: 0, lon: 0 },
      start: { x: 0, z: 0, headingRad: 0 },
      route: [],
    });
  });
});

describe("tour start coordinate", () => {
  it("is the first stop even when the tour has a breadcrumb", () => {
    const trailhead: TourCoord = { lat: 48.1365, lon: 11.575 };
    const tour = tourWith({ breadcrumb: [trailhead, GATE] });

    expect(tourStartCoord(tour)).toEqual(GATE);
  });

  it("is the first stop when there is no breadcrumb", () => {
    expect(tourStartCoord(tourWith({ breadcrumb: [] }))).toEqual(GATE);
  });

  it("is the trailhead when the tour has no waypoints", () => {
    const trailhead: TourCoord = { lat: 48.1365, lon: 11.575 };
    const tour = tourWith({ breadcrumb: [trailhead, GATE], waypoints: [] });

    expect(tourStartCoord(tour)).toEqual(trailhead);
  });

  it("is undefined for a tour with neither", () => {
    expect(
      tourStartCoord(tourWith({ breadcrumb: [], waypoints: [] })),
    ).toBeUndefined();
  });
});
