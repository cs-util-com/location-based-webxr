import * as THREE from 'three';
import {
  createRealSunDataAdapter,
  type RealSunDataAdapter,
  type RealSunDataState,
} from 'gps-plus-slam-app-framework/geo/real-sun-data-adapter';
import { sunAltitudeToLighting } from 'gps-plus-slam-app-framework/geo/sun-altitude-lighting';
import type { NueDirection } from 'gps-plus-slam-app-framework/geo/sun-position';
import {
  createSunShadowRig,
  type SunShadowRig,
  type ContentBounds,
} from 'gps-plus-slam-app-framework/visualization/sun-shadow-rig';
import {
  createVisibleSunDisc,
  type VisibleSunDisc,
} from 'gps-plus-slam-app-framework/visualization/visible-sun-disc';

export interface SunOrchestratorDependencies {
  readonly scene: THREE.Scene;
  readonly arWorldGroup: THREE.Group;
}

export interface SunOrchestrator {
  readonly adapter: RealSunDataAdapter;
  readonly shadowRig: SunShadowRig;
  readonly sunDisc: VisibleSunDisc;
  readonly ambientLight: THREE.AmbientLight;

  updateFrame(camera: THREE.Camera, contentBounds?: ContentBounds): void;
  dispose(): void;
}

/**
 * Connects the real sun data adapter, solar lighting calculator,
 * directional shadow rig, visible sky sun disc, and scene ambient light.
 */
export function createSunOrchestrator(
  deps: SunOrchestratorDependencies
): SunOrchestrator {
  const adapter = createRealSunDataAdapter();
  const shadowRig = createSunShadowRig(deps.scene, {
    mapSize: 2048,
    groundPlaneSize: 100,
    shadowOpacity: 0.6,
    bias: -0.0005,
    normalBias: 0.03,
  });
  const sunDisc = createVisibleSunDisc(deps.scene, {
    distance: 15,
    diameter: 0.8,
  });
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  deps.scene.add(ambientLight);

  let latestDirectionNue: NueDirection | null = null;
  let latestAltitudeRad = 0;

  const unsubscribe = adapter.subscribe((state: RealSunDataState) => {
    if (state.status === 'ready') {
      latestDirectionNue = state.sample.sun.directionNue;
      latestAltitudeRad = state.sample.sun.altitudeRad;

      // 1. Calculate lighting model from altitude angle
      const lighting = sunAltitudeToLighting(latestAltitudeRad);

      // 2. Update ambient light level and color
      ambientLight.intensity = lighting.ambientLevel;
      ambientLight.color.setHex(lighting.color);

      // 3. Update shadow rig with direction and lighting (content bounds updated per-frame)
      // Increase directional light intensity for better visibility
      const enhancedLighting = {
        ...lighting,
        intensity: lighting.intensity * 1.5,
      };
      shadowRig.update(latestDirectionNue, undefined, enhancedLighting);
    }
  });

  return {
    adapter,
    shadowRig,
    sunDisc,
    ambientLight,

    updateFrame(camera: THREE.Camera, contentBounds?: ContentBounds): void {
      if (latestDirectionNue) {
        // Update billboard position & frustum visibility for sun disc
        sunDisc.update(latestDirectionNue, camera);

        // Update shadow rig with content bounds for proper shadow framing
        if (contentBounds) {
          const lighting = sunAltitudeToLighting(latestAltitudeRad);
          const enhancedLighting = {
            ...lighting,
            intensity: lighting.intensity * 1.5,
          };
          shadowRig.update(latestDirectionNue, contentBounds, enhancedLighting);
        }
      }
    },

    dispose(): void {
      unsubscribe();
      adapter.dispose();
      shadowRig.dispose();
      sunDisc.dispose();
      ambientLight.removeFromParent();
      ambientLight.dispose();
    },
  };
}
