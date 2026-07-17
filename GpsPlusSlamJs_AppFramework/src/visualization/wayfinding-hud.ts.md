# wayfinding-hud.ts

## Purpose

Presenter of the wayfinding HUD: per-target frustum-locked indicators (edge arrow when off-screen, ring when on-screen far away, nothing when "arrived") plus a distance label, rendered as **children of the framework camera** and driven per frame by the pure seam [wayfinding-placement.ts](wayfinding-placement.ts.md). Graduation of the Prototype-2 `ARWayfindingHUD` — see `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md` (decisions + hard constraints).

## Public API

- `createWayfindingHud(options: WayfindingHudOptions): WayfindingHud` — validates the options, attaches per-target indicators to `options.camera`, registers a frame tick (`registerFrameUpdate`) and a session disposer (`registerSessionDisposer`), returns `{ dispose() }`.
- `validateWayfindingHudOptions(options)` — throws `TypeError`/`RangeError` on malformed options (missing camera/getTargets, missing or inverted `distanceMin`/`distanceMax`, non-positive `hudDistance`/`indicatorScale`/`labelScale`).
- `DEFAULT_WAYFINDING_HUD` — `{ hudDistance: 2.5, indicatorScale: 1.0, labelScale: 1.0 }`.
- `WayfindingHudOptions`:
  - `camera` (required) — the framework's logical camera (`getCamera()` from the `ar` module). Create the HUD **after** the AR session started; dispose on session end (automatic via the session-disposer registry, see below).
  - `getTargets: () => THREE.Vector3[]` (required) — polled once per frame; the single way to feed targets.
  - `distanceMin` / `distanceMax` (required) — the arrival/reactivation hysteresis deadband (meters).
  - `hudDistance?`, `indicatorScale?`, `labelScale?` — see defaults.
  - `arrowSprite?` / `circleSprite?` — `THREE.Texture | string` (URL). Procedural cone/ring fallbacks when omitted. Arrow assets must point **upward** and be centered.

## Invariants & assumptions

- **Never reparents the camera** (the prototype's `scene.add(camera)` would destroy the `arWorldGroup → basisChangeNode → arpose → camera` alignment chain). Indicators are added _to_ the camera.
- **No renderer handle.** Placement always reads the projection matrix (`isXrSession: true` path) — exact for any symmetric-frustum perspective camera and the only truthful source in-session.
- **Per-target state is index-based** (getter-API port of the prototype's waypoint arrays): shrink disposes trailing states; growth appends fresh `'hidden'` states. An identity change at a constant index is not detected — the hysteresis state machine continues; worst case is one early/late transition (single-anchor consumers are unaffected).
- **Resource ownership:** procedural cone/ring geometry + material are shared across targets and released only in `dispose()`; sprite materials and the label's canvas texture are per-target. Sprite **geometry** is three.js's global shared plane and is never disposed (fixes a prototype bug). URL-loaded indicator textures are owned/disposed by the HUD; caller-passed `THREE.Texture` instances stay caller-owned (deviation from the prototype, which disposed both).
- **Lifecycle:** frame tick registered at construction; `dispose()` is idempotent, unregisters the tick, detaches every HUD object and deregisters the session disposer. `resetWebXRState()` flushes the session-disposer registry, so the HUD never outlives its session even when the app drops the handle.
- Circle smoothing is snap-then-damp with a frame-rate-independent alpha `clampedAlpha(CIRCLE_DAMPING_RATE = 9, dt)` (`lerp-utils` idiom) — reproduces the field-validated prototype's fixed 0.15-per-frame factor at 60 fps while damping at the same wall-clock speed on 90 Hz devices (deliberate deviation from the prototype, decided 2026-07-17).
- Defensive boundary: a `getTargets()` result that is not an array is treated as an empty list and logged once.

## Examples

```ts
import { getCamera } from 'gps-plus-slam-app-framework/ar';
import { createWayfindingHud } from 'gps-plus-slam-app-framework/visualization';

const camera = getCamera();
if (camera) {
  const hud = createWayfindingHud({
    camera,
    getTargets: () =>
      markers.map((m) => m.getWorldPosition(new THREE.Vector3())),
    distanceMin: 1.5,
    distanceMax: 3.0,
  });
  // hud.dispose() on manual teardown; session end disposes automatically.
}
```

## Tests

- `wayfinding-hud.test.ts` — option validation (parity with the prototype's strict constructor), per-frame placement (circle/arrow/hidden, snap-then-damp circle smoothing, label positioning), target-count sync (trailing-state disposal on shrink, fresh hidden state on grow, shared procedural resources survive shrink, non-array getter tolerated), lifecycle (dispose detaches + unregisters, idempotent dispose, session-teardown auto-dispose, label resource release).
- The placement math itself is covered by `wayfinding-placement.test.ts` / `wayfinding-placement.property.test.ts`.
