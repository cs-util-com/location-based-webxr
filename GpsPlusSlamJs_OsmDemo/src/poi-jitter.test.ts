/**
 * The view half of §4a: per-instance yaw and scale reach the instance matrix.
 *
 * WHY THESE TESTS MATTER. `poi.ts` computes a yaw per marker, but a value that
 * never reaches `InstancedMesh.setMatrixAt` changes nothing on screen — and
 * nothing else in the suite would notice, because every existing POI assertion
 * is about which mesh a marker lands in, not about how it is oriented. That is
 * exactly the shape of defect this repo keeps finding: the data is right, the
 * picture is unchanged, and the tests are green.
 *
 * The second thing pinned is the fallback cone's lift. The cone is centred on
 * its origin, so it is raised by half its height; scale it without scaling that
 * lift and every unmodelled marker sinks into or floats above the ground by a
 * few centimetres — small enough to look like terrain error rather than like a
 * bug.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { drawMeshLayers } from "./mesh-layers.js";
import type { TransferableMesh } from "./worker/protocol.js";

const NO_LAYERS = {
  buildings: false,
  trees: false,
  plates: false,
  roads: false,
  areas: false,
  poi: true,
} as const;

function meshWith(poi: TransferableMesh["poi"]): THREE.InstancedMesh[] {
  const mesh = {
    buildings: {
      positions: new Float32Array(),
      normals: new Float32Array(),
      indices: new Uint32Array(),
      triangleCount: 0,
    },
    trees: [],
    plates: [],
    plateCount: 0,
    roads: [],
    regions: [],
    poi,
  } as unknown as TransferableMesh;
  const { objects } = drawMeshLayers(mesh, NO_LAYERS);
  return objects as THREE.InstancedMesh[];
}

function marker(
  overrides: Partial<TransferableMesh["poi"][number]> & { kind: string },
): TransferableMesh["poi"][number] {
  return {
    feature: "node/1",
    position: { x: 0, y: 0 },
    groundHeightM: 0,
    label: overrides.kind,
    rotationY: 0,
    scale: 1,
    ...overrides,
  };
}

/** The instance's yaw about +y, recovered from its matrix. */
function yawOf(mesh: THREE.InstancedMesh, index: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return new THREE.Euler().setFromQuaternion(q, "YXZ").y;
}

/** The instance's uniform scale, recovered from its matrix. */
function scaleOf(mesh: THREE.InstancedMesh, index: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  return s.x;
}

/** The instance's world y, recovered from its matrix. */
function heightOf(mesh: THREE.InstancedMesh, index: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const p = new THREE.Vector3();
  m.decompose(p, new THREE.Quaternion(), new THREE.Vector3());
  return p.y;
}

describe("POI instance transforms carry the jitter (§4a)", () => {
  it("applies the marker's yaw to its instance matrix", () => {
    // The whole point of §4a. Before it this was `makeTranslation`, so every
    // bench in the city faced identical north however the placement varied.
    const meshes = meshWith([
      marker({ kind: "amenity=bench", rotationY: Math.PI / 2 }),
    ]);
    expect(meshes).toHaveLength(1);
    expect(yawOf(meshes[0] as THREE.InstancedMesh, 0)).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });

  it("applies the marker's scale uniformly", () => {
    const meshes = meshWith([marker({ kind: "amenity=bench", scale: 1.04 })]);
    expect(scaleOf(meshes[0] as THREE.InstancedMesh, 0)).toBeCloseTo(1.04, 6);
  });

  it("keeps distinct instances of one kind independently oriented", () => {
    // They share a mesh and a geometry, so the only place the difference can
    // live is the per-instance matrix. If the builder hoisted the transform out
    // of the loop, this is the test that catches it.
    const meshes = meshWith([
      marker({ feature: "node/1", kind: "amenity=bench", rotationY: 0.3 }),
      marker({ feature: "node/2", kind: "amenity=bench", rotationY: 2.1 }),
    ]);
    const mesh = meshes[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    expect(yawOf(mesh, 0)).toBeCloseTo(0.3, 6);
    expect(yawOf(mesh, 1)).toBeCloseTo(2.1, 6);
  });

  it("leaves the FALLBACK on the ground too, at any scale", () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the inversion is DEC-S19
    // landing rather than an assertion being weakened. The fallback was a CONE
    // centred on its origin, so it needed a lift of half its height — and that
    // lift had to scale with the geometry, or the cone buried itself by a few
    // centimetres, which reads as terrain error rather than as a defect.
    //
    // It is now a model built on the shared column with its base at y = 0, like
    // every other marker. There is no lift to scale, and the special case that
    // existed only for the cone is gone from the layer builder entirely.
    //
    // An unmodelled kind is the common case — ~650 of them against fifty — so
    // this is not an edge case, it is most of the scene.
    const meshes = meshWith([
      marker({ kind: "amenity=nonexistent", groundHeightM: 41, scale: 1.05 }),
    ]);
    expect(heightOf(meshes[0] as THREE.InstancedMesh, 0)).toBeCloseTo(41, 6);
  });

  it("leaves a modelled marker's base on the ground whatever its scale", () => {
    // Every model is built with its base at y = 0, so the sampled ground height
    // IS the answer and scale must not lift it. A scaled model that floats
    // would look like the DEM being wrong.
    const meshes = meshWith([
      marker({ kind: "amenity=bench", groundHeightM: 53, scale: 1.05 }),
    ]);
    expect(heightOf(meshes[0] as THREE.InstancedMesh, 0)).toBeCloseTo(53, 6);
  });
});
