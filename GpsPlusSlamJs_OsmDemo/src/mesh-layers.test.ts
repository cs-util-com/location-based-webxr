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
    expect(defaults).toEqual({ buildings: true, trees: true, plates: false });
  });
});

describe("drawMeshLayers — what reaches the scene", () => {
  it("draws every layer that is on", () => {
    const { objects } = drawMeshLayers(fullMesh(), ALL_ON);
    // One buildings mesh, one plates mesh, one tree cone.
    expect(objects).toHaveLength(3);
    for (const object of objects) expect(object).toBeInstanceOf(THREE.Object3D);
  });

  it("draws nothing for a layer that is off", () => {
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
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
    });
    for (const value of Object.values(stats)) expect(value).toBe(0);
    expect(Object.keys(stats)).toHaveLength(8);
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
