/**
 * Selecting a placed object in AR (authoring plan 2026-09-28-0953 §3.4,
 * owner decision D7; M4 review #4): a ray from the camera through the point
 * the creator TAPPED - the screen centre, where the reticle ring sits, when
 * the tap's own ray is not known - cast against the objects' own geometry,
 * with an angular tolerance around it.
 *
 * NOT the reticle's hit point: that lies on a surface, while a pin's label
 * floats above it, so "the object nearest the hit point" picks wrongly
 * whenever two objects stand close (cold review #11). The ray hits the
 * label sprite or the photo plane itself, nearest first.
 *
 * THE TOLERANCE: a label is 0.6 m wide - under 2° at 20 m - and a fingertip
 * lands a few degrees from where it aimed, so an exact hit made far labels
 * close to unselectable. Without an exact hit, the object whose centre is
 * nearest the ray IN ANGLE is taken, if within
 * {@link PICK_TOLERANCE_DEG}. The value, the sweep behind it and what would
 * reverse it are in the sidecar.
 *
 * The raycast is the framework's `raycastPointer` (DEC-H3); this module
 * maps the hit back to the object it belongs to and adds the tolerance.
 *
 * @see object-pick.ts.md
 */

import {
  raycastPointer,
  type Ndc,
} from "gps-plus-slam-app-framework/visualization/pointer-picking";
import {
  Box3,
  Matrix4,
  Raycaster,
  Vector3,
  type Camera,
  type Object3D,
} from "three";

/** The screen centre in normalized device coordinates. */
const SCREEN_CENTRE: Ndc = { x: 0, y: 0 };

/**
 * How far beside the tap's ray (in degrees) an object may lie and still be
 * picked when the ray hits nothing. Swept in `object-pick-tolerance.test.ts`
 * (see the sidecar for the numbers and what would reverse the choice).
 */
export const PICK_TOLERANCE_DEG = 3;

/**
 * The screen point (NDC) a tap's target ray passes through.
 *
 * @param targetRayInCamera the ray's pose in the camera's own frame
 *   (column-major 4x4; the ray runs along its -Z) - for an immersive
 *   session the framework driver's `targetRayInViewer`, the viewer being
 *   the camera on a handheld device.
 * @returns null for a malformed matrix or a ray that does not point into
 *   the view (at or behind the camera's plane).
 */
export function ndcOfTargetRay(
  camera: Camera,
  targetRayInCamera: readonly number[],
): Ndc | null {
  if (
    targetRayInCamera.length !== 16 ||
    !targetRayInCamera.every(Number.isFinite)
  ) {
    return null;
  }
  const direction = new Vector3(0, 0, -1).transformDirection(
    new Matrix4().fromArray(targetRayInCamera),
  );
  if (direction.z >= -1e-6) return null;
  // A screen tap's ray starts at the eye, so its direction alone names the
  // screen point: project a point along it.
  const clip = direction.applyMatrix4(camera.projectionMatrix);
  if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y)) return null;
  return { x: clip.x, y: clip.y };
}

/** Options for {@link pickObject}. */
export interface PickOptions {
  /** Where the tap was (NDC); the screen centre by default. */
  readonly ndc?: Ndc;
  /** The angular tolerance; {@link PICK_TOLERANCE_DEG} by default. */
  readonly toleranceDeg?: number;
}

/**
 * The id of the object under the tap, or null.
 *
 * An exact hit wins (the nearest along the ray). Otherwise the object
 * whose CENTRE is nearest the ray in angle, within the tolerance; a tie
 * goes to the nearer object. Measured to the centre, not to the edge, the
 * tolerance acts as a MINIMUM target size: a far label is pickable within
 * the tolerance of its middle, while a near one - already larger than that
 * on screen - gains nothing, so a tap on empty scene beside it stays a tap
 * on empty scene (the edge-measured version selected a neighbour on 26-57 %
 * of such taps at 2-5 m even at 1 degree; sidecar).
 *
 * @param targets each object's root (its preview group), by object id; a
 *   hit on any descendant names the root's id.
 */
export function pickObject(
  camera: Camera,
  targets: ReadonlyMap<string, Object3D>,
  options: PickOptions = {},
): string | null {
  if (targets.size === 0) return null;
  const idByRoot = new Map<Object3D, string>();
  for (const [id, root] of targets) idByRoot.set(root, id);
  const raycaster = new Raycaster();
  const hit = raycastPointer(
    camera,
    options.ndc ?? SCREEN_CENTRE,
    [...targets.values()],
    raycaster,
  );
  for (let node: Object3D | null = hit?.object ?? null; node !== null;) {
    const id = idByRoot.get(node);
    if (id !== undefined) return id;
    node = node.parent;
  }
  const tolerance =
    ((options.toleranceDeg ?? PICK_TOLERANCE_DEG) * Math.PI) / 180;
  if (!(tolerance > 0)) return null;
  let best: { id: string; angle: number; distance: number } | null = null;
  for (const [id, root] of targets) {
    const box = new Box3().setFromObject(root);
    if (box.isEmpty()) continue;
    const toCentre = box.getCenter(new Vector3()).sub(raycaster.ray.origin);
    const angle = raycaster.ray.direction.angleTo(toCentre);
    if (angle > tolerance) continue;
    const distance = toCentre.length();
    if (
      best === null ||
      angle < best.angle ||
      (angle === best.angle && distance < best.distance)
    ) {
      best = { id, angle, distance };
    }
  }
  return best?.id ?? null;
}
