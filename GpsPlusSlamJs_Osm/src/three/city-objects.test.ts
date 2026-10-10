import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { buildCity } from "../mesh/city.js";
import { enuFrameAt } from "../mesh/enu.js";
import type { OsmFeature } from "../model/osm-feature.js";
import {
  buildingObjects,
  cityObjects,
  disposeCityObjects,
  geometryFrom,
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
