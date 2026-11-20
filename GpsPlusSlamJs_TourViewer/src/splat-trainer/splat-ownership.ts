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
import {
  CELL_KEY_LIMIT,
  cellCoordsInKeyRange,
  packCellKey,
} from "gps-plus-slam-app-framework/ar/cell-key";

import { distance, requirePositive } from "./splat-math.js";

/** A training camera of a window's core, raw WebXR pose (looking along
 *  its local -z). */
export interface OwnershipCamera {
  readonly position: Vector3;
  readonly rotation: Quaternion;
  /** Index of the window whose core holds this camera. */
  readonly window: number;
  /** The camera's distance along its segment's walk (m), as the walk plan
   *  measures it: what tells a revisit from a walk that went on. */
  readonly along: number;
}

/** What ownership needs of a window: its segment, for revisits. */
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
 * The ownership of a merged scene. Of the cameras that see the point within
 * `ownRangeM` (its seeing cameras):
 * 1. The nearest names a window (on equal distance, the lower camera
 *    index).
 * 2. A revisit: another window whose seeing cameras are all more than
 *    `2 * ownRangeM` along the walk from every seeing camera of that
 *    window, or lie in another segment, saw the spot on an earlier or
 *    later pass. Then the earliest such window marks the first pass, and
 *    of the windows before the nearest's that saw the spot on that pass
 *    (no revisit of the earliest), the one with the nearest seeing camera
 *    keeps it. So a spot the walk came back to is kept by the first pass
 *    alone, and within that pass by its closest view, never by a far view
 *    of an earlier window. Windows that saw it on one pass share their
 *    seam by rule 1 alone, however many windows apart.
 * 3. Seen by no camera within range: the nearest camera that sees it at
 *    any distance names the window.
 * 4. Seen by none: -1.
 * Throws a RangeError for a camera naming no window, a camera with a
 * distance along the walk that is not finite, a camera too far out to key,
 * or a non-positive range.
 */
export function createOwnership(
  cameras: readonly OwnershipCamera[],
  windows: readonly OwnershipWindow[],
  projection: Matrix4,
  ownRangeM: number,
): Ownership {
  requirePositive("ownRangeM", ownRangeM);
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
    if (!Number.isFinite(c.along)) {
      throw new RangeError(
        `A camera's distance along the walk must be finite, got ${String(c.along)}`,
      );
    }
  }
  const grid = new CameraGrid(
    cameras.map((c) => c.position),
    ownRangeM,
  );
  // Two seeing cameras this far apart along one walk are on two passes.
  const revisitGapM = 2 * ownRangeM;

  return {
    ownerOf(point: Vector3): number {
      let nearest = -1;
      let nearestDistance = Infinity;
      const alongs = new Map<number, number[]>();
      // Each window's nearest seeing camera: [distance, camera index].
      const best = new Map<number, [number, number]>();
      for (const i of grid.near(point)) {
        const c = cameras[i];
        if (c === undefined) continue;
        const d = distance(c.position, point);
        if (d > ownRangeM || !sees(c, projection, point)) continue;
        const list = alongs.get(c.window) ?? [];
        list.push(c.along);
        alongs.set(c.window, list);
        const b = best.get(c.window);
        if (b === undefined || d < b[0] || (d === b[0] && i < b[1])) {
          best.set(c.window, [d, i]);
        }
        if (d < nearestDistance || (d === nearestDistance && i < nearest)) {
          nearestDistance = d;
          nearest = i;
        }
      }
      if (nearest >= 0) {
        const n = cameras[nearest]?.window ?? -1;
        const revisit = (a: number, b: number): boolean =>
          windows[a]?.segment !== windows[b]?.segment ||
          closestGap(sorted(alongs.get(a) ?? []), sorted(alongs.get(b) ?? [])) >
            revisitGapM;
        // The earliest window that saw the spot on another pass than n's.
        let first = n;
        for (const w of alongs.keys()) {
          if (w < first && revisit(w, n)) first = w;
        }
        if (first === n) return n;
        // Of that earlier pass (the windows before n that are no revisit
        // of `first`), the one with the nearest seeing camera keeps it.
        let owner = first;
        let ownerAt = best.get(first) ?? [Infinity, Infinity];
        for (const [w, at] of best) {
          if (w >= n || revisit(w, first)) continue;
          if (
            at[0] < ownerAt[0] ||
            (at[0] === ownerAt[0] && at[1] < ownerAt[1])
          ) {
            owner = w;
            ownerAt = at;
          }
        }
        return owner;
      }
      cameras.forEach((c, i) => {
        const d = distance(c.position, point);
        if (d < nearestDistance && sees(c, projection, point)) {
          nearestDistance = d;
          nearest = i;
        }
      });
      return nearest < 0 ? -1 : (cameras[nearest]?.window ?? -1);
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
  requirePositive("keepM", keepM);
  const grid = new CameraGrid(cameraPositions, keepM);
  return points.map((p) =>
    grid.near(p).some((i) => {
      const c = cameraPositions[i];
      return c !== undefined && distance(c, p) <= keepM;
    }),
  );
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** The smallest |a - b| over a in `as`, b in `bs`, both ascending. */
function closestGap(as: readonly number[], bs: readonly number[]): number {
  let best = Infinity;
  let i = 0;
  let j = 0;
  while (i < as.length && j < bs.length) {
    const a = as[i] ?? 0;
    const b = bs[j] ?? 0;
    best = Math.min(best, Math.abs(a - b));
    if (a < b) i++;
    else j++;
  }
  return best;
}

/** Keys stay this many cells inside the key's range, so a query's
 *  neighbouring cells are always keyable too. */
const KEY_MARGIN = 2;

/** Camera indices bucketed in cubes of `cell` metres: `near` returns every
 *  camera within `cell` of a point (and some farther). */
class CameraGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    positions: readonly Vector3[],
    private readonly cell: number,
  ) {
    positions.forEach((p, i) => {
      const at = this.cellOf(p);
      if (!cellCoordsInKeyRange(at, CELL_KEY_LIMIT - KEY_MARGIN)) {
        throw new RangeError(
          `A camera at (${p.join(", ")}) is too far from the origin for cells of ${String(cell)} m`,
        );
      }
      const key = packCellKey(at[0], at[1], at[2]);
      const list = this.cells.get(key) ?? [];
      list.push(i);
      this.cells.set(key, list);
    });
  }

  near(point: Vector3): number[] {
    const at = this.cellOf(point);
    // Every camera's cell is inside the margin, so a point whose cell is
    // outside it by more than one is more than a cell from all of them.
    if (!cellCoordsInKeyRange(at, CELL_KEY_LIMIT - KEY_MARGIN + 1)) return [];
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(
            packCellKey(at[0] + dx, at[1] + dy, at[2] + dz),
          );
          if (list !== undefined) out.push(...list);
        }
      }
    }
    return out;
  }

  private cellOf(p: Vector3): [number, number, number] {
    return [
      Math.floor(p[0] / this.cell),
      Math.floor(p[1] / this.cell),
      Math.floor(p[2] / this.cell),
    ];
  }
}
