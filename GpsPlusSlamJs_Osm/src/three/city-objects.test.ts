import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { buildCity } from "../mesh/city.js";
import { enuFrameAt } from "../mesh/enu.js";
import type { OsmFeature } from "../model/osm-feature.js";
import {
  applyWoodsShare,
  buildingObjects,
  cityObjects,
  cosmeticTreeObjects,
  disposeCityObjects,
  geometryFrom,
  roadObjects,
  treeObjects,
} from "./city-objects.js";

/**
 * The three.js side of the city (`gps-plus-slam-osm/three`), moved from
 * OsmDemo's `mesh-layers.ts` when the globe became the library's second
 * consumer (globe city plan 2026-10-05-0040 §14 L5, the owner's D-K6). These
 * pin what both apps draw: one coloured, single-sided, flat-shaded mesh per
 * building chunk carrying the shell attributes and the picking flag, one
 * instanced mesh per tree variant on shared resources, and a disposal that
 * never frees what is shared.
 */
const frame = enuFrameAt({ lat: 50.9413, lng: 6.9583 });
/** The fetched window every build is given: wide enough for every test feature. */
const W = { south: 50.9, west: 6.9, north: 51.0, east: 7.0 };
const HOUSE: OsmFeature = {
  type: "way",
  id: 1,
  tags: { building: "house", "building:colour": "#cc2200" },
  geometry: [
    { lat: 50.9413, lng: 6.9583 },
    { lat: 50.9413, lng: 6.9585 },
    { lat: 50.9415, lng: 6.9585 },
    { lat: 50.9415, lng: 6.9583 },
    { lat: 50.9413, lng: 6.9583 },
  ],
};
const tree = (id: number, leaf: string): OsmFeature => ({
  type: "node",
  id,
  tags: { natural: "tree", leaf_type: leaf },
  position: { lat: 50.9409 + id * 1e-5, lng: 6.959 },
});
const city = buildCity(
  [
    HOUSE,
    tree(10, "broadleaved"),
    tree(11, "broadleaved"),
    tree(12, "needleleaved"),
  ],
  { frame },
  { window: W },
);

describe("geometryFrom", () => {
  it("wraps the buffers with the colour and shell attributes when given", () => {
    const chunk = city.buildings[0]!;
    const g = geometryFrom(chunk.mesh, chunk.colors, {
      height01: chunk.height01,
      featureRand: chunk.featureRand,
    });
    for (const name of [
      "position",
      "normal",
      "color",
      "aHeight01",
      "aFeatureRand",
    ]) {
      expect(g.getAttribute(name), name).toBeDefined();
    }
    expect(g.getIndex()?.count).toBe(chunk.mesh.indices.length);
  });

  it("leaves the optional attributes off when not given", () => {
    const g = geometryFrom(city.buildings[0]!.mesh);
    expect(g.getAttribute("color")).toBeUndefined();
    expect(g.getAttribute("aHeight01")).toBeUndefined();
  });
});

describe("buildingObjects", () => {
  it("draws one mesh per chunk, coloured per vertex, single-sided and flat", () => {
    const meshes = buildingObjects(city.buildings);
    expect(meshes).toHaveLength(city.buildings.length);
    const m = meshes[0]!;
    const material = m.material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.flatShading).toBe(true);
    expect(material.roughness).toBeCloseTo(0.55, 9);
    expect(material.metalness).toBe(0);
    // The flags OsmDemo's lighting and picking read.
    expect(material.userData["neutralSurface"]).toBe(true);
    expect(m.userData["solid"]).toBe(true);
    // The globe's building light keys on this layer name, not on the picking
    // marker above (#905 review): without it the globe's buildings would
    // drop back to the linear colours' dark look with no test failing there.
    expect(m.userData["cityLayer"]).toBe("buildings");
  });

  // WHY: a hoisted, shared building material is either disposed on the first
  // refresh or leaks the chunk's own geometry (OsmDemo's PR #239 lesson).
  it("gives each chunk its own material", () => {
    const two = buildingObjects([city.buildings[0]!, city.buildings[0]!]);
    expect(two[0]!.material).not.toBe(two[1]!.material);
  });
});

