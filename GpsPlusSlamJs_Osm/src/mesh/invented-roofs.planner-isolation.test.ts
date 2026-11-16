/**
 * One house's roof defect never fails the planner, the city or the obstacle
 * index.
 *
 * WHY THESE TESTS MATTER. The planner meshes every roof it grants (to check
 * the mesh closes), and it runs before the per-building isolation of
 * `buildBuildings` and inside the obstacle index, which isolates nothing. So
 * a defect in the skeleton or its mesh for ONE house (a TypeError, not a
 * refused ring) used to throw out of `planInventedRoofs` and fail the whole
 * city build, and the obstacle index with it. The planner now treats a
 * defect in a roof's mesh as "this roof does not close" and any other throw
 * while planning a house as "no plan": the house is then drawn as its plain
 * volume, and the obstacle index takes the same height the city draws.
 *
 * The defects are injected by module mocks, keyed on the house's size, since
 * no real footprint is known that throws them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { buildObstacleIndex } from "../nav/obstacles.js";
import { buildBuildings, inventedRoofTotals } from "./buildings.js";
import { resolveHeights } from "./building-heights.js";
import { enuFrameAt } from "./enu.js";
import type * as RoofSkeleton from "./roof-skeleton.js";
import type * as SkeletonMeshModule from "./skeleton-mesh.js";

/** Which stage throws a defect for the long house, if any. */
const defect = vi.hoisted(() => ({
  stage: undefined as "mesh" | "skeleton" | undefined,
}));

/** The long house is 15 m north-south, the neighbour 11 m: this tells them apart. */
const LONG_M = 13.5;

function spanY(points: readonly { readonly y: number }[]): number {
  const ys = points.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
}

vi.mock("./skeleton-mesh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SkeletonMeshModule>();
  return {
    ...actual,
    skeletonMesh: (...args: Parameters<typeof actual.skeletonMesh>) => {
      const [roof] = args;
      const points = roof.faces.flatMap((f) => f.points);
      if (defect.stage === "mesh" && spanY(points) > LONG_M) {
        throw new TypeError("a defect in the mesh, not a roof that is open");
      }
      return actual.skeletonMesh(...args);
    },
  };
});

vi.mock("./roof-skeleton.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RoofSkeleton>();
  return {
    ...actual,
    skeletonRoof: (...args: Parameters<typeof actual.skeletonRoof>) => {
      const [rings] = args;
      if (defect.stage === "skeleton" && spanY(rings[0] ?? []) > LONG_M) {
        throw new TypeError("a defect in the skeleton, not a refused ring");
      }
      return actual.skeletonRoof(...args);
    },
  };
});

const frame = enuFrameAt({ lat: 0, lng: 0 });

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

/** A house of about 11 m x 11 m beside it, roofed whatever HOUSE does. */
const NEIGHBOUR: OsmFeature = {
  type: "way",
  id: 2,
  tags: { building: "house" },
  geometry: [
    { lat: 0, lng: 0.0003 },
    { lat: 0, lng: 0.0004 },
    { lat: 0.0001, lng: 0.0004 },
    { lat: 0.0001, lng: 0.0003 },
    { lat: 0, lng: 0.0003 },
  ],
};

const FEATURES = [HOUSE, NEIGHBOUR];

/** Every height the obstacle index holds for `key`. */
function indexedHeights(key: string): number[] {
  const index = buildObstacleIndex(FEATURES);
  const heights = new Set<number>();
  for (const cell of index.cells) {
    for (const o of index.obstaclesIn(cell)) {
      if (o.feature === key) heights.add(o.heightM);
    }
  }
  return [...heights];
}

beforeEach(() => {
  defect.stage = undefined;
});

describe("the planner isolates every house", () => {
  it("roofs both houses when nothing throws", () => {
    const volumes = buildBuildings(FEATURES, { frame, inventedRoofs: true });
    for (const key of ["way/1", "way/2"]) {
      expect(volumes.find((v) => v.feature === key)?.roofIsInvented).toBe(true);
    }
  });

  // A defect in the mesh is caught where the planner checks the mesh: that
  // roof is not granted, so the house takes the next roof or a lid, and the
  // city and the obstacle index read the same plan. Reported once, not
  // once per roof tried.
  it("survives a defect in one house's roof mesh, in the city and the obstacle index alike", () => {
    defect.stage = "mesh";
    const onFallback = vi.fn();
    const volumes = buildBuildings(FEATURES, {
      frame,
      inventedRoofs: true,
      onFallback,
    });
    const house = volumes.find((v) => v.feature === "way/1");
    expect(house).toBeDefined();
    expect(house?.roofIsInvented).toBe(false);
    expect(volumes.find((v) => v.feature === "way/2")?.roofIsInvented).toBe(
      true,
    );
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(indexedHeights("way/1")).toEqual([house?.heights.totalHeightM]);
  });

  // Any other throw while planning one house leaves that house without a
  // plan: the plain volume from its tags, and the tagged height in the index.
  it("survives a defect in one house's skeleton: its plain volume, everywhere", () => {
    defect.stage = "skeleton";
    const totals = inventedRoofTotals(FEATURES, frame);
    expect(totals.has("way/1")).toBe(false);
    expect(totals.has("way/2")).toBe(true);
    const onFallback = vi.fn();
    const volumes = buildBuildings(FEATURES, {
      frame,
      inventedRoofs: true,
      onFallback,
    });
    expect(onFallback).toHaveBeenCalledTimes(1);
    const house = volumes.find((v) => v.feature === "way/1");
    const plain = resolveHeights(HOUSE.tags).totalHeightM;
    expect(house?.roofIsInvented).toBe(false);
    expect(house?.heights.totalHeightM).toBe(plain);
    expect(volumes.find((v) => v.feature === "way/2")?.roofIsInvented).toBe(
      true,
    );
    expect(indexedHeights("way/1")).toEqual([plain]);
  });
});
