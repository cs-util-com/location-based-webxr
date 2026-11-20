/**
 * The splat trainer's synthetic scene, as pure geometry: a closed room
 * (floor, four walls and a ceiling) with an asymmetric object in its middle, the
 * camera walks through it (a straight walk and a loop), the lens, the
 * depth a camera would measure at each pose, and each surface's texture.
 * Nothing here draws: `splat-scene-render.ts` renders these boxes, and
 * `splat-scene-zip.ts` writes the walk as a recording.
 *
 * Poses are raw WebXR: metres, +y up, a camera looking along its local -z,
 * rotations `[x, y, z, w]`.
 *
 * @see splat-scene.ts.md
 */
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";
import type {
  DepthPoint,
  DepthSample,
} from "gps-plus-slam-app-framework/state";
import * as THREE from "three";

import { syntheticTexture } from "../feature-match/bench-synthetic";

export type SurfaceKind = "floor" | "wall" | "object";

/** An axis-aligned box of the scene, drawn with its own texture. */
export interface SceneBox {
  readonly name: string;
  readonly kind: SurfaceKind;
  readonly min: Vector3;
  readonly max: Vector3;
  /** The seed of the box's texture (`surfaceTexture`). */
  readonly seed: number;
}

/** The room's half extents and height (m); walls are `ROOM.wall` thick. */
const ROOM = { halfX: 6, halfZ: 6, height: 3, wall: 0.1 } as const;

const { halfX, halfZ, height: roomHeight, wall } = ROOM;

/**
 * Every box of the scene. The object is three boxes: a low block, a tall
 * upright on the block's +x end and a thin post towards -x and +z, so
 * neither mirror (x or z) nor a half turn maps it onto itself: a trainer
 * that flips or turns a camera puts it visibly in the wrong place.
 */
export const SCENE_BOXES: readonly SceneBox[] = [
  {
    name: "floor",
    kind: "floor",
    min: [-halfX, -wall, -halfZ],
    max: [halfX, 0, halfZ],
    seed: 1,
  },
  {
    name: "wall -z",
    kind: "wall",
    min: [-halfX, 0, -halfZ - wall],
    max: [halfX, roomHeight, -halfZ],
    seed: 2,
  },
  {
    name: "wall +z",
    kind: "wall",
    min: [-halfX, 0, halfZ],
    max: [halfX, roomHeight, halfZ + wall],
    seed: 3,
  },
  {
    name: "wall -x",
    kind: "wall",
    min: [-halfX - wall, 0, -halfZ],
    max: [-halfX, roomHeight, halfZ],
    seed: 4,
  },
  {
    name: "wall +x",
    kind: "wall",
    min: [halfX, 0, -halfZ],
    max: [halfX + wall, roomHeight, halfZ],
    seed: 5,
  },
  {
    // The ceiling closes the room, so every ray of every camera meets a
    // surface and every depth point is measured.
    name: "ceiling",
    kind: "wall",
    min: [-halfX, roomHeight, -halfZ],
    max: [halfX, roomHeight + wall, halfZ],
    seed: 9,
  },
  {
    name: "block",
    kind: "object",
    min: [-1, 0, -0.6],
    max: [1, 0.6, 0],
    seed: 6,
  },
  {
    name: "upright",
    kind: "object",
    min: [0.5, 0.6, -0.6],
    max: [1, 1.6, -0.2],
    seed: 7,
  },
  {
    name: "post",
    kind: "object",
    min: [-0.8, 0, 0.3],
    max: [-0.6, 1.2, 0.5],
    seed: 8,
  },
];

/** The object's centre on the floor, which the loop circles. */
export const OBJECT_CENTRE: Vector3 = [0, 0, 0];

/** The cameras' height above the floor (m). */
export const EYE_HEIGHT_M = 1.5;

/** The point the loop's cameras look at: the object, a little above the
 *  floor. */
const LOOP_TARGET: Vector3 = [OBJECT_CENTRE[0], 0.6, OBJECT_CENTRE[2]];

/** The straight walk: along +x at this z, from -x to +x. */
const STRAIGHT_Z_M = 3.5;
const STRAIGHT_HALF_LENGTH_M = 4;

/** The loop's radius around the object (m). */
export const LOOP_RADIUS_M = 3.5;

export type WalkKind = "straight" | "loop";

export interface ScenePose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/**
 * The pose of an upright camera at `eye` looking at `target`. Throws a
 * RangeError when the two coincide or the view is vertical (no upright
 * camera can look straight up or down).
 */
