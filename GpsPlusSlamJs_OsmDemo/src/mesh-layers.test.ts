/**
 * The mesh-layer table — one row per drawable layer, instead of a branch per layer.
 *
 * WHY THESE TESTS MATTER. `BuildingView.render` reached complexity 21 by growing a
 * pair of branches for every layer (one to draw it, one to zero its counters), and
 * W12–W15 add four more. The table removes the branches, but it introduces a new
 * failure mode that the branchy version could not have: **a layer can be missing
 * from the table entirely**, and a missing row draws nothing, reports nothing and
 * throws nothing — it looks exactly like a layer whose data happened to be empty.
 *
 * That is the same shape as the shader outage that hid every `MeshStandardMaterial`
 * for ten work items, so the coverage assertion below is the point of this file, not
 * a formality.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { groundLift } from "./layer-order.js";
import { ALL_LAYERS, type LayerKind } from "./layers.js";
import {
  MESH_LAYERS,
  DRAWN_BY_MESH,
  drawMeshLayers,
  meshLayerSelection,
  poiMarkerPosition,
} from "./mesh-layers.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** One triangle, enough for a layer to have something to draw. */
function triangle(): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  forcedEars: number;
} {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    triangleCount: 1,
    forcedEars: 0,
  };
}

const EMPTY = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  triangleCount: 0,
  forcedEars: 0,
};

/** A mesh in which EVERY layer has something to draw. */
function fullMesh(): TransferableMesh {
  return {
    buildings: triangle(),
    trees: [
      {
        position: { x: 10, y: 20 },
        groundHeightM: 53,
        heightM: 8,
        crownDiameterM: 4,
        rotationY: 0.5,
        variant: 0,
      },
    ],
    plates: triangle(),
    plateCount: 3,
    roads: triangle(),
    roadCount: 2,
    poi: [
      {
        feature: "node/4242",
        position: { x: 5, y: -7 },
        groundHeightM: 53,
        kind: "amenity=cafe",
        label: "Café Schmitz",
      },
    ],
    volumes: 21,
    parts: 25,
    guessedHeights: 7,
    approximateRoofs: 2,
  } as unknown as TransferableMesh;
}

/** A mesh in which every layer is present but empty. */
function emptyMesh(): TransferableMesh {
  return {
    buildings: EMPTY,
    trees: [],
    plates: EMPTY,
    plateCount: 0,
    roads: EMPTY,
    roadCount: 0,
    poi: [],
    volumes: 0,
    parts: 0,
    guessedHeights: 0,
    approximateRoofs: 0,
  };
}

/** Every layer on, whatever the table's defaults happen to be. */
const ALL_ON = Object.fromEntries(
  ALL_LAYERS.map((layer) => [layer, true]),
) as Record<LayerKind, boolean>;

describe("MESH_LAYERS — the table itself", () => {
  it("covers exactly the layers the mesh can draw, and no others", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A layer that the worker builds geometry
    // for but that has no row here is invisible in a way nothing else reports: it
    // draws nothing, contributes no counters, and raises no error. `DRAWN_BY_MESH`
    // is the declared truth; the table must match it exactly.
    //
    // Sorted rather than order-sensitive: the paint order is `layer-order.ts`'s
    // job, and pinning it twice would make one of the two the thing that drifts.
    expect([...MESH_LAYERS.map((one) => one.layer)].sort()).toEqual(
      [...DRAWN_BY_MESH].sort(),
    );
  });

  it("names only layers the registry knows about", () => {
    // A typo'd id would create a row that no toggle can ever reach, so the layer
    // would be permanently stuck on its default with no way to see why.
    const known = new Set<string>(ALL_LAYERS);
    for (const descriptor of MESH_LAYERS) {
      expect(known.has(descriptor.layer)).toBe(true);
    }
  });

  it("has exactly one row per layer", () => {
    // Two rows for one layer would draw it twice and double its counters — and
    // the doubled geometry is coplanar with itself, so it z-fights rather than
    // looking obviously wrong.
    const ids = MESH_LAYERS.map((one) => one.layer);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults to the picture the demo shipped with (W10's baseline)", () => {
    // The registry migration is only checkable against a known-good before, so an
    // omitted `layers` argument must still mean buildings + trees and no plates.
    const defaults = Object.fromEntries(
      MESH_LAYERS.map((one) => [one.layer, one.defaultOn]),
    );
    expect(defaults).toEqual({
      buildings: true,
      trees: true,
      plates: false,
      poi: false,
      roads: false,
    });
  });
});

