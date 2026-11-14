import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { TERRAIN_SPACING_M } from "../elevation/heightfield.js";
import { enuFrameAt } from "./enu.js";
import { groundClassOf, isPedestrianArea } from "./ground-tint.js";
import type { MeshData } from "./mesh-data.js";
import {
  PEDESTRIAN_AREA_SPACING_M,
  buildPedestrianAreas,
} from "./pedestrian-areas.js";
import { pedestrianAreaLiftM } from "./roads.js";

/**
 * WHY THESE TESTS MATTER. A mapped square is where a person stands in
 * Heidelberg's street view, and before this builder nothing drew it: `isRoad`
 * leaves `area=yes` highways to the area builders and the plates refuse every
 * highway. So the surface must cover exactly the mapped polygon (holes left
 * open, the fetch window respected), sit on the terrain rather than float or
 * sink between sparse vertices (densified to the terrain's post spacing), and
 * stay under the paths that cross it. The tint and this mesh read one
 * predicate, so a square is never classified two ways.
 */
const FRAME = enuFrameAt({ lat: 49.41, lng: 8.69 });
const at = (x: number, y: number): { lat: number; lng: number } =>
  FRAME.toLatLng({ x, y });
const WIDE: Bbox = { south: 49.3, west: 8.6, north: 49.5, east: 8.8 };

let nextId = 1;
function area(
  tags: Record<string, string>,
  ring: readonly [number, number][],
  id = nextId++,
): OsmFeature {
  const closed = [...ring, ring[0] as [number, number]];
  return {
    type: "way",
    id,
    tags,
    geometry: closed.map(([x, y]) => at(x, y)),
  } as unknown as OsmFeature;
}

const SQUARE = { highway: "pedestrian", area: "yes" };
const box = (x0: number, y0: number, x1: number, y1: number) =>
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as [number, number][];

/** Plan area of a mesh, ENU square metres (render z is minus north). */
function planArea(mesh: MeshData): number {
  const p = (v: number, axis: number): number =>
    mesh.positions[v * 3 + axis] ?? Number.NaN;
  let sum = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    const cross =
      (p(b, 0) - p(a, 0)) * (p(c, 2) - p(a, 2)) -
      (p(b, 2) - p(a, 2)) * (p(c, 0) - p(a, 0));
    sum += Math.abs(cross) / 2;
  }
  return sum;
}

/** The render-frame face normal's y of every triangle (up is positive). */
function faceUps(mesh: MeshData): number[] {
  const p = (v: number, axis: number): number =>
    mesh.positions[v * 3 + axis] ?? Number.NaN;
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    out.push(
      (p(b, 2) - p(a, 2)) * (p(c, 0) - p(a, 0)) -
        (p(b, 0) - p(a, 0)) * (p(c, 2) - p(a, 2)),
    );
  }
  return out;
}

const build = (features: OsmFeature[], window: Bbox = WIDE) =>
  buildPedestrianAreas(features, { frame: FRAME, window });

