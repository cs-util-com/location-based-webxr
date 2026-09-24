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
} from './sun-shadow-rig.js';

export interface SunShadowOptions {
  /** The light to drive; its parent must carry no scale (bounds are metres). */
  readonly light: THREE.DirectionalLight;
  /** Shadow map edge, texels (default `SUN_SHADOW.mapSize`). */
  readonly mapSize?: number;
  /** The light's distance D from the centre (default R + margin). */
  readonly distanceM?: number;
  readonly thresholds?: ShadowUpdateThresholds;
}

export interface SunShadow {
  /**
   * Follow the sun and the user. Re-renders the map only when the rig's
   * update rule says so, and returns whether it did; on EVERY call it puts
   * the light back at the last-rendered pose, because three builds the
   * shadow camera from the light's position when the map renders, which may
   * be frames later.
   */
  update(now: ShadowUpdateState): boolean;
  /** How many shadow-map renders `update` has requested. */
  readonly renders: number;
  /** Stop casting and restore the light as it was found. */
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
 * off), the rig's orthographic bounds, a normal bias of one ground texel.
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
  light.shadow.mapSize.set(mapSize, mapSize);
  let lastRendered: ShadowUpdateState | undefined;
  let pose: SunShadowPose | undefined;
  let renders = 0;
  let disposed = false;

  const placeLight = (p: SunShadowPose): void => {
    light.position.set(...p.position);
    light.target.position.set(...p.target);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  };

  return {
    update(now) {
      if (disposed) return false;
      const render = shadowNeedsUpdate(lastRendered, now, options.thresholds);
      if (render) {
        pose = sunShadowPose({
          sunDir: now.sunDir,
          centre: now.centre,
          halfWidthM: now.halfWidthM,
          ...(options.distanceM === undefined
            ? {}
            : { distanceM: options.distanceM }),
        });
        Object.assign(camera, pose.bounds);
        camera.updateProjectionMatrix();
        // One ground texel of normal bias (plan §3.2): a 2R map of mapSize
        // texels.
        light.shadow.normalBias =
          (pose.bounds.right - pose.bounds.left) / mapSize;
        light.shadow.needsUpdate = true;
        // Stored as a copy: a caller's scratch arrays must not move it.
        lastRendered = copyState(now);
        renders += 1;
      }
      if (pose) placeLight(pose);
      return render;
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
