# hud-targets.ts

## Purpose

Pure target feed for the wayfinding HUD (F2): maps the app's single anchor marker to the framework HUD's `getTargets()` contract — the marker's **world** position while visible, no targets otherwise. See the graduation plan `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md` (slice 4) and [main.ts](main.ts.md) for the wiring.

## Public API

- `hudTargetsFromMarker(marker: HudTargetMarker | null): WayfindingTarget[]` — `[]` when `marker` is null or `marker.visible` is false; otherwise `[{ id: "anchor", position: marker.getWorldPosition(new Vector3()) }]` (fresh literal per call; the constant id is the HUD's per-target state key, 2026-07-20 per-target config plan).
- `HudTargetMarker` — the structural slice needed (`visible` + `getWorldPosition`); matches both a real `THREE.Object3D` and the duck-typed e2e fake marker.

## Invariants & assumptions

- **World position, not local** — the marker is a child of the GPS-aligned `arWorldGroup`; local coordinates would point the HUD wrong once an alignment is applied.
- **Visibility gate** — the `?show=` cache-hit marker stays hidden at the AR origin until the first alignment (`hideUntilAligned` in `main.ts`); the HUD must not guide the user to that meaningless pose. Reusing `marker.visible` keeps one source of truth.
- Called once per frame by the HUD; allocates one target literal + `Vector3` per call (single marker — negligible). The stable `"anchor"` id keeps the HUD's hysteresis state continuous across the fresh literals.

## Examples

```ts
wayfindingHud = createWayfindingHud({
  camera,
  getTargets: () => hudTargetsFromMarker(hudMarker),
  distanceMin: 1.5,
  distanceMax: 3.0,
});
```

## Tests

- `hud-targets.test.ts` — null marker, hidden marker, world-position correctness under a transformed parent, fresh-target-with-stable-id per call.
- The end-to-end wiring (HUD created on placement and on the `?show=` cache-hit boot) is asserted in `playwright-tests/placement-flow.spec.js`.
