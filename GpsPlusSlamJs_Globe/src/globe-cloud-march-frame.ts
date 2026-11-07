/**
 * The near clouds' frame: where the camera is in the weather. The march
 * works in camera-relative kilometres on a tangent frame, and the dome
 * tiles are read at `p.xz + q`. This module keeps that frame and `q` as the
 * camera moves over the Earth.
 *
 * The frame is PARALLEL TRANSPORTED, not rebuilt from east and south: a
 * frame tied to east and south turns under a camera moving east at a high
 * latitude, so the whole field would rotate around the camera, and it has
 * no east at a pole. `q` is the integral of the motion, so it never slides;
 * the price is that it depends on the route, which only shows as different
 * dome details at a place reached by another way (the map decides where
 * clouds are, whatever the route).
 *
 * Fed with the camera's place in the frame of the map's drift, the wind
 * needs nothing else: the map moving under the camera is a camera moving
 * over the map.
 *
 * @see globe-cloud-march-frame.ts.md
 */

type Vec3 = readonly [number, number, number];

/** The sphere the march's geometry is on (km). */
export const CLOUD_MARCH_RADIUS_KM = 6371;

/** The tangent frame at the camera and its place in the weather. */
export interface CloudWeatherFrame {
  /** The march's y: unit, from the Earth's centre through the camera. */
  readonly up: Vec3;
  /** The march's x, unit, tangent. */
  readonly x: Vec3;
  /** The march's z, unit, tangent: `x` cross `up`. */
  readonly z: Vec3;
  /** The weather position of the point under the camera (km). */
  readonly q: readonly [number, number];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** `v` as a unit vector. RangeError when it has no direction. */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12 && Number.isFinite(l))) {
    throw new RangeError(`no direction in ${v.join(", ")}`);
  }
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** `x` made tangent at `up` and the frame finished from it. */
function frameFrom(
  up: Vec3,
  x: Vec3,
  q: readonly [number, number],
): CloudWeatherFrame {
  const k = dot(x, up);
  const tangent = unit([x[0] - up[0] * k, x[1] - up[1] * k, x[2] - up[2] * k]);
  return { up, x: tangent, z: cross(tangent, up), q };
}

/**
 * The frame at `up` (a direction from the Earth's centre, z through the
 * north pole) on east and south, at the weather's origin. At a pole, x is
 * the first axis.
 *
 * @throws RangeError when `up` has no direction.
 */
export function cloudWeatherFrameAt(up: Vec3): CloudWeatherFrame {
  const u = unit(up);
  const east: Vec3 =
    Math.hypot(u[0], u[1]) > 1e-9 ? [-u[1], u[0], 0] : [1, 0, 0];
  return frameFrom(u, east, [0, 0]);
}

/** `v` turned about the unit `axis` (Rodrigues). */
function turned(v: Vec3, axis: Vec3, sin: number, cos: number): Vec3 {
  const c = cross(axis, v);
  const k = dot(axis, v) * (1 - cos);
  return [
    v[0] * cos + c[0] * sin + axis[0] * k,
    v[1] * cos + c[1] * sin + axis[1] * k,
    v[2] * cos + c[2] * sin + axis[2] * k,
  ];
}

/**
 * The frame after the camera moved to `up`, along the great circle. No
 * great circle is unique to the opposite side of the Earth: a jump there
 * starts a new frame and keeps `q`.
 *
 * @throws RangeError when `up` has no direction.
 */
export function advanceCloudWeatherFrame(
  frame: CloudWeatherFrame,
  up: Vec3,
): CloudWeatherFrame {
  const to = unit(up);
  const axisRaw = cross(frame.up, to);
  const sin = Math.hypot(axisRaw[0], axisRaw[1], axisRaw[2]);
  const cos = dot(frame.up, to);
  if (sin < 1e-12) {
    if (cos > 0) return frame;
    return { ...cloudWeatherFrameAt(to), q: frame.q };
  }
  const axis: Vec3 = [axisRaw[0] / sin, axisRaw[1] / sin, axisRaw[2] / sin];
  // The direction of travel at the start, and the arc along it.
  const along: Vec3 = cross(axis, frame.up);
  const arcKm = Math.atan2(sin, cos) * CLOUD_MARCH_RADIUS_KM;
  return frameFrom(to, turned(frame.x, axis, sin, cos), [
    frame.q[0] + arcKm * dot(along, frame.x),
    frame.q[1] + arcKm * dot(along, frame.z),
  ]);
}
