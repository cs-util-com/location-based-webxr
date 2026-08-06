/**
 * The renderer half of stage 1: a marker's host actually changes where it draws.
 *
 * WHY THESE TESTS MATTER, and it is not the resolver being re-tested.
 * `poi-hosts.test.ts` proves the RULE — given hosts and layers, which placement.
 * Nothing there can tell whether the answer reaches an instance matrix, and a
 * placement that is computed and then ignored is the exact shape of defect this
 * repo keeps finding: the data is right, the picture is unchanged, and the suite
 * is green. `poi-jitter.test.ts` exists for the same reason, one field earlier.
 *
 * The layer case is the one that cannot be checked any other way. Toggling
 * `plates` changes which markers exist, and the whole reason that rule lives on
 * the main thread is that a toggle never re-runs the worker — so the only place
 * the coupling is observable is here, in what `drawMeshLayers` returns for the
 * same payload under two layer sets.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { drawMeshLayers } from "./mesh-layers.js";
import type { TransferableMesh } from "./worker/protocol.js";

const POI_ONLY = {
  buildings: false,
  trees: false,
  plates: false,
  roads: false,
  areas: false,
  poi: true,
} as const;

function meshWith(poi: TransferableMesh["poi"]): TransferableMesh {
  return {
    // An EMPTY array rather than an empty mesh: unlike the jitter tests, these
    // switch the buildings LAYER on -- that is how a building host becomes
    // eligible -- so its row actually runs and iterates this.
    buildings: [],
    trees: [],
    plates: [],
    plateCount: 0,
    roads: [],
    regions: [],
    poi,
  } as unknown as TransferableMesh;
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
    hosts: [],
    ...overrides,
  };
}

/** Where instance `index` of the first drawn mesh ended up. */
function positionOf(objects: THREE.Object3D[], index = 0): THREE.Vector3 {
  const pins = objects[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  pins.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

const buildingHost = {
  layer: "buildings" as const,
  feature: "way/9" as const,
  x: 40,
  y: 25,
  topM: 18,
  spanM: 24,
};

describe("a marker with a building host", () => {
  it("draws over the building's centroid, not over its own node", () => {
    // THE FEATURE. The café stops being a marker inside a wall and becomes the
    // label the building was missing.
    const { objects } = drawMeshLayers(
      meshWith([
        marker({
          kind: "amenity=cafe",
          position: { x: -300, y: -300 },
          hosts: [buildingHost],
        }),
      ]),
      { ...POI_ONLY, buildings: true },
    );
    const at = positionOf(objects);
    expect(at.x).toBeCloseTo(40, 4);
    // ENU `+y` NORTH becomes scene `-z`. Getting this wrong renders the symbol
    // 50 m south of its building, labelled correctly — which reads as a data
    // error and is a frame error.
    expect(at.z).toBeCloseTo(-25, 4);
    expect(at.y).toBeGreaterThan(18);
  });

  it("STAYS AT ITS NODE when the buildings layer is off", () => {
    // The coupling that only exists here. A toggle does not re-run the worker,
    // so the host annotation is unchanged — only the layer set differs, and
    // that alone has to move the marker back.
    const { objects } = drawMeshLayers(
      meshWith([
        marker({
          kind: "amenity=cafe",
          position: { x: -300, y: -300 },
          groundHeightM: 7,
          hosts: [buildingHost],
        }),
      ]),
      POI_ONLY,
    );
    const at = positionOf(objects);
    expect(at.x).toBeCloseTo(-300, 4);
    expect(at.z).toBeCloseTo(300, 4);
    expect(at.y).toBeCloseTo(7, 4);
  });

  it("draws the SYMBOL alone, which is fewer triangles than the marker", () => {
    // A column standing on a roof would be a marker growing out of a building —
    // the thing this whole change exists to stop drawing. The triangle count is
    // the observable difference, since both are one InstancedMesh of one.
    const hosted = drawMeshLayers(
      meshWith([marker({ kind: "amenity=cafe", hosts: [buildingHost] })]),
      { ...POI_ONLY, buildings: true },
    );
    const atNode = drawMeshLayers(
      meshWith([marker({ kind: "amenity=cafe" })]),
      { ...POI_ONLY, buildings: true },
    );
    const count = (objects: THREE.Object3D[]): number =>
      ((objects[0] as THREE.InstancedMesh).geometry.getIndex()?.count ?? 0) / 3;
    expect(count(hosted.objects)).toBeGreaterThan(0);
    expect(count(hosted.objects)).toBeLessThan(count(atNode.objects));
  });

  it("keeps hosted and un-hosted markers of one kind in SEPARATE meshes", () => {
    // Same kind, two geometries: they cannot share an InstancedMesh. If the
    // bucketing ever collapsed them, one of the two would silently draw the
    // other's geometry — a column on a roof, or a symbol with no stand.
    const { objects } = drawMeshLayers(
      meshWith([
        marker({ kind: "amenity=cafe", hosts: [buildingHost] }),
        marker({ kind: "amenity=cafe", feature: "node/2" }),
      ]),
      { ...POI_ONLY, buildings: true },
    );
    expect(objects).toHaveLength(2);
  });
});

describe("a marker whose area already describes it", () => {
  const plateHost = {
    layer: "plates" as const,
    feature: "way/3" as const,
    x: 0,
    y: 0,
    topM: 0,
    spanM: 30,
  };

  it("is not drawn at all when its plate is drawn", () => {
    // "Das wäre ja quasi doppelt." The pool's own area says everything the
    // marker would.
    const { objects } = drawMeshLayers(
      meshWith([marker({ kind: "leisure=swimming_pool", hosts: [plateHost] })]),
      { ...POI_ONLY, plates: true },
    );
    expect(objects).toHaveLength(0);
  });

  it("IS drawn when the plates layer is off", () => {
    // THE ASSERTION DEC-S1 EXISTS FOR, at the level where it is observable.
    // `plates` is off by default, so suppressing on the data rather than on what
    // is drawn would make every swimming pool invisible under the shipped
    // settings — a data loss that looks like a rendering bug.
    const { objects } = drawMeshLayers(
      meshWith([marker({ kind: "leisure=swimming_pool", hosts: [plateHost] })]),
      POI_ONLY,
    );
    expect(objects).toHaveLength(1);
  });

  it("still COUNTS a suppressed marker, because the feature is still there", () => {
    // The counter reports what the data holds, not what survived a drawing
    // rule. A count that dropped with the geometry would make "the fetch found
    // nothing" and "the fetch found a pool we chose not to draw" the same
    // reading in the status line.
    const { stats } = drawMeshLayers(
      meshWith([marker({ kind: "leisure=swimming_pool", hosts: [plateHost] })]),
      { ...POI_ONLY, plates: true },
    );
    expect(stats.poi).toBe(1);
  });
});
