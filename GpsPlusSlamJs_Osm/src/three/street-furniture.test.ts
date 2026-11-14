import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildCity } from "../mesh/city.js";
import { enuFrameAt } from "../mesh/enu.js";
import type { FurniturePlacement } from "../mesh/street-furniture.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { cityObjects, disposeCityObjects } from "./city-objects.js";
import {
  FURNITURE_CUT_M,
  FURNITURE_REPACK_M,
  repackFurniture,
  streetFurnitureObjects,
} from "./street-furniture.js";

/**
 * WHY THESE TESTS MATTER. Furniture is hundreds of small instances drawn
 * only near the eye: the renderer packs the items within the cut to the
 * front of each instanced mesh and sets `count`. A wrong eye frame (a parent
 * transform ignored) cuts the wrong street; a repack on every frame costs a
 * matrix write per item per frame; a stretched model at the wrong height
 * puts a lamp head in a window; and a disposed shared geometry silently
 * draws nothing on the next city.
 */
const item = (
  over: Partial<FurniturePlacement> & Pick<FurniturePlacement, "key">,
): FurniturePlacement => ({
  kind: "lamp",
  model: "lamp",
  position: { x: 0, y: 0 },
  groundHeightM: 0,
  yawRad: 0,
  heightM: 5,
  guessed: [],
  ...over,
});

const matrixAt = (mesh: THREE.InstancedMesh, i: number) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
};

describe("streetFurnitureObjects", () => {
  it("draws one instanced mesh per model present, on shared resources", () => {
    const objects = streetFurnitureObjects([
      item({ key: "node/1" }),
      item({ key: "node/2", model: "lamp-wall", heightM: 4 }),
      item({
        key: "node/3",
        kind: "bench",
        model: "bench",
        heightM: undefined,
      }),
      item({ key: "node/4" }),
    ] as FurniturePlacement[]);
    expect(objects.map((o) => o.userData["furnitureModel"] as unknown)).toEqual(
      ["lamp", "lamp-wall", "bench"],
    );
    for (const mesh of objects) {
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.userData["sharedResources"]).toBe(true);
      expect(mesh.userData["cityLayer"]).toBe("furniture");
      // Nothing is drawn until the first repack knows where the eye is.
      expect(mesh.count).toBe(0);
    }
    // Shared across calls: the next city borrows the same geometry.
    const again = streetFurnitureObjects([item({ key: "node/9" })]);
    expect(again[0]?.geometry).toBe(objects[0]?.geometry);
    expect(again[0]?.material).toBe(objects[0]?.material);
    expect(streetFurnitureObjects([])).toEqual([]);
  });

  it("lists what was guessed per instance", () => {
    const [mesh] = streetFurnitureObjects([
      item({ key: "node/1", guessed: ["height", "yaw"] }),
    ]);
    expect(mesh?.userData["guessed"]).toEqual([
      { key: "node/1", fields: ["height", "yaw"] },
    ]);
  });

  it("places, turns and stretches each item in scene axes", () => {
    const [mesh] = streetFurnitureObjects([
      item({
        key: "node/1",
        position: { x: 3, y: 4 },
        groundHeightM: 2,
        yawRad: Math.PI / 2,
        heightM: 7.5,
      }),
    ]);
    repackFurniture(mesh!, { x: 0, y: 0 });
    const { p, q, s } = matrixAt(mesh!, 0);
    // ENU north to scene -z, the reflection every city buffer takes.
    expect([p.x, p.y, p.z]).toEqual([3, 2, -4]);
    expect(s.y).toBeCloseTo(7.5 / 5);
    expect(s.x).toBeCloseTo(1);
    const turned = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(-1);
  });

  it("draws a bench and a bin at their own size", () => {
    const [mesh] = streetFurnitureObjects([
      {
        ...item({ key: "node/1", kind: "bin", model: "bin" }),
        heightM: undefined,
      },
    ] as FurniturePlacement[]);
    repackFurniture(mesh!, { x: 0, y: 0 });
    expect(matrixAt(mesh!, 0).s.y).toBeCloseTo(1);
  });

  it("refuses a cut or repack distance that is not positive", () => {
    expect(() => streetFurnitureObjects([], { cutM: 0 })).toThrow(RangeError);
    expect(() => streetFurnitureObjects([], { repackM: -1 })).toThrow(
      RangeError,
    );
  });
});