describe("buildPedestrianAreas", () => {
  it("covers exactly the mapped square, facing up", () => {
    const [square] = build([area(SQUARE, box(0, 0, 30, 30))]);
    expect(square).toBeDefined();
    expect(planArea(square!.mesh)).toBeCloseTo(900, 3);
    for (const up of faceUps(square!.mesh)) expect(up).toBeGreaterThan(0);
  });

  it("leaves a hole open", () => {
    const outer = box(0, 0, 30, 30);
    const hole = box(10, 10, 20, 20);
    const relation = {
      type: "relation",
      id: nextId++,
      tags: { ...SQUARE, type: "multipolygon" },
      members: [
        {
          type: "way",
          ref: nextId++,
          role: "outer",
          geometry: [...outer, outer[0]!].map(([x, y]) => at(x, y)),
        },
        {
          type: "way",
          ref: nextId++,
          role: "inner",
          geometry: [...hole, hole[0]!].map(([x, y]) => at(x, y)),
        },
      ],
    } as unknown as OsmFeature;
    const [square] = build([relation]);
    expect(planArea(square!.mesh)).toBeCloseTo(800, 3);
  });

  it("draws only inside the fetch window", () => {
    // The window's east edge runs through the middle of the square.
    const half = FRAME.toLatLng({ x: 15, y: 0 }).lng;
    const window: Bbox = { ...WIDE, east: half };
    const [square] = build([area(SQUARE, box(0, 0, 30, 30))], window);
    expect(planArea(square!.mesh)).toBeCloseTo(450, 0);
  });

  it("densifies to the terrain's post spacing, every vertex on the ground", () => {
    // Why: a 60 m square draped only at its four corners floats over a
    // hollow and sinks into a crest; cut at every post line, no triangle
    // spans more than one post cell, and every vertex is sampled.
    const ground = (p: { lat: number; lng: number }): number => {
      const { x, y } = FRAME.toEnu(p);
      return 3 * Math.sin(x / 9) + 0.05 * y;
    };
    const [square] = buildPedestrianAreas([area(SQUARE, box(-7, -7, 53, 53))], {
      frame: FRAME,
      window: WIDE,
      groundHeightM: ground,
    });
    const mesh = square!.mesh;
    const s = PEDESTRIAN_AREA_SPACING_M;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const xs: number[] = [];
      const zs: number[] = [];
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.indices[t + k] ?? 0;
        xs.push(mesh.positions[v * 3] ?? Number.NaN);
        zs.push(mesh.positions[v * 3 + 2] ?? Number.NaN);
      }
      const cellX = Math.floor((Math.min(...xs) + Math.max(...xs)) / 2 / s);
      const cellZ = Math.floor((Math.min(...zs) + Math.max(...zs)) / 2 / s);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(cellX * s - 1e-6);
      expect(Math.max(...xs)).toBeLessThanOrEqual((cellX + 1) * s + 1e-6);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(cellZ * s - 1e-6);
      expect(Math.max(...zs)).toBeLessThanOrEqual((cellZ + 1) * s + 1e-6);
    }
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const x = mesh.positions[v] ?? Number.NaN;
      const north = -(mesh.positions[v + 2] ?? Number.NaN);
      const y = mesh.positions[v + 1] ?? Number.NaN;
      const expected =
        ground(FRAME.toLatLng({ x, y: north })) + pedestrianAreaLiftM();
      expect(Math.abs(y - expected)).toBeLessThan(0.01);
    }
    expect(planArea(mesh)).toBeCloseTo(3600, 2);
  });

  it("densifies at the terrain's own post spacing by default", () => {
    expect(PEDESTRIAN_AREA_SPACING_M).toBe(TERRAIN_SPACING_M);
  });

  it("sits under every path that crosses it", () => {
    // Rank-0 paths lift from 0; an area at 0 would be coplanar with some.
    expect(pedestrianAreaLiftM()).toBeLessThanOrEqual(-0.003);
    expect(pedestrianAreaLiftM()).toBeGreaterThan(-0.04);
    expect(pedestrianAreaLiftM(0)).toBe(0);
  });

  it("draws O3's set: any highway area, never a node, a way without area=yes or one underground", () => {
    const drawn = build([
      area({ highway: "footway", area: "yes" }, box(0, 0, 5, 5)),
      area({ highway: "pedestrian" }, box(10, 0, 15, 5)),
      area({ area: "yes", landuse: "grass" }, box(20, 0, 25, 5)),
      area({ ...SQUARE, tunnel: "yes" }, box(30, 0, 35, 5)),
      area({ ...SQUARE, layer: "-1" }, box(40, 0, 45, 5)),
      { type: "node", id: nextId++, position: at(0, 0), tags: SQUARE },
    ] as OsmFeature[]);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.feature).toContain("way/");
  });

  it("skips a ring that is not closed", () => {
    const open = {
      type: "way",
      id: nextId++,
      tags: SQUARE,
      geometry: box(0, 0, 10, 10).map(([x, y]) => at(x, y)),
    } as unknown as OsmFeature;
    expect(build([open])).toEqual([]);
  });

  it("refuses a spacing that is not a positive number, and a lift that is not finite", () => {
    for (const spacingM of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildPedestrianAreas([], { frame: FRAME, window: WIDE, spacingM }),
      ).toThrow(RangeError);
    }
    expect(() =>
      buildPedestrianAreas([], {
        frame: FRAME,
        window: WIDE,
        liftM: Number.NaN,
      }),
    ).toThrow(RangeError);
  });
});

describe("one predicate for a pedestrian area (tint and mesh)", () => {
  it("is any highway with area=yes, and the tint paints it a square", () => {
    // A deliberate widening of the tint's old `highway=pedestrian` test to
    // the set the chosen prototype drew, so the two never disagree.
    expect(isPedestrianArea({ highway: "pedestrian", area: "yes" })).toBe(true);
    expect(isPedestrianArea({ highway: "footway", area: "yes" })).toBe(true);
    expect(isPedestrianArea({ highway: "pedestrian" })).toBe(false);
    expect(isPedestrianArea({ area: "yes" })).toBe(false);
    expect(groundClassOf({ highway: "footway", area: "yes" })).toBe("square");
  });
});
