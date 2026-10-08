/**
 * The cloud volume's arithmetic (volume-cloud plan 2026-10-05-0016, C2):
 * the framework's ray-marched slab near the camera, its clouds taken from
 * the globe's own cloud map so the swap from the shell never plops.
 *
 * - `cloudVolumeShare`: the volume's share by altitude, 1 below the ceiling
 *   minus the fade, 0 at the ceiling (smoothstep). Its disc and the shell's
 *   hole both scale with it, so no altitude draws the clouds twice or not
 *   at all.
 * - `cloudVolumeMapUv`: where a point of the target's local frame (x east,
 *   z south, metres) reads the globe's cloud map, with the clouds' drift;
 *   the CPU twin of the GLSL chunk.
 * - `CLOUD_VOLUME_COVERAGE_GLSL`: the chunk the slab's coverage hook takes
 *   (`setCloudSlabCoverage`), defining `atmCloudCoverageAt(vec2 xz)`.
 *
 * A flat frame around the target: within the disc (at most 40 km) the
 * curvature's drop is 125 m, a tenth of the slab's thickness.
 *
 * @see globe-cloud-volume.ts.md
 */
import { smoothstep } from "./globe-ease.js";

const EARTH_RADIUS_M = 6_371_000;

export const CLOUD_VOLUME = {
  /** The volume's disc, km (the plan's R), centred where the view meets the deck. */
  radiusKm: 80,
  /**
   * The disc's centre is at most this far ahead of the camera, km (§15).
   * The slab is flat in the frame while the Earth curves: at this plus the
   * radius (140 km) the deck stands 1.5 km above the curved shell, in the
   * far fade, where it gives way to the shell.
   */
  maxAheadKm: 60,
  /** No volume at and above this altitude, km. */
  ceilingKm: 40,
  /** It fades in over this much below the ceiling, km. */
  fadeKm: 10,
};

/**
 * The volume's share at `altitudeKm`: 1 at and below `ceilingKm - fadeKm`,
 * 0 at and above `ceilingKm`, smoothstep between. RangeError for a
 * non-finite altitude or a fade that is not positive.
 */
export function cloudVolumeShare(
  altitudeKm: number,
  {
    ceilingKm = CLOUD_VOLUME.ceilingKm,
    fadeKm = CLOUD_VOLUME.fadeKm,
  }: { ceilingKm?: number; fadeKm?: number } = {},
): number {
  if (!Number.isFinite(altitudeKm)) {
    throw new RangeError(`the altitude must be finite, got ${altitudeKm}`);
  }
  if (!(fadeKm > 0 && Number.isFinite(ceilingKm))) {
    throw new RangeError(
      `the fade must be positive and the ceiling finite, got ${fadeKm}, ${ceilingKm}`,
    );
  }
  return 1 - smoothstep((altitudeKm - (ceilingKm - fadeKm)) / fadeKm);
}

/**
 * The cloud map's uv for the local point (`xM` east, `zM` south of the
 * target, metres): the target's latitude and longitude moved by the point
 * on a flat frame, then the globe's mapping (u the longitude, v the
 * latitude) with the drift east taken off u. RangeError for a non-finite
 * input.
 */
export function cloudVolumeMapUv(
  xM: number,
  zM: number,
  origin: { latRad: number; lonRad: number; lonOffsetRad: number },
): [number, number] {
  const values = [xM, zM, origin.latRad, origin.lonRad, origin.lonOffsetRad];
  if (!values.every(Number.isFinite)) {
    throw new RangeError(
      `the point and the origin must be finite, got ${values.join(", ")}`,
    );
  }
  const lat = origin.latRad - zM / EARTH_RADIUS_M;
  const lon =
    origin.lonRad +
    xM / (EARTH_RADIUS_M * Math.max(Math.cos(origin.latRad), 0.01));
  return [
    lon / (2 * Math.PI) + 0.5 - origin.lonOffsetRad / (2 * Math.PI),
    lat / Math.PI + 0.5,
  ];
}

/**
 * Where the volume's disc is centred (volume-cloud plan §15): where the
 * view's centre meets the deck (`deckY`, the frame's height of the
 * shell), along the view's heading, at most `maxAheadM` ahead of the camera
 * horizontally; `maxAheadM` ahead when the view never meets the deck
 * (looking at the horizon, or away from it); under the camera looking
 * straight down. `camera` and `direction` (unit) are in the world frame
 * (x east, y up, z south). Returns the centre's x, z and its horizontal
 * distance ahead. RangeError for a non-finite input or a negative
 * `maxAheadM`.
 */
