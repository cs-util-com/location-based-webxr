/**
 * One building never breaks the city.
 *
 * WHY THESE TESTS MATTER. A single invented roof whose mesh threw once failed
 * the whole city build, and the page lost its map with it. `buildBuildings`
 * now isolates every outline: a roof that does not close is drawn as a flat
 * lid at its planned top, any other throw falls back to the plain volume from
 * the tags, and each such building is reported once through `onFallback`, so
 * `buildCity` can count them for the page. The mesh call is made to throw by
 * a mock, because no real footprint is known that still throws after the
 * fixes in `skeleton-mesh.ts` and the planner: that is the point of a last
 * guard.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { buildBuildings, inventedRoofTotals } from "./buildings.js";
import { buildCity } from "./city.js";
import { enuFrameAt } from "./enu.js";
import type * as InventedRoofs from "./invented-roofs.js";
import { SkeletonFailure } from "./roof-skeleton.js";

const mesh = vi.hoisted(() => ({ fail: undefined as Error | undefined }));

vi.mock("./invented-roofs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof InventedRoofs>();
  return {
    ...actual,
    inventedRoofMesh: (...args: Parameters<typeof actual.inventedRoofMesh>) => {
      // ONCE: the first roof meshed (the house, first in input order) throws;
      // its neighbour, which the planner roofs too, is meshed as usual.
      const fail = mesh.fail;
      mesh.fail = undefined;
      if (fail !== undefined) throw fail;
      return actual.inventedRoofMesh(...args);
    },
  };
});

// A synthetic place: nothing here depends on where on Earth it is.
const ORIGIN = { lat: 0, lng: 0 };
const frame = enuFrameAt(ORIGIN);

/** A house of about 11 m x 15 m that the map says nothing about but its use. */
const HOUSE: OsmFeature = {
  type: "way",
  id: 1,
  tags: { building: "house" },
  geometry: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.0001 },
    { lat: 0.000135, lng: 0.0001 },
    { lat: 0.000135, lng: 0 },
    { lat: 0, lng: 0 },
  ],
};

/** A second house beside it, which must be drawn as built whatever HOUSE does. */
const NEIGHBOUR: OsmFeature = {
  type: "way",
  id: 2,
  tags: { building: "yes", height: "9" },
  geometry: [
    { lat: 0, lng: 0.0003 },
    { lat: 0, lng: 0.0004 },
    { lat: 0.0001, lng: 0.0004 },
    { lat: 0.0001, lng: 0.0003 },
    { lat: 0, lng: 0.0003 },
  ],
};

function build(onFallback?: (error: unknown) => void) {
  return buildBuildings([HOUSE, NEIGHBOUR], {
    frame,
    inventedRoofs: true,
    ...(onFallback === undefined ? {} : { onFallback }),
  });
}

beforeEach(() => {
  mesh.fail = undefined;
});

describe("buildBuildings isolates every building", () => {
  it("draws the invented roof and reports nothing when nothing throws", () => {
    const onFallback = vi.fn();
    const volumes = build(onFallback);
    expect(onFallback).not.toHaveBeenCalled();
    const house = volumes.find((v) => v.feature === "way/1");
    expect(house?.roofIsInvented).toBe(true);
  });

  // The last guard for a roof that closed where the planner checked it and
  // not on this ground: a lid at the PLANNED top, so the obstacle index (which
  // reads the plan) still matches what is drawn.
  it("draws a roof whose mesh does not close as a flat lid at the planned top", () => {
    const failure = new SkeletonFailure("the stitched roof is not closed");
    mesh.fail = failure;
    const onFallback = vi.fn();
    const volumes = build(onFallback);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(failure);
    const house = volumes.find((v) => v.feature === "way/1");
    expect(house?.roofIsInvented).toBe(false);
    expect(house?.heights.roofShape).toBe("flat");
    const planned = inventedRoofTotals([HOUSE, NEIGHBOUR], frame).get("way/1");
    expect(planned).toBeGreaterThan(0);
    expect(house?.heights.totalHeightM).toBe(planned);
    expect(volumes.find((v) => v.feature === "way/2")?.roofIsInvented).toBe(
      true,
    );
  });

  it("draws an outline whose build throws anything else as its plain volume", () => {
    const failure = new TypeError("a defect, not a roof that did not close");
    mesh.fail = failure;
    const onFallback = vi.fn();
    const volumes = build(onFallback);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(failure);
    const house = volumes.find((v) => v.feature === "way/1");
    expect(house).toBeDefined();
    expect(house?.roofIsInvented).toBe(false);
    expect(volumes.map((v) => v.feature)).toContain("way/2");
  });

  it("isolates silently when no one listens", () => {
    mesh.fail = new TypeError("a defect");
    expect(() => build()).not.toThrow();
  });
});

describe("buildCity counts the buildings not drawn as built", () => {
  const W = { south: -0.01, west: -0.01, north: 0.01, east: 0.01 };

  it("counts none when every building is drawn as built", () => {
    const city = buildCity([HOUSE, NEIGHBOUR], { frame }, { window: W });
    expect(city.fallbackBuildings).toBe(0);
  });

  it("counts a building not drawn as built", () => {
    mesh.fail = new SkeletonFailure("the stitched roof is not closed");
    const city = buildCity([HOUSE, NEIGHBOUR], { frame }, { window: W });
    expect(city.fallbackBuildings).toBe(1);
    expect(city.volumes.map((v) => v.feature).sort()).toEqual([
      "way/1",
      "way/2",
    ]);
  });
});
