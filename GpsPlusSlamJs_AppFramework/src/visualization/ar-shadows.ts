/**
 * AR shadows on the reconstructed room (W4 AR shadows plan 2026-09-26-0549,
 * M3; DEC-W4-1/2, programme DEC-PRG-6): drives one world-fixed casting light
 * through the sun-shadow rig and makes the current `OcclusionMesh` receive,
 * AUTOMATICALLY, whenever the renderer's shadow map is on and a light casts.
 *
 * @see ar-shadows.ts.md
 */

import * as THREE from 'three';

import type { OcclusionMesh } from './occlusion-mesh.js';
import type { ShadowReceiverOptions } from './shadow-receiver.js';
import { createSunShadow, type SunShadow } from './sun-shadow.js';
import { SUN_SHADOW, shadowOpacity, type Vec3 } from './sun-shadow-rig.js';

/** Defaults; R and N are provisional until the M2 sweep (plan §6-§7). */
export const AR_SHADOWS = {
  /** Indoor half width R: 5 m gives 0.98 cm texels at N 1024. */
  halfWidthM: 5,
  mapSize: 1024,
  /** The rig's display opacity for its transmittance (~0.42). */
  opacity: shadowOpacity(SUN_SHADOW.transmittance),
} as const;

/** The only renderer state the rule reads (a stub in tests). */
export interface ArShadowsRenderer {
  readonly shadowMap: {
    readonly enabled: boolean;
    readonly type: THREE.ShadowMapType;
  };
}

/** The three.js lights that can cast a shadow map. */
export type ShadowCastingLight =
  THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;

export type ShadowReception =
  | { readonly active: true }
  | {
      readonly active: false;
      readonly reason:
        'shadow-map-off' | 'no-casting-light' | 'vsm-unsupported';
    };

/**
 * The automatic rule: reception is on iff the shadow map is enabled, it is
 * not VSM (three draws receivers into a VSM map, so the mesh would shadow
 * itself), and some visible light casts with a shadow intensity above 0.
 */
export function shadowReception(
  renderer: ArShadowsRenderer,
  lights: readonly ShadowCastingLight[]
): ShadowReception {
  if (!renderer.shadowMap.enabled) {
    return { active: false, reason: 'shadow-map-off' };
  }
  if (renderer.shadowMap.type === THREE.VSMShadowMap) {
    return { active: false, reason: 'vsm-unsupported' };
  }
  const casts = lights.some(
    (l) => l.visible && l.castShadow && l.shadow.intensity > 0
  );
  return casts
    ? { active: true }
    : { active: false, reason: 'no-casting-light' };
}

export interface ArShadowsOptions {
  readonly renderer: ArShadowsRenderer;
  /** The world-fixed light (PhysicsDemo: the scene's `SUN_LIGHT`). */
  readonly light: THREE.DirectionalLight;
  /** The CURRENT occluder (PhysicsDemo recreates it), or null. */
  readonly getOccluder: () => OcclusionMesh | null;
  /** A flat receiver shown only while the mesh has no triangles. */
  readonly fallbackPlane?: THREE.Object3D | null;
  readonly opacity?: number;
  readonly halfWidthM?: number;
  readonly mapSize?: number;
  /** Casters move every frame (thrown balls): render the map while any exist. */
  readonly dynamicCasters?: boolean;
}

export interface ArShadowsFrame {
  /** The shadow square's centre (the user, near the floor), light's frame. */
  readonly centre: Vec3;
  /** How many objects cast (PhysicsDemo: the ball count). */
  readonly casterCount: number;
}

export interface ArShadows {
  /** Options for a NEW occluder (construction), undefined while inactive. */
  receiverOptions(): ShadowReceiverOptions | undefined;
  /** Per frame, before render: the rule, the receiver, the map. */
  update(frame: ArShadowsFrame): void;
  /** The session switch: shadow intensity, never castShadow (no recompile). */
  setEnabled(on: boolean): void;
  isActive(): boolean;
  /** How many map renders the rig has requested (a diagnostic). */
  mapRenders(): number;
  dispose(): void;
}

/**
 * Makes `options.light` cast (via `createSunShadow`) with the direction it
 * has now, fixed for the session.
 *
 * @throws RangeError for a light at or below the horizon, or invalid sizes.
 */
export function createArShadows(options: ArShadowsOptions): ArShadows {
  const { light, renderer } = options;
  const dir = light.position.clone().sub(light.target.position);
  if (!(dir.lengthSq() > 0) || dir.y <= 0) {
    throw new RangeError('the shadow light must stand above the horizon');
  }
  dir.normalize();
  const sunDir: Vec3 = [dir.x, dir.y, dir.z];
  const receiver: ShadowReceiverOptions = {
    opacity: options.opacity ?? AR_SHADOWS.opacity,
  };
  const halfWidthM = options.halfWidthM ?? AR_SHADOWS.halfWidthM;
  const dynamic = options.dynamicCasters ?? false;
  const foundIntensity = light.shadow.intensity;
  const shadow: SunShadow = createSunShadow({
    light,
    mapSize: options.mapSize ?? AR_SHADOWS.mapSize,
  });
  let enabled = true;
  let active = false;
  let lastCasters = 0;
  let disposed = false;

  const reconcile = (): void => {
    active = shadowReception(renderer, [light]).active;
    // Inactive: stop paying for a map nobody draws (moving casters would
    // otherwise re-render it every frame; intensity 0 does not stop the pass).
    if (!active) light.shadow.autoUpdate = false;
    const occluder = options.getOccluder();
    occluder?.setShadowReceiver(active ? receiver : null);
    const plane = options.fallbackPlane;
    if (plane) {
      plane.visible = active && (occluder?.getTriangleCount() ?? 0) === 0;
    }
  };

  return {
    receiverOptions: () =>
      shadowReception(renderer, [light]).active ? receiver : undefined,
    update(frame) {
      if (disposed) return;
      reconcile();
      if (!active) return;
      shadow.update({
        sunDir,
        centre: frame.centre,
        halfWidthM,
        casterGeneration: dynamic ? 'dynamic' : String(frame.casterCount),
        casterOffsetM: 0,
      });
      if (dynamic) {
        const moving = frame.casterCount > 0;
        // One last render when the last caster goes, so no shadow lingers.
        if (!moving && lastCasters > 0) light.shadow.needsUpdate = true;
        light.shadow.autoUpdate = moving;
      }
      lastCasters = frame.casterCount;
    },
    setEnabled(on) {
      if (disposed || on === enabled) return;
      enabled = on;
      light.shadow.intensity = on ? foundIntensity : 0;
      if (on) light.shadow.needsUpdate = true;
      reconcile();
    },
    isActive: () => active,
    mapRenders: () => shadow.renders,
    dispose() {
      if (disposed) return;
      disposed = true;
      options.getOccluder()?.setShadowReceiver(null);
      if (options.fallbackPlane) options.fallbackPlane.visible = false;
      light.shadow.intensity = foundIntensity;
      shadow.dispose();
    },
  };
}
