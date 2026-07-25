# wayfinding-hud.ts

## Purpose

Presenter of the wayfinding HUD: per-target frustum-locked indicators (edge arrow when off-screen, ring when on-screen far away, nothing when "arrived") plus a distance label, rendered as **children of the framework camera** and driven per frame by the pure seam [wayfinding-placement.ts](wayfinding-placement.ts.md). Graduation of the Prototype-2 `ARWayfindingHUD` — see `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md` (decisions + hard constraints).

## Public API

- `createWayfindingHud(options: WayfindingHudOptions): WayfindingHud` — validates the options, attaches per-target indicators to `options.camera`, registers a frame tick (`registerFrameUpdate`) and a session disposer (`registerSessionDisposer`), returns `{ dispose() }`.
- `validateWayfindingHudOptions(options)` — throws `TypeError`/`RangeError` on malformed options (missing camera/getTargets, missing or inverted `distanceMin`/`distanceMax`, non-positive `hudDistance`/`indicatorScale`/`labelScale`).
- `DEFAULT_WAYFINDING_HUD` — `{ hudDistance: 2.5, indicatorScale: 1.0, labelScale: 1.0 }`.
- `WayfindingTarget` (2026-07-20 per-target config plan, clean break from the earlier `Vector3[]` contract):
  - `position: THREE.Vector3` (required) — world position.
  - `id?: string` — stable identity for per-target hysteresis state; must be unique within one `getTargets()` result. Omit → index keying (today's semantics for static lists).
  - `distanceMin?` / `distanceMax?` — per-target deadband overrides; default to the HUD-level options; same `0 ≤ min ≤ max` rule.
  - `showArrowWhenInactive?` (default `false`) — restore the pre-2026-07-18 "always guide me back" edge arrow for THIS target while deactivated and off-screen; on-screen still shows nothing and the `distanceMax` reactivation gate is untouched (the seam keeps the state `'hidden'` and ships the arrow as a display-only payload — see the seam sidecar).
  - `showLabelWhenInactive?` (default `true`, old parity) — distance label with the inactive arrow; only meaningful with `showArrowWhenInactive`.
- `WayfindingHudOptions`:
  - `camera` (required) — the framework's logical camera (`getCamera()` from the `ar` module). Create the HUD **after** the AR session started; dispose on session end (automatic via the session-disposer registry, see below).
  - `getTargets: () => WayfindingTarget[]` (required) — polled once per frame; the single way to feed targets.
  - `distanceMin` / `distanceMax` (required) — the arrival/reactivation hysteresis deadband (meters); per-target values override them.
  - `hudDistance?`, `indicatorScale?`, `labelScale?` — see defaults.
  - `arrowSprite?` / `circleSprite?` — `THREE.Texture | string` (URL). Procedural cone/ring fallbacks when omitted. Arrow assets must point **upward** and be centered.
  - `autoRegisterFrameUpdate?` (default `true`) — set `false` for hosts that own their render loop (desktop simulators, replay scenes; nothing ticks the framework frame loop outside a WebXR session) and call `hud.update(dt)` per frame instead. Either/or — never combine auto-registration with manual `update` calls (double-tick). `update` is a no-op after `dispose()` (it would otherwise re-create per-target state from `getTargets()`).

## Invariants & assumptions

- **Never reparents the camera** (the prototype's `scene.add(camera)` would destroy the `arWorldGroup → basisChangeNode → arpose → camera` alignment chain). Indicators are added _to_ the camera.
- **No renderer handle.** Placement always reads the projection matrix (`isXrSession: true` path) — exact for any symmetric-frustum perspective camera and the only truthful source in-session.
- **Per-target state is keyed by `id ?? index`** in a `Map` (2026-07-20 revision of the index-only keying): states whose key vanishes from the validated result are disposed; new keys get fresh SPAWN states (`currentState: null` — the seam's spawn rule makes them visible immediately at `≥ distanceMin`, 2026-07-18 revision). With ids, state follows the target through reorders and fresh-literal rebuilds; without ids, an identity change at a constant index is still not detected (unchanged limitation, opt out by providing ids).
- **Resource ownership:** procedural cone/ring geometry + material are shared across targets and released only in `dispose()`; sprite materials and the label's canvas texture are per-target. Sprite **geometry** is three.js's global shared plane and is never disposed (fixes a prototype bug). URL-loaded indicator textures are owned/disposed by the HUD; caller-passed `THREE.Texture` instances stay caller-owned (deviation from the prototype, which disposed both).
- **Lifecycle:** frame tick registered at construction; `dispose()` is idempotent, unregisters the tick, detaches every HUD object and deregisters the session disposer. `resetWebXRState()` flushes the session-disposer registry, so the HUD never outlives its session even when the app drops the handle.
- Circle smoothing is snap-then-damp with a frame-rate-independent alpha `clampedAlpha(CIRCLE_DAMPING_RATE = 9, dt)` (`lerp-utils` idiom) — reproduces the field-validated prototype's fixed 0.15-per-frame factor at 60 fps while damping at the same wall-clock speed on 90 Hz devices (deliberate deviation from the prototype, decided 2026-07-17).
- **Defensive boundary — never a per-frame throw:** the getter runs inside the frame loop (a throw would be logged 60–90×/s by the loop's isolation and would kill manual-`update` hosts outright), so consumer bugs are downgraded to "hide + `log.error` ONCE per offending key": non-array result → empty list; legacy plain-`Vector3` element → migration error naming `WayfindingTarget`; malformed element / non-string `id`; duplicate `id` in one result → only the first occurrence shown; per-target deadband violating `0 ≤ min ≤ max`. Each one-shot log entry clears when the target heals, so a later regression logs again.

## Examples

```ts
import { getCamera } from 'gps-plus-slam-app-framework/ar';
import { createWayfindingHud } from 'gps-plus-slam-app-framework/visualization';

const camera = getCamera();
if (camera) {
  const hud = createWayfindingHud({
    camera,
    getTargets: () =>
      markers.map((m) => ({
        id: m.uuid, // stable identity — fresh literals per call are fine
        position: m.getWorldPosition(new THREE.Vector3()),
      })),
    distanceMin: 1.5,
    distanceMax: 3.0,
  });
  // hud.dispose() on manual teardown; session end disposes automatically.
}

// Per-target overrides: an "exit" target that keeps guiding when arrived.
const exit: WayfindingTarget = {
  id: 'exit',
  position: exitPos,
  distanceMin: 0.5,
  showArrowWhenInactive: true, // edge arrow even below distanceMin (off-screen)
};
```

## Tests

- `wayfinding-hud.test.ts` — option validation (parity with the prototype's strict constructor), per-frame placement (circle/arrow/hidden, snap-then-damp circle smoothing, label positioning), target-count sync (state disposal on shrink, fresh hidden state on grow, shared procedural resources survive shrink, non-array getter tolerated), per-target configuration (id keying through reorders, deadband overrides, one-shot boundary errors for legacy/duplicate/invalid targets, inactive-arrow rendering incl. the no-bypass and label flags), lifecycle (dispose detaches + unregisters, idempotent dispose, session-teardown auto-dispose, label resource release).
- `wayfinding-hud.property.test.ts` — fast-check contract: with stable ids, visible indicators are invariant under arbitrary per-frame reordering of the getTargets() result.
- The placement math itself is covered by `wayfinding-placement.test.ts` / `wayfinding-placement.property.test.ts`.