describe("repackFurniture", () => {
  const row = Array.from({ length: 30 }, (_, i) =>
    item({ key: `node/${i + 1}`, position: { x: i * 10, y: 0 } }),
  );

  it("packs the items within the cut, and repacks only after the eye moved", () => {
    expect(FURNITURE_CUT_M).toBe(80);
    expect(FURNITURE_REPACK_M).toBe(4);
    const [mesh] = streetFurnitureObjects(row);
    expect(repackFurniture(mesh!, { x: 0, y: 0 })).toBe(true);
    expect(mesh!.count).toBe(9); // 0..80 m
    expect(repackFurniture(mesh!, { x: 3.9, y: 0 })).toBe(false);
    expect(mesh!.count).toBe(9);
    expect(repackFurniture(mesh!, { x: 100, y: 0 })).toBe(true);
    expect(mesh!.count).toBe(17); // 20..180 m
    expect(matrixAt(mesh!, 0).p.x).toBe(20);
  });

  it("keeps every item with an infinite cut", () => {
    const [mesh] = streetFurnitureObjects(row, { cutM: Infinity });
    repackFurniture(mesh!, { x: -5000, y: 0 });
    expect(mesh!.count).toBe(30);
  });

  // The eye is the camera in the mesh's OWN frame: a content root that moves
  // or turns the city (OsmDemo re-anchors) must not move the cut.
  it("cuts around the camera in the mesh's own frame before each render", () => {
    const [mesh] = streetFurnitureObjects(row, { cutM: 15 });
    const root = new THREE.Group();
    root.position.set(1000, 0, 0);
    root.rotation.y = Math.PI / 2;
    root.add(mesh!);
    root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    // Local (x 200, z 0) is world (1000, 0, -200) under that root.
    camera.position.copy(mesh!.localToWorld(new THREE.Vector3(200, 1.6, 0)));
    camera.updateMatrixWorld(true);
    mesh!.onBeforeRender(
      {} as THREE.WebGLRenderer,
      new THREE.Scene(),
      camera,
      mesh!.geometry,
      mesh!.material as THREE.Material,
      null as never,
    );
    expect(mesh!.count).toBe(3); // the items at 190, 200 and 210 m
    expect(matrixAt(mesh!, 0).p.x).toBe(190);
  });

  it("is idempotent at the same eye, and keeps only items within the cut", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -300, max: 300 }),
            y: fc.integer({ min: -300, max: 300 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: 1, max: 200 }),
        (points, ex, ey, cutM) => {
          const items = points.map((position, i) =>
            item({ key: `node/${i + 1}`, position }),
          );
          const [mesh] = streetFurnitureObjects(items, { cutM });
          const eye = { x: ex, y: ey };
          repackFurniture(mesh!, eye);
          const before = Array.from(mesh!.instanceMatrix.array);
          const count = mesh!.count;
          expect(repackFurniture(mesh!, eye)).toBe(false);
          expect(mesh!.count).toBe(count);
          expect(Array.from(mesh!.instanceMatrix.array)).toEqual(before);
          const inside = points.filter(
            (p) => Math.hypot(p.x - ex, p.y - ey) <= cutM,
          ).length;
          expect(count).toBe(inside);
          for (let i = 0; i < count; i++) {
            const { p } = matrixAt(mesh!, i);
            expect(Math.hypot(p.x - ex, -p.z - ey)).toBeLessThanOrEqual(
              cutM + 1e-9,
            );
          }
        },
      ),
    );
  });
});

describe("cityObjects with furniture", () => {
  const frame = enuFrameAt({ lat: 50.9413, lng: 6.9583 });
  const W = { south: 50.9, west: 6.9, north: 51.0, east: 7.0 };
  const lamp: OsmFeature = {
    type: "node",
    id: 5,
    tags: { highway: "street_lamp" },
    position: { lat: 50.9414, lng: 6.9584 },
  };

  it("draws the city's furniture at the cut asked for, and never frees it", () => {
    const city = buildCity([lamp], { frame }, { window: W });
    const objects = cityObjects(city, { furnitureCutM: 40 });
    const furniture = objects.filter(
      (o) => o.userData["cityLayer"] === "furniture",
    ) as THREE.InstancedMesh[];
    expect(furniture).toHaveLength(1);
    repackFurniture(furniture[0]!, { x: 0, y: 0 });
    expect(furniture[0]!.count).toBe(1);
    repackFurniture(furniture[0]!, { x: 60, y: 0 });
    expect(furniture[0]!.count).toBe(0);
    disposeCityObjects(objects);
    const again = cityObjects(city);
    const mesh = again.find(
      (o) => o.userData["cityLayer"] === "furniture",
    ) as THREE.InstancedMesh;
    expect(mesh.geometry.getAttribute("position")).toBeDefined();
    expect(
      cityObjects({ buildings: [], trees: [] }).filter(
        (o) => o.userData["cityLayer"] === "furniture",
      ),
    ).toEqual([]);
  });
});
