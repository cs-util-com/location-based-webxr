/**
 * The field-of-view lines the editor draws from a picture's viewpoint: a
 * ray from the eye to each corner of the frame at the picture's depth,
 * and that frame's four edges, in the station's frame as the format keeps
 * the viewpoint.
 *
 * @see viewpoint-frustum.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import * as THREE from "three";

/** The aspect the lines take before the picture's image has loaded
 *  (height over width): a landscape photo's 3:4. */
export const FRUSTUM_DEFAULT_ASPECT = 0.75;

/** How many points the lines have: eight segments, two points each. */
export const FRUSTUM_POINTS = 16;

const finite = (values: readonly number[]) => values.every(Number.isFinite);

/**
 * The lines' points in pairs (`LineSegments` order): the eye to each
 * corner, then each edge of the frame `vp.distanceM` ahead, the frame
 * `2 d tan(hfov / 2)` wide and `aspect` (height over width) times that
 * high, as the picture hangs in the viewpoint views. Null for a viewpoint
 * or aspect that cannot give a frame: a lens outside (0, 180), a depth or
 * aspect that is not positive, a position or turn that is not finite, or
 * a turn of no length.
 */
export function viewpointFrustum(
  vp: TourPictureViewpoint,
  aspect: number,
): THREE.Vector3[] | null {
  const { hfovDeg, distanceM } = vp;
  if (!finite([hfovDeg, distanceM, aspect])) return null;
  if (hfovDeg <= 0 || hfovDeg >= 180 || distanceM <= 0 || aspect <= 0) {
    return null;
  }
  if (!finite(vp.position) || !finite(vp.rotation)) return null;
  const turn = new THREE.Quaternion(...vp.rotation);
  if (turn.length() < 1e-9) return null;
  turn.normalize();
  const eye = new THREE.Vector3(...vp.position);
  const halfW = Math.tan((hfovDeg * Math.PI) / 360) * distanceM;
  const halfH = halfW * aspect;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) =>
    new THREE.Vector3(sx! * halfW, sy! * halfH, -distanceM)
      .applyQuaternion(turn)
      .add(eye),
  );
  const points: THREE.Vector3[] = [];
  for (const corner of corners) points.push(eye.clone(), corner.clone());
  corners.forEach((corner, i) => {
    points.push(corner.clone(), corners[(i + 1) % corners.length]!.clone());
  });
  return points;
}
