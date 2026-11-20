/**
 * Which window keeps a splat when the windows' splats are merged into one
 * scene, and which splats a window crops as background shell. Ownership is
 * a function of the splat's position alone, so one spot is kept by at most
 * one window however many trained it.
 *
 * @see splat-ownership.ts.md
 */

import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";
import { rotateVectorByQuaternion } from "gps-plus-slam-app-framework/ar/qr/qr-pose";

/** A training camera of a window's core, raw WebXR pose (looking along
 *  its local -z). */
export interface OwnershipCamera {
  readonly position: Vector3;
  readonly rotation: Quaternion;
  /** Index of the window whose core holds this camera. */
  readonly window: number;
}

/** What ownership needs of a window: its segment, for adjacency. */
export interface OwnershipWindow {
  readonly segment: number;
}

export interface Ownership {
  /** The window that keeps a splat at `point`, or -1 when no camera sees
   *  it (the splat is dropped by every window). */
  ownerOf(point: Vector3): number;
}

/**
 * True when `point` lies in the camera's view cone: in front of it and
 * inside the projection's left, right, top and bottom planes. The near
 * and far planes are ignored on purpose: they are a renderer's choice,
 * not a limit of what the camera saw.
 */
export function sees(
  camera: Pick<OwnershipCamera, "position" | "rotation">,
  projection: Matrix4,
  point: Vector3,
): boolean {
  const [qx, qy, qz, qw] = camera.rotation;
  const local = rotateVectorByQuaternion(
    [-qx, -qy, -qz, qw],
    [
      point[0] - camera.position[0],
      point[1] - camera.position[1],
      point[2] - camera.position[2],
    ],
  );
  // Column-major: clip = P * [local, 1].
  const m = projection;
  const at = (i: number): number => m[i] ?? 0;
  const x = at(0) * local[0] + at(4) * local[1] + at(8) * local[2] + at(12);
  const y = at(1) * local[0] + at(5) * local[1] + at(9) * local[2] + at(13);
  const w = at(3) * local[0] + at(7) * local[1] + at(11) * local[2] + at(15);
  return w > 0 && Math.abs(x) <= w && Math.abs(y) <= w;
}

/**
 * The ownership of a merged scene:
 * 1. Of the cameras that see the point within `ownRangeM`, the nearest
 *    names a window.
 * 2. A revisit: when a window that also sees it within range is not that
 *    window's neighbour (another segment, or not next to it in the walk),
 *    the earliest such window keeps it instead, so a spot the walk came
 *    back to is kept whole by one window, never interleaved from two.
 * 3. Seen by no camera within range: the nearest camera that sees it at
 *    any distance names the window.
 * 4. Seen by none: -1.
 * Neighbours share their seam by rule 1 alone. Throws a RangeError for a
 * camera naming no window or a non-positive range.
 */
export function createOwnership(
  cameras: readonly OwnershipCamera[],
  windows: readonly OwnershipWindow[],
  projection: Matrix4,
  ownRangeM: number,
): Ownership {
  if (!(ownRangeM > 0) || !Number.isFinite(ownRangeM)) {
    throw new RangeError(
      `ownRangeM must be positive and finite, got ${String(ownRangeM)}`,
    );
  }
  for (const c of cameras) {
    if (
      !Number.isInteger(c.window) ||
      c.window < 0 ||
      c.window >= windows.length
    ) {
      throw new RangeError(
        `A camera names window ${String(c.window)}, of ${String(windows.length)}`,
      );
    }
  }
  const adjacent = (a: number, b: number): boolean =>
    Math.abs(a - b) <= 1 && windows[a]?.segment === windows[b]?.segment;
  const grid = new CameraGrid(cameras, ownRangeM);

  return {
    ownerOf(point: Vector3): number {
      let nearest = -1;
      let nearestDistance = Infinity;
      const candidates = new Set<number>();
      for (const c of grid.near(point)) {
        const d = distance(c.position, point);
        if (d > ownRangeM || !sees(c, projection, point)) continue;
        candidates.add(c.window);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = c.window;
        }
      }
      if (nearest >= 0) {
        let owner = nearest;
        for (const w of candidates) {
          if (w < owner && !adjacent(w, nearest)) owner = w;
        }
        return owner;
      }
      for (const c of cameras) {
        const d = distance(c.position, point);
        if (d < nearestDistance && sees(c, projection, point)) {
          nearestDistance = d;
          nearest = c.window;
        }
      }
      return nearest;
    },
  };
}

/**
 * Which of `points` a window keeps after the shell crop: those within
 * `keepM` of at least one of its training cameras. The rest are the
 * background shell's, which every window grows on its own.
 */
export function shellCrop(
  points: readonly Vector3[],
  cameraPositions: readonly Vector3[],
  keepM: number,
): boolean[] {
  if (!(keepM > 0) || !Number.isFinite(keepM)) {
    throw new RangeError(
      `keepM must be positive and finite, got ${String(keepM)}`,
    );
  }
  const grid = new CameraGrid(
    cameraPositions.map((position) => ({ position })),
    keepM,
  );
  return points.map((p) =>
    grid.near(p).some((c) => distance(c.position, p) <= keepM),
  );
}

/** Cameras bucketed in cubes of `cell` metres: `near` returns every
 *  camera within `cell` of a point (and some farther). */
class CameraGrid<C extends { readonly position: Vector3 }> {
  private readonly cells = new Map<string, C[]>();

  constructor(
    cameras: readonly C[],
    private readonly cell: number,
  ) {
    for (const c of cameras) {
      const key = this.key(c.position, 0, 0, 0);
      const list = this.cells.get(key) ?? [];
      list.push(c);
      this.cells.set(key, list);
    }
  }

  near(point: Vector3): C[] {
    const out: C[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(this.key(point, dx, dy, dz));
          if (list !== undefined) out.push(...list);
        }
      }
    }
    return out;
  }

  private key(p: Vector3, dx: number, dy: number, dz: number): string {
    return `${String(Math.floor(p[0] / this.cell) + dx)},${String(Math.floor(p[1] / this.cell) + dy)},${String(Math.floor(p[2] / this.cell) + dz)}`;
  }
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
