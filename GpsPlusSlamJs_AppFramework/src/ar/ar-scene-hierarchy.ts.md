# `ar-scene-hierarchy.ts`

## Purpose

Builds the Three.js scene graph shared by live AR and desktop replay, with the
AR/GPS coordinate-frame separation baked into the node structure.

## Public API

- `createSceneHierarchy(): { scene, arWorldGroup, arpose, camera }`
  - **Inputs:** none.
  - **Outputs:** the four nodes callers need handles on. The intermediate
    `basisChangeNode` is deliberately NOT returned — it is a constant and is
    found by name (`SCENE_NODE.BASIS_CHANGE`) when a test needs it.
  - **Error modes:** none. It constructs objects and cannot fail on valid input.

The frustum constants (`AR_CAMERA_FOV` 70°, `AR_CAMERA_NEAR` 0.01 m,
`AR_CAMERA_FAR` 200 m) are module-private; they are observable only on the
returned camera.

## Invariants & assumptions

- **The hierarchy is exactly** `scene → arWorldGroup → basisChangeNode → arpose
→ camera`, with the two lights attached to `scene` (GPS world space), never
  to `arWorldGroup`. Each of these edges is pinned by a test — they are the
  contract every transform composition depends on.
- `arWorldGroup`'s local space is **NUE** (X=North, Y=Up, Z=East). It is the
  node `applyAlignmentMatrix()` writes to.
  - **Two distinct NUE frames exist.** `arWorldGroup`'s local space is the
    _AR-odometry_ NUE frame (the alignment matrix's domain), not the GPS-world
    NUE frame of the scene root. GPS-world content must be pre-multiplied by
    alignment⁻¹ before being used as a local position under `arWorldGroup`.
- `basisChangeNode` holds `WEBXR_TO_NUE` with `matrixAutoUpdate = false`, so
  Three.js never overwrites it by decomposing position/quaternion/scale. This
  makes the WebXR→NUE basis change permanent and free of per-frame cost.
- `arWorldGroup` and `arpose` both start at identity. An identity `arpose` is
  transparent in the transform chain, which is what lets recording (WebXR
  writes `camera`) and replay (recorded pose writes `arpose`) share one graph.
- **Impurity:** reads `window.innerWidth` / `window.innerHeight` for the initial
  camera aspect, so tests need a DOM environment
  (`@vitest-environment jsdom`). Nothing else touches global state.

## Why this is its own module

It has two consumers on two different render paths. While it lived inside
`webxr-session.ts`, `replay-scene.ts` had to import the live-session module —
pulling in the `activeSession` singleton, the XR frame loop and the three
capture subsystems — just to build a scene that never enters a WebXR session.
Keep new live-session concerns out of this file; that coupling is what the
split removed.

## Examples

```ts
import { createSceneHierarchy } from './ar-scene-hierarchy';

const { scene, arWorldGroup, arpose, camera } = createSceneHierarchy();

// Live AR: WebXR drives the camera, arpose stays at identity.
renderer.render(scene, camera);

// Replay: the recorded odometry pose drives arpose instead.
arpose.position.fromArray(nueToWebXR(odomPosition));
arpose.quaternion.fromArray(nueQuaternionToWebXR(odomRotation));
```

## Tests

- `ar-scene-hierarchy.test.ts` — the full hierarchy contract: parent/child
  edges at every level, lighting placement, identity start transforms, the
  frozen `WEBXR_TO_NUE` matrix on `basisChangeNode`, and the F2 frustum
  regression guard (fov 70 / near 0.01 / far 200).
- `replay-scene.test.ts` asserts the replay path inherits this module's
  lighting.
- No fixtures or mocks required beyond the jsdom environment.