export function lookAt(eye: Vector3, target: Vector3): ScenePose {
  const e = new THREE.Vector3(...eye);
  const t = new THREE.Vector3(...target);
  const back = e.clone().sub(t);
  if (back.lengthSq() === 0 || back.clone().setY(0).lengthSq() === 0) {
    throw new RangeError("A camera must look at a point beside it");
  }
  // Matrix4.lookAt puts +z on eye - target: the camera's -z faces the
  // target, as in WebXR.
  const m = new THREE.Matrix4().lookAt(e, t, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position: [...eye], rotation: [q.x, q.y, q.z, q.w] };
}

/**
 * The poses of a walk of `frames` captures (an integer of at least 2):
 * - `straight`: walking along +x at `EYE_HEIGHT_M` on the line
 *   z = 3.5, every camera turned to look towards -z, at the object and the
 *   wall behind it, and slightly down;
 * - `loop`: `laps` times round the object at `LOOP_RADIUS_M`, every
 *   camera facing it, `frames` spread evenly over all laps; the last
 *   capture is one step short of the first, so the walk ends where it
 *   began. With two laps or more every spot is seen again from a later
 *   lap: the revisit case of the ownership rules.
 * Throws a RangeError for any other `frames`, for `laps` that is not a
 * positive integer, and for more than one lap of the straight walk.
 */
export function sceneWalk(
  kind: WalkKind,
  frames: number,
  laps = 1,
): ScenePose[] {
  if (!Number.isInteger(frames) || frames < 2) {
    throw new RangeError(
      `A walk needs an integer of at least 2 frames, got ${String(frames)}`,
    );
  }
  if (
    !Number.isInteger(laps) ||
    laps < 1 ||
    (kind === "straight" && laps !== 1)
  ) {
    throw new RangeError(`A ${kind} walk cannot have ${String(laps)} laps`);
  }
  const poses: ScenePose[] = [];
  for (let i = 0; i < frames; i++) {
    if (kind === "straight") {
      const x =
        -STRAIGHT_HALF_LENGTH_M +
        (2 * STRAIGHT_HALF_LENGTH_M * i) / (frames - 1);
      poses.push(lookAt([x, EYE_HEIGHT_M, STRAIGHT_Z_M], [x * 0.5, 0.6, -2]));
    } else {
      const a = (2 * Math.PI * laps * i) / frames;
      poses.push(
        lookAt(
          [
            OBJECT_CENTRE[0] + LOOP_RADIUS_M * Math.sin(a),
            EYE_HEIGHT_M,
            OBJECT_CENTRE[2] + LOOP_RADIUS_M * Math.cos(a),
          ],
          LOOP_TARGET,
        ),
      );
    }
  }
  return poses;
}

/** The lens's vertical half angle (rad), as the recorder's test walks use. */
const HALF_FOV_Y = 0.6;
const NEAR_M = 0.05;
const FAR_M = 50;

/**
 * A centred perspective projection (column-major, float32 values as a
 * device records them) for photos of `width` x `height`, so their pixels
 * come out square. Throws a RangeError for sizes that are not positive
 * integers.
 */
export function sceneProjection(width: number, height: number): Matrix4 {
  for (const [name, v] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new RangeError(
        `${name} must be a positive integer, got ${String(v)}`,
      );
    }
  }
  const f = 1 / Math.tan(HALF_FOV_Y);
  const m = new Array<number>(16).fill(0);
  m[0] = f / (width / height);
  m[5] = f;
  m[10] = (FAR_M + NEAR_M) / (NEAR_M - FAR_M);
  m[11] = -1;
  m[14] = (2 * FAR_M * NEAR_M) / (NEAR_M - FAR_M);
  return m.map(Math.fround) as unknown as Matrix4;
}

/**
 * The first box a ray from `origin` along `direction` (any length) meets,
 * and the hit point, or null when it meets none: a box behind another
 * along the ray is hidden by it.
 */
export function castRay(
  origin: Vector3,
  direction: Vector3,
): { readonly box: SceneBox; readonly point: Vector3 } | null {
  const ray = new THREE.Ray(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
  );
  let best: { box: SceneBox; point: Vector3 } | null = null;
  let bestDistance = Infinity;
  const hit = new THREE.Vector3();
  for (const box of SCENE_BOXES) {
    const b = new THREE.Box3(
      new THREE.Vector3(...box.min),
      new THREE.Vector3(...box.max),
    );
    if (ray.intersectBox(b, hit) === null) continue;
    const d = hit.distanceTo(ray.origin);
    if (d < bestDistance) {
      bestDistance = d;
      best = { box, point: [hit.x, hit.y, hit.z] };
    }
  }
  return best;
}