export function cloudVolumeDiscCentre(input: {
  camera: readonly [number, number, number];
  direction: readonly [number, number, number];
  deckY: number;
  maxAheadM: number;
}): { x: number; z: number; aheadM: number } {
  const { camera, direction, deckY, maxAheadM } = input;
  const values = [...camera, ...direction, deckY, maxAheadM];
  if (!values.every(Number.isFinite)) {
    throw new RangeError(
      `the camera, direction and deck must be finite, got ${values.join(", ")}`,
    );
  }
  if (maxAheadM < 0) {
    throw new RangeError(`the reach ahead must be >= 0, got ${maxAheadM}`);
  }
  const [cx, cy, cz] = camera;
  const [dx, dy, dz] = direction;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 1e-9) return { x: cx, z: cz, aheadM: 0 };
  const towardDeck = (deckY - cy) * dy > 0;
  const aheadM = Math.min(
    towardDeck ? ((deckY - cy) / dy) * horizontal : maxAheadM,
    maxAheadM,
  );
  return {
    x: cx + (dx / horizontal) * aheadM,
    z: cz + (dz / horizontal) * aheadM,
    aheadM,
  };
}

/**
 * The slab's noise offset (in tiles, each wrapped to [0, periodTiles)) that anchors
 * its noise to the ground: the target's distance east and south of
 * latitude 0, longitude 0, the longitude taken at the map's drift
 * (`lonOffsetRad`), over the noise tile `tileM`. The slab reads its noise at
 * `xz / tile + offset` in the target's local frame (x east, z south), so a
 * ground point reads the same noise whichever target the frame is centred
 * on, and the noise drifts east with the map's clouds. Without it every
 * place put the same patch of noise under its target. `periodTiles` is
 * where the noise repeats: one tile for the plain texture, more for the
 * hex-tiled octave (13, `hexPeriodTiles` in the framework's
 * `cloud-hex.ts`); wrapped at one tile, the hex field jumped. RangeError
 * for a non-finite input, a tile that is not positive or a period that is
 * not a positive whole number of tiles.
 */
export function cloudVolumeNoiseOffset(
  origin: { latRad: number; lonRad: number; lonOffsetRad: number },
  tileM: number,
  periodTiles: number,
): [number, number] {
  const values = [origin.latRad, origin.lonRad, origin.lonOffsetRad];
  if (!values.every(Number.isFinite)) {
    throw new RangeError(`the origin must be finite, got ${values.join(", ")}`);
  }
  if (!(tileM > 0 && Number.isFinite(tileM))) {
    throw new RangeError(`the noise tile must be positive, got ${tileM}`);
  }
  if (!(Number.isInteger(periodTiles) && periodTiles > 0)) {
    throw new RangeError(
      `the noise period must be a positive whole number of tiles, got ${periodTiles}`,
    );
  }
  const east =
    (EARTH_RADIUS_M *
      Math.cos(origin.latRad) *
      (origin.lonRad - origin.lonOffsetRad)) /
    tileM;
  const south = (-EARTH_RADIUS_M * origin.latRad) / tileM;
  // Wrapped, and never the period from a rounding just below a multiple.
  const wrap = (t: number) => {
    const f = t - periodTiles * Math.floor(t / periodTiles);
    return f < periodTiles ? f : 0;
  };
  return [wrap(east), wrap(south)];
}

/**
 * The slab's coverage chunk: the cloud map read where the column stands
 * (`cloudVolumeMapUv`'s formula), times the clouds' opacity and the
 * volume's altitude share. Its uniforms: `uVolumeClouds` (the globe's map),
 * `uVolumeOrigin` (the target's latitude and longitude, radians),
 * `uVolumeLonOffset` (the drift, radians), `uVolumeOpacity`, `uVolumeShare`,
 * `uVolumeGain` (the cover's gain on the map, 1 by default).
 */
export const CLOUD_VOLUME_COVERAGE_GLSL = /* glsl */ `
uniform sampler2D uVolumeClouds;
uniform vec2 uVolumeOrigin;
uniform float uVolumeLonOffset;
uniform float uVolumeOpacity;
uniform float uVolumeShare;
uniform float uVolumeGain;
float atmCloudCoverageAt(vec2 xz) {
  float lat = uVolumeOrigin.x - xz.y / ${EARTH_RADIUS_M.toFixed(1)};
  float lon = uVolumeOrigin.y + xz.x / ( ${EARTH_RADIUS_M.toFixed(1)} * max( cos( uVolumeOrigin.x ), 0.01 ) );
  vec2 uv = vec2( ( lon - uVolumeLonOffset ) * 0.15915494309189535 + 0.5, lat * 0.3183098861837907 + 0.5 );
  return texture2D( uVolumeClouds, uv ).r * uVolumeOpacity * uVolumeGain * uVolumeShare;
}`;