describe("drawMeshLayers — what reaches the scene", () => {
  it("draws every layer that is on", () => {
    const { objects } = drawMeshLayers(fullMesh(), ALL_ON);
    // Buildings, plates, roads, one tree cone, one POI marker.
    expect(objects).toHaveLength(5);
    for (const object of objects) expect(object).toBeInstanceOf(THREE.Object3D);
  });

  it("draws nothing for a layer that is off", () => {
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
    });
    expect(objects).toEqual([]);
  });

  it("adds no object for a layer that is on but has no geometry", () => {
    // An empty `BufferGeometry` in the scene is not free — it is a draw call and a
    // disposal obligation — and an empty tree list must not produce a cone at the
    // origin, which is what a naive loop over `undefined` would do.
    const { objects } = drawMeshLayers(emptyMesh(), ALL_ON);
    expect(objects).toEqual([]);
  });

  it("uses the shared ladder for ground layers rather than a local constant", () => {
    // `layer-order.ts` exists because five things want to be at y ≈ 0 and any two
    // that end up coplanar z-fight. A layer that lifted itself would be outside
    // that guarantee while looking correct in isolation.
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      poi: false,
      roads: false,
    });
    expect(objects[0]?.position.y).toBeCloseTo(groundLift("plates"), 10);
  });

  it("falls back to each row's default when no selection is given", () => {
    const { objects, stats } = drawMeshLayers(fullMesh());
    // Buildings + tree, and no plate: exactly W10's baseline picture.
    expect(objects).toHaveLength(2);
    expect(stats.plates).toBe(0);
    expect(stats.volumes).toBe(21);
  });
});

describe("poiMarkerPosition", () => {
  // `satisfies`, not a plain literal: `feature` is a template-literal type
  // (`${string}/${number}`) and an object literal widens it to `string`.
  const marker = {
    feature: "node/1",
    position: { x: 30, y: 50 },
    groundHeightM: 53,
    kind: "amenity=cafe",
    label: "Café",
  } satisfies TransferableMesh["poi"][number];

  it("REFLECTS ENU north onto the scene's -z", () => {
    // WHY THIS TEST MATTERS, and it is not hypothetical. The identical
    // reflection was missing from the tree loop until 2026-07-29, and the
    // symptom was a forest rendered 100 m from the buildings it stands beside —
    // self-consistent, so it read as a data problem rather than a frame error.
    // Every tree assertion that existed at the time held in the mirrored world,
    // because they all compared trees against other trees.
    expect(poiMarkerPosition(marker)[2]).toBe(-50);
  });

  it("passes east through unchanged", () => {
    expect(poiMarkerPosition(marker)[0]).toBe(30);
  });

  it("stands the pin ON the ground rather than centred in it", () => {
    // A cone is centred on its origin, so a marker placed at the sampled ground
    // height is half buried — which at this pin size looks like a shorter pin
    // rather than like a bug.
    const [, y] = poiMarkerPosition(marker);
    expect(y).toBeGreaterThan(53);
    expect(y).toBeLessThan(53 + 6);
  });
});

