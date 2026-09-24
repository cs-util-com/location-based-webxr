# `src/sun-orchestrator.ts`

## Purpose

Orchestrates the solar rendering pipeline: subscribes to the `RealSunDataAdapter`, translates solar altitude to physical lighting parameters with `sunAltitudeToLighting`, updates the scene's ambient light, and drives both the `SunShadowRig` and `VisibleSunDisc`.

## Public API

```ts
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

export function createSunOrchestrator(
  deps: SunOrchestratorDependencies
): SunOrchestrator;
```

## Invariants

- Subscribes to solar state changes and propagates updates immediately to the shadow rig and ambient light.
- Shadow rig is updated in subscription with direction only (matches working SunShadowRigDemo pattern).
- `updateFrame` only updates the sun disc billboard, shadow rig handles itself via subscription.
- Shadow rig uses standard settings (2048px map, 0.4 opacity) matching the working demo.
- `dispose` unhooks subscriptions, disposes child resources, and removes ambient light from the scene.

## Examples

```ts
const orchestrator = createSunOrchestrator({ scene, arWorldGroup });

// In frame loop:
orchestrator.updateFrame(camera, placedBounds);
```

## Tests

Covered by unit tests in `src/sun-orchestrator.test.ts`.
