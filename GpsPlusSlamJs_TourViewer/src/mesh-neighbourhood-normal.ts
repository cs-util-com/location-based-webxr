/**
 * The mesh cursor's rotation from the neighbourhood of the hit (mesh-cursor
 * smoothing plan 2026-10-15-0944, the owner's "sampling from the data
 * around the cursor position to average it a little bit stronger on the
 * rotation part"): the area-weighted mean of the face normals of the
 * triangles around the hit, those turned too far from the hit face left
 * out so a wall never tilts a floor's ring at a corner.
 *
 * @see mesh-neighbourhood-normal.ts.md
 */

import {
  Matrix3,
  Matrix4,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Intersection,
  type InterleavedBufferAttribute,
} from "three";

export interface NeighbourhoodNormalOptions {
  /** Triangles whose centroid lies within this many metres of the hit
   *  count (0: the hit face alone). */
  radiusM: number;
  /** ...and whose normal is within this many degrees of the hit face's. */
  maxAngleDeg: number;
}

/** Two of the occupancy grid's 0.15 m cells, and half a right angle - the
 *  middle of the gate range that keeps both a noisy floor and a corner
 *  (sweeps in the test and the plan doc). */
export const DEFAULT_NEIGHBOURHOOD_NORMAL: NeighbourhoodNormalOptions = {
  radiusM: 0.3,
  maxAngleDeg: 45,
};

function assertSetting(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `neighbourhood normal: ${name} must be a finite number >= 0, got ${String(value)}`,
    );
  }
}

const toLocal = new Matrix4();
const normalToWorld = new Matrix3();
const centre = new Vector3();
const seed = new Vector3();
const sum = new Vector3();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const cross = new Vector3();

type Positions = BufferAttribute | InterleavedBufferAttribute;

/** The object's geometry and positions, or null when it has no triangle. */
function trianglesOf(
  object: unknown,
): { geometry: BufferGeometry; positions: Positions } | null {
  const geometry = (object as { geometry?: BufferGeometry }).geometry;
  const positions = geometry?.getAttribute?.("position");
  if (geometry === undefined || positions === undefined) return null;
  return positions.count < 3 ? null : { geometry, positions };
}

/** The `k`-th corner's vertex, through the index when there is one. */
function vertexAt(index: BufferAttribute | null, k: number): number {
  return index === null ? k : index.getX(k);
}

/**
 * `sum` := the raw cross products of the triangles whose centroid lies
 * within the radius of `centre` and whose normal is within the gate of
 * `seed` (all in the mesh's own frame). Degenerate triangles count nothing.
 */
function sumCountedTriangles(
  { geometry, positions }: { geometry: BufferGeometry; positions: Positions },
  radiusSq: number,
  cosGate: number,
): void {
  const index = geometry.getIndex();
  const triangles = Math.floor((index?.count ?? positions.count) / 3);
  sum.set(0, 0, 0);
  for (let i = 0; i < triangles * 3; i += 3) {
    a.fromBufferAttribute(positions, vertexAt(index, i));
    b.fromBufferAttribute(positions, vertexAt(index, i + 1));
    c.fromBufferAttribute(positions, vertexAt(index, i + 2));
    const cx = (a.x + b.x + c.x) / 3 - centre.x;
    const cy = (a.y + b.y + c.y) / 3 - centre.y;
    const cz = (a.z + b.z + c.z) / 3 - centre.z;
    if (cx * cx + cy * cy + cz * cz > radiusSq) continue;
    // three's own face-normal winding (Triangle.getNormal).
    cross.subVectors(c, b).cross(a.sub(b));
    const length = cross.length();
    if (length > 0 && cross.dot(seed) >= cosGate * length) sum.add(cross);
  }
}

/**
 * The surface's WORLD unit normal around `hit` - a raycast hit on a mesh
 * (`hit.face.normal` is in the mesh's own frame, `hit.point` in world). The
 * sum of the raw cross products of the counted triangles is their
 * area-weighted mean. Nothing counted (a radius of 0, a lone triangle):
 * the hit face's own normal. Null for a hit without a face or on an
 * object without at least one triangle of positions.
 *
 * Assumes the mesh's world matrix is rigid (rotation and translation, as
 * the world group's alignment is): the radius is measured in its frame.
 * One pass over every triangle, the same order as the raycast itself.
 *
 * @throws RangeError for a negative or non-finite option.
 */
export function neighbourhoodNormal(
  hit: Intersection,
  options: Partial<NeighbourhoodNormalOptions> = {},
): Vector3 | null {
  const { radiusM, maxAngleDeg } = {
    ...DEFAULT_NEIGHBOURHOOD_NORMAL,
    ...options,
  };
  assertSetting("radiusM", radiusM);
  assertSetting("maxAngleDeg", maxAngleDeg);
  const face = hit.face;
  const mesh = trianglesOf(hit.object);
  if (face === null || face === undefined || mesh === null) return null;

  toLocal.copy(hit.object.matrixWorld).invert();
  centre.copy(hit.point).applyMatrix4(toLocal);
  seed.copy(face.normal).normalize();
  const radiusSq = radiusM * radiusM;
  const cosGate = Math.cos((Math.min(maxAngleDeg, 180) * Math.PI) / 180);
  sumCountedTriangles(mesh, radiusSq, cosGate);
  const local = sum.lengthSq() > 0 ? sum.normalize() : seed;
  normalToWorld.getNormalMatrix(hit.object.matrixWorld);
  return local.clone().applyMatrix3(normalToWorld).normalize();
}