describe("drawMeshLayers — POI markers", () => {
  it("carries the marker itself, so a pick can name what was clicked", () => {
    // The identity that reaches the details panel. Stored ON the object rather
    // than in a side table keyed by index: `clear()` and the next render rebuild
    // the scene, and an index-keyed table survives that silently while pointing at
    // the PREVIOUS working set — a panel confidently describing the wrong feature,
    // which is the half-swapped scene in its most damaging form.
    const { objects } = drawMeshLayers(fullMesh(), ALL_ON);
    const pin = objects.find((o) => o.userData["poi"] !== undefined);
    expect(pin).toBeDefined();
    expect((pin?.userData["poi"] as { label: string }).label).toBe(
      "Café Schmitz",
    );
  });

  it("SHARES one geometry and material, and flags them so nothing disposes them", () => {
    // WHY THIS TEST MATTERS. Markers are numerous and identical, which is the
    // whole reason the package emits placements instead of geometry — so the pins
    // share one geometry and one material. But `BuildingView.clear()` disposes the
    // geometry and material of every child it removes, which for a shared resource
    // means the FIRST refresh destroys it and every later frame draws nothing.
    //
    // That failure is silent in exactly the way this codebase keeps meeting:
    // three.js does not throw for a disposed geometry, the counters still report
    // the markers, and the layer simply stops appearing. The flag is what lets
    // `clear()` tell "mine to free" from "borrowed".
    const first = drawMeshLayers(fullMesh(), ALL_ON).objects.find(
      (o) => o.userData["poi"] !== undefined,
    );
    const second = drawMeshLayers(fullMesh(), ALL_ON).objects.find(
      (o) => o.userData["poi"] !== undefined,
    );
    expect(first).toBeInstanceOf(THREE.Mesh);
    const a = first as THREE.Mesh;
    const b = second as THREE.Mesh;
    // The same instances ACROSS calls, which is what makes disposal fatal.
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.userData["sharedResources"]).toBe(true);
  });
});

describe("drawMeshLayers — the counters", () => {
  it("reports what was DRAWN, not what was available", () => {
    // The status line describing geometry that is switched off is the class of
    // defect the store and the legend exist to prevent — it makes the number and
    // the picture disagree with no way to tell which is lying.
    const { stats } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
    });
    expect(stats.volumes).toBe(0);
    expect(stats.parts).toBe(0);
    expect(stats.triangles).toBe(0);
    expect(stats.guessedHeights).toBe(0);
    expect(stats.approximateRoofs).toBe(0);
    // The layers still on are untouched by the one that went off.
    expect(stats.trees).toBe(1);
    expect(stats.plates).toBe(3);
  });

  it("counts every layer when everything is on", () => {
    const { stats } = drawMeshLayers(fullMesh(), ALL_ON);
    expect(stats).toEqual({
      volumes: 21,
      parts: 25,
      triangles: 1,
      guessedHeights: 7,
      approximateRoofs: 2,
      trees: 1,
      plates: 3,
      plateTriangles: 1,
      poi: 1,
      roads: 2,
      roadTriangles: 1,
    });
  });

  it("returns a fully-populated stats object even with every layer off", () => {
    // `undefined` in a counter renders as "undefined" in the status line rather
    // than as 0, and `toBeGreaterThan(undefined)` passes — a real defect this repo
    // has already shipped once, via a dropped field in `buildHeightfieldData`.
    const { stats } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
    });
    for (const value of Object.values(stats)) expect(value).toBe(0);
    expect(Object.keys(stats)).toHaveLength(11);
  });
});

describe("meshLayerSelection", () => {
  it("picks exactly the mesh layers out of the full registry set", () => {
    // This is what keeps `main.ts` from hand-listing the mesh layers a second
    // time. It listed them twice before, so adding a layer meant remembering two
    // places and the failure of forgetting one was a layer that could be toggled
    // in the UI but never drew.
    const all = Object.fromEntries(
      ALL_LAYERS.map((layer) => [layer, true]),
    ) as Record<LayerKind, boolean>;
    const selection = meshLayerSelection({ ...all, plates: false });

    expect(Object.keys(selection).sort()).toEqual([...DRAWN_BY_MESH].sort());
    expect(selection.plates).toBe(false);
    expect(selection.buildings).toBe(true);
  });
});