describe("treeObjects", () => {
  it("draws one instanced mesh per variant present, on shared resources", () => {
    const trees = treeObjects(city.trees);
    const counts = trees.map((t) => t.count).sort();
    expect(counts).toEqual([1, 2]);
    for (const t of trees) expect(t.userData["sharedResources"]).toBe(true);
    // The same geometry and material for every call: shared, not rebuilt.
    const again = treeObjects(city.trees);
    expect(again[0]!.material).toBe(trees[0]!.material);
  });

  it("draws nothing for no trees", () => {
    expect(treeObjects([])).toEqual([]);
  });

  it("colours each instance from its placement, converted from sRGB", () => {
    // WHY THIS MATTERS. The class colour reaches the screen only through
    // `instanceColor`; three.js shades in linear space, so a raw sRGB value
    // there would draw every tree lighter and greyer than the palette.
    const trees = treeObjects(city.trees);
    const broad = trees.find((t) => t.count === 2)!;
    expect(broad.instanceColor).not.toBeNull();
    const placement = city.trees.find((t) => t.variant === "broadleaved")!;
    const expected = new THREE.Color().setHex(
      placement.colour,
      THREE.SRGBColorSpace,
    );
    const got = new THREE.Color();
    broad.getColorAt(0, got);
    expect(got.r).toBeCloseTo(expected.r, 5);
    expect(got.g).toBeCloseTo(expected.g, 5);
    expect(got.b).toBeCloseTo(expected.b, 5);
  });

  it("draws the crown-only forms on a white, vertex-coloured, flat material", () => {
    // WHY THIS MATTERS. The forms are the O1 look the owner chose: a broad
    // and a neutral hull of 20 triangles, a needle cone of 10, each darker
    // at the foot (0.86) than at the top (1.04), on a white material so the
    // instance colour is not tinted. An untagged tree is the neutral form,
    // not today's fir cone (DEC-R4-10).
    const untagged: OsmFeature = {
      type: "node",
      id: 13,
      tags: { natural: "tree" },
      position: { lat: 50.941, lng: 6.959 },
    };
    const all = treeObjects(
      buildCity(
        [tree(10, "broadleaved"), tree(12, "needleleaved"), untagged],
        {
          frame,
        },
        { window: W },
      ).trees,
    );
    expect(all).toHaveLength(3);
    const triangles = all.map(
      (t) => t.geometry.getAttribute("position").count / 3,
    );
    expect(triangles.sort((a, b) => a - b)).toEqual([10, 20, 20]);
    const geometries = new Set(all.map((t) => t.geometry));
    expect(geometries.size).toBe(3);
    for (const t of all) {
      const material = t.material as THREE.MeshStandardMaterial;
      expect(material.vertexColors).toBe(true);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.flatShading).toBe(true);
      expect(material.roughness).toBeCloseTo(0.9, 9);
      const position = t.geometry.getAttribute("position");
      const colour = t.geometry.getAttribute("color");
      for (let i = 0; i < position.count; i++) {
        expect(colour.getX(i)).toBeCloseTo(0.86 + 0.18 * position.getY(i), 5);
      }
      const box = new THREE.Box3().setFromBufferAttribute(
        position as THREE.BufferAttribute,
      );
      // Unit height from the ground, unit diameter at most.
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(1, 6);
      expect(box.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});

describe("disposeCityObjects", () => {
  // WHY: three.js does not throw for a disposed geometry, it silently draws
  // nothing, so freeing a shared tree geometry would empty every later city's
  // trees with the counters still reporting them.
  it("frees what a building owns and never what the trees share", () => {
    const objects = cityObjects(city);
    const building = objects.find((o) => o.userData["solid"]) as THREE.Mesh;
    const trees = objects.filter((o) => o.userData["sharedResources"]);
    const ownGeometry = vi.spyOn(building.geometry, "dispose");
    const ownMaterial = vi.spyOn(
      building.material as THREE.Material,
      "dispose",
    );
    const shared = trees.map((t) =>
      vi.spyOn((t as THREE.InstancedMesh).geometry, "dispose"),
    );
    disposeCityObjects(objects);
    expect(ownGeometry).toHaveBeenCalledTimes(1);
    expect(ownMaterial).toHaveBeenCalledTimes(1);
    for (const s of shared) expect(s).not.toHaveBeenCalled();
  });
});

// WHY (round-4 plan 2026-10-11-0122 DEC-R4-7): the roads OsmDemo draws are
// the globe's too, so their three.js row moved here from OsmDemo's
// `mesh-layers.ts`: white plus vertex colours (the palette is per vertex),
// opaque (a vertex disc overlaps its quads; translucent, every junction
// would double-blend into a blob), single-sided (a ribbon faces up by
// construction, so a wrong winding disappears instead of being lit from
// below), flat, rough, a target of the noon brightening. The lift off the
// ground is each app's (its own ground differs).
describe("roadObjects", () => {
  const ROAD: OsmFeature = {
    type: "way",
    id: 30,
    tags: { highway: "residential" },
    geometry: [
      { lat: 50.9412, lng: 6.958 },
      { lat: 50.9412, lng: 6.9595 },
    ],
  };
  const withRoads = buildCity(
    [HOUSE, ROAD],
    { frame },
    { window: W, roads: true },
  );

  it("draws one opaque, single-sided, vertex-coloured mesh per road chunk, at the ground", () => {
    const roads = roadObjects(withRoads.roads);
    expect(roads).toHaveLength(withRoads.roads.length);
    for (const road of roads) {
      const m = road.material as THREE.MeshStandardMaterial;
      expect(m.vertexColors).toBe(true);
      expect(m.color.getHex()).toBe(0xffffff);
      expect(m.transparent).toBe(false);
      expect(m.side).toBe(THREE.FrontSide);
      expect(m.flatShading).toBe(true);
      expect(m.roughness).toBe(0.9);
      expect(m.userData["neutralSurface"]).toBe(true);
      expect(road.geometry.getAttribute("color")).toBeDefined();
      expect(road.position.y).toBe(0);
      expect(road.userData["cityLayer"]).toBe("roads");
    }
  });

  it("is part of the city's objects when the city has roads, and freed with them", () => {
    const objects = cityObjects(withRoads);
    const roads = objects.filter((o) => o.userData["cityLayer"] === "roads");
    expect(roads).toHaveLength(withRoads.roads.length);
    const road = roads[0] as THREE.Mesh;
    const freed = vi.spyOn(road.geometry, "dispose");
    disposeCityObjects(objects);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(
      cityObjects(city).some((o) => o.userData["cityLayer"] === "roads"),
    ).toBe(false);
  });
});

// WHY (city objects plan 2026-11-07-2315 M2a): invented trees are drawn in
// their own instanced meshes, flagged `userData.cosmetic`, so an app can hide
// them (OsmDemo's `woods` layer, AR) without touching the mapped trees, and
// each mesh keeps the build's rank order, which is what a phone governor
// thins by (draw the first n instances).
describe("cosmeticTreeObjects", () => {
  const forest: OsmFeature = {
    type: "way",
    id: 30,
    tags: { landuse: "forest", leaf_type: "mixed" },
    geometry: [
      { lat: 50.942, lng: 6.96 },
      { lat: 50.942, lng: 6.961 },
      { lat: 50.9425, lng: 6.961 },
      { lat: 50.9425, lng: 6.96 },
      { lat: 50.942, lng: 6.96 },
    ],
  };
  const wooded = buildCity([forest, HOUSE], { frame }, { window: W });

  it("draws one cosmetic instanced mesh per form, in rank order", () => {
    const objects = cosmeticTreeObjects(wooded.cosmeticTrees);
    expect(objects).toHaveLength(2);
    let total = 0;
    for (const mesh of objects) {
      expect(mesh.userData).toEqual({ sharedResources: true, cosmetic: true });
      total += mesh.count;
    }
    expect(total).toBe(wooded.cosmeticTrees.length);
    // Instance 0 of each mesh is the first tree of its form in the build:
    // packing kept the rank order.
    const firsts = ["needleleaved", "broadleaved"].map((v) =>
      wooded.cosmeticTrees.find((t) => t.variant === v)!,
    );
    const m = new THREE.Matrix4();
    const starts = objects.map((mesh) => {
      mesh.getMatrixAt(0, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      return [p.x.toFixed(2), (-p.z).toFixed(2)].join(",");
    });
    expect(new Set(starts)).toEqual(
      new Set(
        firsts.map((t) =>
          [t.position.x.toFixed(2), t.position.y.toFixed(2)].join(","),
        ),
      ),
    );
  });

  it("is drawn by cityObjects when the city has them, the mapped trees unflagged", () => {
    const plain = cityObjects({
      buildings: wooded.buildings,
      trees: wooded.trees,
    });
    expect(plain.some((o) => o.userData["cosmetic"])).toBe(false);
    const all = cityObjects(wooded);
    expect(all.filter((o) => o.userData["cosmetic"])).toHaveLength(2);
    expect(cosmeticTreeObjects([])).toEqual([]);
  });
});

describe("applyWoodsShare", () => {
  const forest: OsmFeature = {
    type: "way",
    id: 31,
    tags: { landuse: "forest", leaf_type: "mixed" },
    geometry: [
      { lat: 50.942, lng: 6.96 },
      { lat: 50.942, lng: 6.961 },
      { lat: 50.9425, lng: 6.961 },
      { lat: 50.9425, lng: 6.96 },
      { lat: 50.942, lng: 6.96 },
    ],
  };
  const wooded = buildCity(
    [forest, HOUSE, tree(10, "broadleaved")],
    { frame },
    { window: W },
  );

  // The governor's lever: a rank prefix of each invented-tree mesh, so the
  // woods thin evenly with no rebuild, and full brings every tree back.
  // Mapped trees are real objects and are never thinned.
  it("draws a rank prefix of each invented-tree mesh and leaves the mapped trees", () => {
    const objects = cityObjects(wooded);
    const cosmetic = objects.filter(
      (o): o is THREE.InstancedMesh => o.userData["cosmetic"] === true,
    );
    const mapped = objects.filter(
      (o): o is THREE.InstancedMesh =>
        o instanceof THREE.InstancedMesh && o.userData["cosmetic"] !== true,
    );
    const full = cosmetic.map((m) => m.count);
    const mappedCounts = mapped.map((m) => m.count);
    expect(applyWoodsShare(objects, 0.5)).toBe(
      full.reduce((s, n) => s + Math.ceil(n * 0.5), 0),
    );
    expect(cosmetic.map((m) => m.count)).toEqual(
      full.map((n) => Math.ceil(n * 0.5)),
    );
    applyWoodsShare(objects, 0.25);
    expect(cosmetic.map((m) => m.count)).toEqual(
      full.map((n) => Math.ceil(n * 0.25)),
    );
    expect(applyWoodsShare(objects, 1)).toBe(wooded.cosmeticTrees.length);
    expect(cosmetic.map((m) => m.count)).toEqual(full);
    expect(mapped.map((m) => m.count)).toEqual(mappedCounts);
  });

  // The same lever for the trunk form, whose meshes are sorted by distance:
  // the share limits which trees take part in the sort.
  it("thins the trunk form too, counting each invented tree once", () => {
    const objects = cityObjects(wooded, { treeForm: "trunk" });
    const n = wooded.cosmeticTrees.length;
    const drawn = applyWoodsShare(objects, 0.5);
    for (const object of objects) {
      if (object instanceof THREE.InstancedMesh) {
        object.onBeforeRender(
          {} as THREE.WebGLRenderer,
          new THREE.Scene(),
          new THREE.PerspectiveCamera(),
          object.geometry,
          object.material as THREE.Material,
          null as unknown as THREE.Group,
        );
      }
    }
    const crowns = objects.filter(
      (o): o is THREE.InstancedMesh =>
        o.userData["cosmetic"] === true && o.userData["treePart"] === "crown",
    );
    const total = crowns.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(drawn);
    expect(drawn).toBeLessThan(n);
    expect(drawn).toBeGreaterThanOrEqual(n / 2);
  });

  it("refuses a share outside (0, 1]", () => {
    for (const share of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => applyWoodsShare([], share)).toThrow(RangeError);
    }
  });
});

describe("tree forms", () => {
  // Off by default: the crown-only look the owner chose stays what every
  // consumer draws unless it asks for the trunk form.
  it("draws the crown-only form unless the trunk form is asked for", () => {
    const crownOnly = cityObjects(city);
    expect(crownOnly.some((o) => o.userData["treeForm"] === "trunk")).toBe(
      false,
    );
    const trunked = cityObjects(city, { treeForm: "trunk" });
    const forms = trunked.filter((o) => o.userData["treeForm"] === "trunk");
    // Two forms present (broad, needle), four meshes each.
    expect(forms).toHaveLength(8);
    expect(() => treeObjects(city.trees, { form: "palm" as "trunk" })).toThrow(
      RangeError,
    );
  });
});
