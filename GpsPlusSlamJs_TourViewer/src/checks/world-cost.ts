/**
 * The item lab's readout of a kind's world part (`item-lab.ts`): what it
 * costs to draw, counted from its own objects, and a key that changes
 * whenever any of them moves, so the lab can tell a still part from a
 * moving one between two frames.
 *
 * @see world-cost.ts.md
 */
import { InstancedMesh, Mesh, type BufferGeometry, type Object3D } from "three";

/** Draw calls and triangles of one part. */
export interface WorldCost {
  readonly calls: number;
  readonly triangles: number;
}

/** One draw call per shown mesh, and its triangles (an instanced mesh's
 *  times its instances). A hidden object hides everything under it. */
export function worldCost(root: Object3D): WorldCost {
  let calls = 0;
  let triangles = 0;
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return;
    // three types a bare Mesh's geometry as any; every mesh has a buffer one.
    const { geometry } = object as Mesh<BufferGeometry>;
    const corners =
      geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    const copies = object instanceof InstancedMesh ? object.count : 1;
    calls += 1;
    triangles += Math.floor(corners / 3) * copies;
  });
  return { calls, triangles };
}

/** The local position, turn and size of every object under `root`, root
 *  included, as one string. */
export function poseKey(root: Object3D): string {
  const parts: number[] = [];
  root.traverse((object) => {
    parts.push(
      ...object.position.toArray(),
      ...object.quaternion.toArray(),
      ...object.scale.toArray(),
    );
  });
  return parts.join(",");
}