/**
 * The first box the ray of the pixel at (`screenX`, `screenY`) meets
 * (0 to 1, top-left origin) for a camera at `pose` with `projection`,
 * and the hit point, or null when it meets none: what the photo shows at
 * that pixel and what the depth sample measures there.
 */
export function sceneHitAt(
  pose: ScenePose,
  projection: Matrix4,
  screenX: number,
  screenY: number,
): ReturnType<typeof castRay> {
  return pixelHit(
    pose,
    new THREE.Matrix4().fromArray([...projection]).invert(),
    screenX,
    screenY,
  );
}

function pixelHit(
  pose: ScenePose,
  inverseProjection: THREE.Matrix4,
  screenX: number,
  screenY: number,
): ReturnType<typeof castRay> {
  // NDC on the near plane, y flipped to bottom-up.
  const world = new THREE.Vector3(2 * screenX - 1, 1 - 2 * screenY, -1)
    .applyMatrix4(inverseProjection)
    .applyQuaternion(new THREE.Quaternion(...pose.rotation));
  return castRay(pose.position, [world.x, world.y, world.z]);
}

/**
 * The depth sample a camera at `pose` measures on a `grid` x `grid` grid
 * at the sampler's screen positions (`(i + 1) / (grid + 1)`, top-left
 * origin): each point's z-depth along the camera's -z to the first box its
 * pixel's ray meets ({@link sceneHitAt}), as float32. A ray that meets
 * nothing gives no point (the room is closed, so none does). Throws a
 * RangeError for a grid that is not a positive integer.
 */
export function sceneDepthSample(
  pose: ScenePose,
  projection: Matrix4,
  grid: number,
  timestamp: number,
): DepthSample {
  if (!Number.isInteger(grid) || grid < 1) {
    throw new RangeError(
      `grid must be a positive integer, got ${String(grid)}`,
    );
  }
  const inverse = new THREE.Matrix4().fromArray([...projection]).invert();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(...pose.rotation),
  );
  const eye = new THREE.Vector3(...pose.position);
  const points: DepthPoint[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const screenX = (col + 1) / (grid + 1);
      const screenY = (row + 1) / (grid + 1);
      const hit = pixelHit(pose, inverse, screenX, screenY);
      if (hit === null) continue;
      const depthM = new THREE.Vector3(...hit.point).sub(eye).dot(forward);
      points.push({ screenX, screenY, depthM: Math.fround(depthM) });
    }
  }
  return {
    timestamp,
    cameraPos: pose.position,
    cameraRot: pose.rotation,
    points,
    projectionMatrix: projection,
  };
}

/** A surface's tint, RGB 0-1, multiplied into its grey texture. */
export const SURFACE_TINT: Readonly<
  Record<SurfaceKind, readonly [number, number, number]>
> = {
  floor: [1, 0.85, 0.65],
  wall: [0.9, 0.95, 1],
  object: [0.45, 0.75, 1],
};

/**
 * A `size` x `size` RGBA texture for a box: the feature-match benchmark's
 * corner-rich grey texture (`syntheticTexture`) for `seed`, tinted by the
 * box's kind, so every part of a surface has corners to match, no two
 * boxes look alike and the object stands out from the room. The same
 * seed gives the same bytes. Throws a RangeError for a size that is not a
 * positive integer.
 */
export function surfaceTexture(
  kind: SurfaceKind,
  seed: number,
  size: number,
): Uint8Array {
  const grey = syntheticTexture(size, size, seed).rgba;
  const tint = SURFACE_TINT[kind];
  const data = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i += 4) {
    data[i] = Math.round((grey[i] ?? 0) * tint[0]);
    data[i + 1] = Math.round((grey[i + 1] ?? 0) * tint[1]);
    data[i + 2] = Math.round((grey[i + 2] ?? 0) * tint[2]);
    data[i + 3] = 255;
  }
  return data;
}

/**
 * The distance from `p` to the nearest face of any box it lies on or in
 * (m): 0 on a surface. What a reconstruction of the scene is measured
 * against.
 */
export function distanceToScene(p: Vector3): number {
  let best = Infinity;
  for (const b of SCENE_BOXES) {
    // Outside distance per axis (0 inside the slab).
    const out = [0, 1, 2].map((k) =>
      Math.max((b.min[k] ?? 0) - (p[k] ?? 0), 0, (p[k] ?? 0) - (b.max[k] ?? 0)),
    );
    const outside = Math.hypot(...out);
    const inside = Math.min(
      ...[0, 1, 2].flatMap((k) => [
        (p[k] ?? 0) - (b.min[k] ?? 0),
        (b.max[k] ?? 0) - (p[k] ?? 0),
      ]),
    );
    best = Math.min(best, outside > 0 ? outside : Math.max(0, inside));
  }
  return best;
}
