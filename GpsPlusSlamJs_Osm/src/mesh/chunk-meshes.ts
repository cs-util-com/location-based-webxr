/**
 * Batching geometry into spatial chunks so it can be culled (W20, R4-16).
 *
 * THE DEFECT THIS ADDRESSES. `buildMesh` merged every building in a fetch tile
 * into ONE `MeshData`, and the demo turned that into one `THREE.Mesh`. three
 * frustum-culls per `Object3D`, so one mesh is all-or-nothing: distance and
 * frustum culling are unavailable **by construction**. The notes noticed the
 * symptom directly — geometry three, four, five kilometres away still being
 * drawn, in a demo whose destination is AR with a 200–300 m far plane.
 *
 * The old comment in `demo-worker.ts` said as much: _"ONE merged geometry: this
 * view shows one working set at a time and is always wholly on screen… even
 * though the package's general guidance is to batch per res-8/res-9 cell."_ The
 * premise stopped being true when DEC-R2-8 grew the extent to 2.8 km.
 *
 * WHY A METRIC GRID RATHER THAN LITERAL H3 CELLS, which is a deviation from the
 * plan and worth stating. The purpose here is CULLING, not indexing: a chunk
 * only has to be a compact group of nearby geometry with a bounding box. Keying
 * on real H3 cells would need a projection back to lat/lng per piece of
 * geometry, which is a per-building round trip bought for an alignment nothing
 * downstream reads. The cell size is taken FROM the H3 ladder so the grain still
 * matches the guidance the old comment referred to.
 *
 * THE TRADE, STATED: draw calls go from one per layer to one per occupied chunk
 * per layer. At the current 2.8 km extent and a res-8 grain that is up to ~9
 * chunks; `draw-cost.ts` puts the real number in the status line so the trade is
 * measured rather than argued.
 *
 * @see chunk-meshes.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { mergeMeshes } from "./extrude.js";
import type { MeshData } from "./mesh-data.js";

/**
 * Chunk size in metres, from the H3 resolution ladder.
 *
 * A res-8 cell is ~920 m across; that is the grain the package's own guidance
 * names, and at the 2.8 km terrain extent it gives a 3x3-ish grid — few enough
 * draw calls to be free, coarse enough that a chunk is worth culling as a unit.
 */
export const CHUNK_SIZE_M = 920;

/** One batch of geometry, with the grid cell it belongs to. */
export interface MeshChunk {
  /** `"<col>,<row>"` in chunk units. Stable, and useful in a test failure. */
  readonly key: string;
  readonly mesh: MeshData;
}

/** Which chunk an ENU point falls in. */
export function chunkKeyFor(point: EnuPoint, sizeM = CHUNK_SIZE_M): string {
  return `${Math.floor(point.x / sizeM)},${Math.floor(point.y / sizeM)}`;
}

/**
 * Groups per-feature meshes into chunks and merges within each.
 *
 * ORDER IS PRESERVED WITHIN A CHUNK, and chunks come out in first-seen order, so
 * the result is deterministic — two runs over the same features produce the same
 * buffers. That matters because the demo's e2e suite compares rendered frames.
 *
 * An empty input produces NO chunks rather than one empty chunk: an empty
 * `BufferGeometry` in the scene is still a draw call and a disposal obligation,
 * and "the layer drew nothing" should look like nothing.
 */
export function chunkMeshes<T>(
  items: readonly T[],
  meshOf: (item: T) => MeshData,
  positionOf: (item: T) => EnuPoint,
  sizeM = CHUNK_SIZE_M,
): MeshChunk[] {
  const grouped = new Map<string, MeshData[]>();
  for (const item of items) {
    const mesh = meshOf(item);
    // A feature that produced no triangles must not create a chunk — see above.
    if (mesh.triangleCount === 0) continue;
    const key = chunkKeyFor(positionOf(item), sizeM);
    const list = grouped.get(key) ?? [];
    list.push(mesh);
    grouped.set(key, list);
  }
  return [...grouped].map(([key, meshes]) => ({
    key,
    mesh: mergeMeshes(meshes),
  }));
}

/**
 * The centroid of a mesh's vertices, in the RENDER frame.
 *
 * Used as a chunk key for geometry whose builder does not report a position.
 * The vertex average is not a guaranteed interior point — the same caveat
 * `buildings.ts`'s `representativePoint` records — but a chunk assignment only
 * has to be *consistent and nearby*, not exact: a building assigned to the
 * neighbouring chunk is culled with its neighbours, which is invisible.
 *
 * **`z` is negated back to ENU north** so the result can be compared with ENU
 * positions from the builders. Mixing the two frames here would scatter each
 * layer into a different set of chunks — self-consistent per layer, and
 * therefore invisible.
 */
export function meshCentroidEnu(mesh: MeshData): EnuPoint {
  const count = mesh.positions.length / 3;
  if (count === 0) return { x: 0, y: 0 };
  let x = 0;
  let z = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    x += mesh.positions[i] as number;
    z += mesh.positions[i + 2] as number;
  }
  return { x: x / count, y: -(z / count) };
}
