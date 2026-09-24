# `src/main.ts`

## Purpose

Main entrypoint for `GpsPlusSlamJs_RealisticSunLightingDemo`. Bootstraps WebXR AR lifecycle via `createEnableGpsArController`, runs surface hit-testing with `startHitTestReticle`, places drift-compensated simple geometry with `createGpsAnchor`, and coordinates the solar lighting and shadow pipeline. Uses GPS-gated tap-to-place logic via `decideTapPlacement` to ensure GPS anchoring works correctly.

## Public API

Module executes `main()` on load (no exported symbols).

## Invariants

- Placed 3D content and the hit-test reticle are attached under `getArWorldGroup()` (AR-local space).
- Objects are added to `arWorldGroup` before GPS anchoring (required for `createGpsAnchor` to work correctly).
- Content bounds for shadow rig are calculated in NUE coordinates (arWorldGroup local space) to match shadow rig's GPS-world NUE space.
- The directional sun shadow light is anchored under `getScene()` in GPS-world NUE coordinates.
- Camera access is enabled (`enableCameraAccess: true`) for AR passthrough and visual feedback.
- Renderer shadow maps are enabled (`PCFSoftShadowMap`).
- HUD pointer events stop propagation to avoid misinterpreting control clicks as placement taps.
- Tap-to-place requires GPS fix via `decideTapPlacement()` gate (shows "waiting for GPS…" hint when unavailable).
- Transient hints auto-expire after 2 seconds and reset to default placement message.

## Examples

```bash
pnpm run dev
```

## Tests

Covered by headless smoke test `src/boot.test.ts` and repository configuration guards.
