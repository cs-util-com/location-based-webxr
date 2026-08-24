/**
 * Map zoom → 3D camera distance (H2).
 *
 * The map's +/- buttons drive the 3D view, and this is the only part of that
 * with arithmetic in it. Pure on purpose, like `elevation-nudge.ts` and
 * `compass-influence.ts`: the mapping is the part worth testing, and it should
 * be testable without a map, a renderer or a DOM.
 *
 * **What "the views agree" means here, stated because it is a CHOICE.** The 3D
 * camera sits ~29° above horizontal, so its footprint on the ground is a
 * trapezoid, not a rectangle — there is no single distance at which the two
 * views show the same area. This matches the frustum width **at the target
 * plane** to the map's ground width. That makes the near edge show slightly
 * less and the far edge slightly more, which is the behaviour a person reads as
 * "the same place, tilted".
 *
 * @see map-zoom-to-camera.ts.md
 */

/**
 * Ground metres per pixel at zoom 0 on the equator (Web Mercator, 256 px tiles).
 * The standard constant; `earthCircumference / 256`.
 */
const METRES_PER_PIXEL_Z0 = 156543.03392;

const DEG = Math.PI / 180;

/**
 * Closest the camera may come.
 *
 * Below this the near plane (0.5 m) and the buildings start to interpenetrate,
 * and a map zoomed to its maximum would otherwise put the camera inside a wall.
 */
export const MIN_CAMERA_DISTANCE_M = 30;

/**
 * Furthest the camera may go — and this clamp is REQUIRED, not defensive.
 *
 * Leaflet is given no `minZoom` here, so the map can zoom out to z10, which asks
 * for a camera roughly **36 km** away. Everything would be clipped and the user
 * would get an empty grey screen with no error anywhere.
 *
 * **HALF THE FAR PLANE, because the camera is TILTED:** at distance `d` the far
 * edge of the view is considerably further than `d`, so a limit at the far plane
 * itself would still clip the horizon. Half leaves room for the trapezoid.
 *
 * **RAISED 1200 → 2400 BY DEC-K2 (2026-08-22), and the reason is the request
 * that prompted it.** The old value was half of `FAR_PLANE_M = 2400`, the 1x
 * baseline. The page now boots at `DEFAULT_RENDER_MULTIPLIER`, drawing to
 * 4800 m, and a map that could still only pull the camera to 1200 m would let
 * the operator see a quarter of the distance the scene draws. The field ask was
 * literally "dann kann ich schön weit rauszoomen" — leaving this constant behind
 * would have delivered the draw distance and withheld the zoom.
 *
 * ⚠️ **It tracks the DEFAULT multiplier, not the current one.** Turning the dial
 * down to 1x leaves this clamp past that far plane, so a fully zoomed-out map
 * can then clip. Deliberate: the alternative is a clamp that moves under the
 * user's hand while they drag a different control, and the recovery here is to
 * zoom back in — visible and immediate, unlike the grey screen the clamp exists
 * to prevent.
 */
export const MAX_CAMERA_DISTANCE_M = 2400;

export interface ZoomToCameraInput {
  /** Leaflet zoom level (may be fractional during a pinch). */
  readonly zoom: number;
  /** Latitude of the map centre, degrees — Mercator scale depends on it. */
  readonly latDeg: number;
  /** Width of the map pane in CSS pixels. */
  readonly paneWidthPx: number;
  /** The 3D viewport's width / height. */
  readonly aspect: number;
  /** The 3D camera's VERTICAL field of view, degrees (three.js convention). */
  readonly vfovDeg: number;
}

const clamp = (value: number): number =>
  Math.min(MAX_CAMERA_DISTANCE_M, Math.max(MIN_CAMERA_DISTANCE_M, value));

/**
 * The camera distance whose frustum width at the target plane matches the ground
 * width the map is showing.
 *
 * `W = 156543.03 · cos(lat) / 2^z · paneWidthPx` is the ground width; the
 * horizontal half-angle is `atan(aspect · tan(vfov/2))`; and
 * `d = W / (2·tan(hfov/2))`.
 *
 * **Every non-finite or degenerate input collapses to the clamp rather than
 * propagating.** Zoom comes from a third-party library, the pane width comes
 * from layout (a `display: none` container reports 0), and the aspect comes from
 * a renderer that may not have been sized yet. A `NaN` reaching the camera
 * position produces an undefined view with no error raised anywhere — the
 * failure would look like "the 3D view went black", which is indistinguishable
 * from half a dozen other causes.
 */
export function cameraDistanceForZoom(input: ZoomToCameraInput): number {
  const { zoom, latDeg, paneWidthPx, aspect, vfovDeg } = input;
  if (
    !Number.isFinite(zoom) ||
    !Number.isFinite(latDeg) ||
    !Number.isFinite(paneWidthPx) ||
    !Number.isFinite(aspect) ||
    !Number.isFinite(vfovDeg) ||
    paneWidthPx <= 0 ||
    aspect <= 0 ||
    vfovDeg <= 0 ||
    vfovDeg >= 180
  ) {
    return MAX_CAMERA_DISTANCE_M;
  }

  const metresPerPixel =
    (METRES_PER_PIXEL_Z0 * Math.cos(latDeg * DEG)) / Math.pow(2, zoom);
  const groundWidthM = metresPerPixel * paneWidthPx;
  const halfHfov = Math.atan(aspect * Math.tan((vfovDeg * DEG) / 2));
  const tanHalf = Math.tan(halfHfov);
  if (
    !Number.isFinite(groundWidthM) ||
    !Number.isFinite(tanHalf) ||
    tanHalf <= 0
  ) {
    return MAX_CAMERA_DISTANCE_M;
  }
  const distance = groundWidthM / (2 * tanHalf);
  return Number.isFinite(distance) ? clamp(distance) : MAX_CAMERA_DISTANCE_M;
}
