# scene-node-names.ts

## Purpose

Canonical constants for Three.js scene-node names used in `Object3D.name` assignments and `getObjectByName()` lookups. Provides compile-time safety — a typo becomes a build error instead of a silent `null`.

## Public API

```ts
export const SCENE_NODE: {
  BASIS_CHANGE: 'webxr-to-nue';
  CAMERA_FOLLOWER: 'camera-follower';
  AMBIENT_LIGHT: 'ar-ambient-light';
  SUN_LIGHT: 'ar-sun-light';
};
```

## Invariants & assumptions

- Values must match the strings expected by the Three.js scene hierarchy. Changing a value here changes it everywhere.
- `BASIS_CHANGE` — the node holding the WebXR→NUE basis-change matrix; child of `arWorldGroup`.
- `CAMERA_FOLLOWER` — the GPS-world-aligned node that tracks camera position; child of **scene root** (not `arWorldGroup`), so its world rotation stays identity regardless of the alignment matrix.
- `AMBIENT_LIGHT`, `SUN_LIGHT` — the AR scene's two lights on the scene root; `SUN_LIGHT` is the directional light fixed at (0, 10, 5), which the AR sun shadow prototype finds by name, drives as the sun and restores (plan 2026-09-23-2343, §7 item 11).

## Consumers

- `ar-scene-hierarchy.ts` — sets `BASIS_CHANGE`, `AMBIENT_LIGHT` and `SUN_LIGHT` names during `createSceneHierarchy()`
- `camera-follower.ts` — sets `CAMERA_FOLLOWER` name at construction
- Test files — import constants for type-safe assertions

## Tests

- `scene-node-names.test.ts` — verifies exported values match expected strings
