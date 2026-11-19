/**
 * The three.js half of the sun shadow (AR sun shadow prototype plan
 * 2026-09-23-2343, §3.2, M2): drives a caller's `DirectionalLight` as the
 * shadow-casting sun, re-rendering its shadow map only when the pure rig
 * (`sun-shadow-rig.ts`) says so. Used by the look-dev page (M2) and OsmDemo
 * AR (M3).
 *
 * @see sun-shadow.ts.md
 */

import * as THREE from 'three';

import {
  SUN_SHADOW,
  shadowNeedsUpdate,
  sunShadowPose,
  type ShadowUpdateState,
  type ShadowUpdateThresholds,
  type SunShadowPose,
  type Vec3,
} from './sun-shadow-rig.js';

export interface SunShadowOptions {
  /** The light to drive; its parent must carry no scale (bounds are metres). */
  readonly light: THREE.DirectionalLight;
  /** Shadow map edge, texels (default `SUN_SHADOW.mapSize`). */
  readonly mapSize?: number;
  /** The light's distance D from the centre (default R + margin). */
  readonly distanceM?: number;
  readonly thresholds?: ShadowUpdateThresholds;
  /**
   * Between map renders, keep the light on the CURRENT sun direction (from
   * the last-rendered centre, at the last-rendered distance) instead of the
   * last-rendered pose. Safe because three rebuilds the shadow matrix only
   * when the map renders: the cached map keeps its pose while the shading
   * follows the sun. Default false (the light stays on the rendered pose).
   */
  readonly lightFollowsSun?: boolean;
}

/** Per-call overrides of the pose (a fit that changes with the view). */
export interface SunShadowFit {
  /** The light's distance D for a render this call makes. */
  readonly distanceM?: number;
  /** The shadow camera's far plane for a render this call makes. */
  readonly farM?: number;
}

export interface SunShadow {
  /**
   * Follow the sun and the user. Re-renders the map only when the rig's
   * update rule says so, and returns whether it did; on EVERY call it puts
   * the light back at the last-rendered pose, because three builds the
   * shadow camera from the light's position when the map renders, which may
   * be frames later.
   */
  update(now: ShadowUpdateState, fit?: SunShadowFit): boolean;
  /** Whether `update(now)` would re-render the map; changes nothing. */
  wouldUpdate(now: ShadowUpdateState): boolean;
  /**
   * Free the map's GPU memory and forget what it was rendered for; the
   * light keeps casting, and the next `update` renders a new map. For a
   * view that stops showing the shadow for a while.
   */
  release(): void;
  /** How many shadow-map renders `update` has requested. */
  readonly renders: number;
  /** Stop casting and restore the light as it was found (bias included). */
  dispose(): void;
}

/**
 * Turn the renderer's shadow maps on. Call BEFORE the first frame that uses
 * them: switching mid-session recompiles every lit material (exploration
 * §5.3), a visible hitch in AR. Leaving it on costs nothing per frame while
 * no light casts (three skips the pass).
 */
export function enableSunShadows(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

const copyState = (s: ShadowUpdateState): ShadowUpdateState => ({
  ...s,
  sunDir: [s.sunDir[0], s.sunDir[1], s.sunDir[2]],
  centre: [s.centre[0], s.centre[1], s.centre[2]],
});

/**
 * Makes `light` the shadow-casting sun: a manual shadow map (`autoUpdate`
 * off), the rig's orthographic bounds, a normal bias of one ground texel and
 * a depth bias of 0 (the normal bias alone carries the offset).
 * The light's target must be in the scene graph (three updates its matrix
 * there), or added by the caller.
 *
 * @throws RangeError for a map size that is not a positive integer.
 */
export function createSunShadow(options: SunShadowOptions): SunShadow {
  const { light } = options;
  const mapSize = options.mapSize ?? SUN_SHADOW.mapSize;
  if (!(Number.isInteger(mapSize) && mapSize > 0)) {
    throw new RangeError(
      `the shadow map size must be a positive integer, got ${mapSize}`
    );
  }
  const camera = light.shadow.camera;
  const previous = {
    castShadow: light.castShadow,
    autoUpdate: light.shadow.autoUpdate,
    normalBias: light.shadow.normalBias,
    bias: light.shadow.bias,
    mapSize: light.shadow.mapSize.clone(),
    position: light.position.clone(),
    target: light.target.position.clone(),
    bounds: [
      camera.left,
      camera.right,
      camera.top,
      camera.bottom,
      camera.near,
      camera.far,
    ],
  };
  // three reallocates a map only when there is none: an old one would keep
  // its size while PCF's texel size follows the new one.
  light.shadow.map?.dispose();
  light.shadow.map = null;
  light.castShadow = true;
  light.shadow.autoUpdate = false;
  light.shadow.bias = 0;
  light.shadow.mapSize.set(mapSize, mapSize);
  let lastRendered: ShadowUpdateState | undefined;
  let pose: SunShadowPose | undefined;
  let renders = 0;
  let disposed = false;

  let distance = 0;

  const placeLight = (p: SunShadowPose, sunDir: Vec3): void => {
    const [tx, ty, tz] = p.target;
    if (options.lightFollowsSun === true) {
      light.position.set(
        tx + sunDir[0] * distance,
        ty + sunDir[1] * distance,
        tz + sunDir[2] * distance
      );
    } else {
      light.position.set(...p.position);
    }
    light.target.position.set(tx, ty, tz);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  };

  const renderPose = (now: ShadowUpdateState, fit: SunShadowFit): void => {
    const distanceM = fit.distanceM ?? options.distanceM;
    pose = sunShadowPose({
      sunDir: now.sunDir,
      centre: now.centre,
      halfWidthM: now.halfWidthM,
      ...(distanceM === undefined ? {} : { distanceM }),
      ...(fit.farM === undefined ? {} : { farM: fit.farM }),
    });
    const [px, py, pz] = pose.position;
    distance = Math.hypot(px - now.centre[0], py - now.centre[1], pz - now.centre[2]);
    Object.assign(camera, pose.bounds);
    camera.updateProjectionMatrix();
    // One ground texel of normal bias: a 2R map of mapSize
    // texels.
    light.shadow.normalBias = (pose.bounds.right - pose.bounds.left) / mapSize;
    light.shadow.needsUpdate = true;
    // Stored as a copy: a caller's scratch arrays must not move it.
    lastRendered = copyState(now);
    renders += 1;
  };

  return {
    update(now, fit = {}) {
      if (disposed) return false;
      const render = shadowNeedsUpdate(lastRendered, now, options.thresholds);
      if (render) renderPose(now, fit);
      if (pose) placeLight(pose, now.sunDir);
      return render;
    },
    wouldUpdate(now) {
      if (disposed) return false;
      return shadowNeedsUpdate(lastRendered, now, options.thresholds);
    },
    release() {
      light.shadow.map?.dispose();
      light.shadow.map = null;
      lastRendered = undefined;
    },
    get renders() {
      return renders;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      light.castShadow = previous.castShadow;
      light.shadow.autoUpdate = previous.autoUpdate;
      light.shadow.normalBias = previous.normalBias;
      light.shadow.bias = previous.bias;
      light.shadow.mapSize.copy(previous.mapSize);
      light.position.copy(previous.position);
      light.target.position.copy(previous.target);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      [
        camera.left,
        camera.right,
        camera.top,
        camera.bottom,
        camera.near,
        camera.far,
      ] = previous.bounds as [number, number, number, number, number, number];
      camera.updateProjectionMatrix();
      light.shadow.map?.dispose();
      light.shadow.map = null;
    },
  };
}
