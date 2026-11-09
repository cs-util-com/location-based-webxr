/**
 * The item lab's readout of a kind's world part (`item-lab.ts`): what it
 * costs to draw, counted from its own objects, and a key that changes
 * whenever any of them moves, so the lab can tell a still part from a
 * moving one between two frames.
 *
 * @see world-cost.ts.md
 */
import {
  InstancedMesh,
  Line,
  Mesh,
  Points,
  Sprite,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

/** Draw calls and triangles of one part. */
export interface WorldCost {
  readonly calls: number;
  readonly triangles: number;
}

/** The corners (index entries, or vertices unindexed) of `geometry`. */
function cornersOf(geometry: BufferGeometry): number {
  return geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
}

/** A mesh's calls and triangles (one copy): three draws a mesh in a list
 *  of materials once per geometry group whose material is in the list,
 *  and a mesh in one material once, whatever groups its geometry has. */
function meshCost(
  geometry: BufferGeometry,
  material: Material | Material[],
): WorldCost {
  const corners = cornersOf(geometry);
  if (!Array.isArray(material) || geometry.groups.length === 0) {
    return { calls: 1, triangles: Math.floor(corners / 3) };
  }
  let calls = 0;
  let triangles = 0;
  for (const group of geometry.groups) {
    if (material[group.materialIndex ?? 0] === undefined) continue;
    const count = Math.min(group.count, Math.max(0, corners - group.start));
    calls += 1;
    triangles += Math.floor(count / 3);
  }
  return { calls, triangles };
}

/** The calls and triangles of every shown mesh, point cloud, line and
 *  sprite under `root`: a mesh per material group (`meshCost`), an
 *  instanced mesh's triangles times its instances, a sprite its quad's
 *  two, points and lines none. A hidden object hides everything under it. */
export function worldCost(root: Object3D): WorldCost {
  let calls = 0;
  let triangles = 0;
  root.traverseVisible((object) => {
    if (object instanceof Mesh) {
      // three types a bare Mesh's geometry as any; every mesh has a buffer one.
      const mesh = object as Mesh<BufferGeometry, Material | Material[]>;
      const cost = meshCost(mesh.geometry, mesh.material);
      const copies = object instanceof InstancedMesh ? object.count : 1;
      calls += cost.calls;
      triangles += cost.triangles * copies;
    } else if (object instanceof Sprite) {
      calls += 1;
      triangles += 2;
    } else if (object instanceof Points || object instanceof Line) {
      calls += 1;
    }
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
