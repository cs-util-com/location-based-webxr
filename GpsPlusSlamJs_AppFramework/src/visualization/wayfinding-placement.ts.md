# wayfinding-placement.ts

## Purpose

Pure placement seam of the wayfinding HUD: computes, for one target and one camera, a view-model placement (`hidden` | `circle` | `arrow`) on a HUD plane at `hudDistance` in front of the camera — position, rotation, distance label, and hysteresis against the previous frame's state. TypeScript port of the field-validated Prototype-2 `hud-placement.js` (`AR_Wayfinding_HUD_Component/Task 2`, PR #194); see the graduation plan `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md`. Consumed per frame by [wayfinding-hud.ts](wayfinding-hud.ts.md).

## Public API

- `formatDistanceLabel(distance: number): string` — `12.34 → "12.3 m"`.
- `getHudFrustumExtents(camera, hudDistance, isXrSession?): { width, height }` — physical frustum size at the HUD plane. With `isXrSession` it reads the projection matrix directly (in-session the WebXR runtime owns the projection and `fov`/`aspect` are stale); otherwise it derives from `fov`/`aspect`. Throws `RangeError` on a non-positive/non-finite `hudDistance`.
- `computeTargetPlacement(input: TargetPlacementInput): TargetPlacement` — the seam. Input:
  - `targetWorldPos: THREE.Vector3`, `camera: THREE.PerspectiveCamera` (explicit — no global reach; frustum-visibility precedent).
  - `hudDistance` (> 0), `distanceMin` (≥ 0), `distanceMax` (≥ distanceMin) — the distance hysteresis deadband.
  - `previousState?` (default `'hidden'`), `isXrSession?` (default `false`).
  - `viewportInner?` (default 0.95) / `viewportOuter?` (default 1.0) — NDC on-screen limits with arrow→circle hysteresis; `edgeMargin?` (default 0.9) — arrow inset fraction, in (0, 1].
  - Throws `RangeError` on any malformed range (validated every call — the checks are cheap scalar comparisons).
- Result `TargetPlacement` is a discriminated union on `state`:
  - common: `onScreen`, `isBehind`, `distance`, `distanceLabel`, `ndc`, `frustumWidth`, `frustumHeight`.
  - `'circle'`: `circlePosition`, `labelPosition` (camera-local, on the HUD plane at `z = -hudDistance`).
  - `'arrow'`: `arrowPosition` (on the edge-margin rectangle), `arrowRotationZ` (for an upward-pointing asset), `labelPosition` (inset toward center).

## Invariants & assumptions

- **Distance-gated visibility, independent of view direction (2026-07-18 revision):** the gate runs BEFORE the on/off-screen split. A fresh spawn (`previousState` omitted) is visible iff `distance ≥ distanceMin` — a target beyond the short-distance limit gets its indicator immediately, even inside the deadband. A visible target hides only below `distanceMin`; a deactivated (`'hidden'`) target shows NOTHING — no ring and no arrow — until `distance ≥ distanceMax`. Between the thresholds the previous state wins — no flicker, and no look-away bypass (the original prototype parity exempted the off-screen arrow from the gate, which let a glance away activate a deadband target at `distanceMin`; found in an AR field test, repro pinned in the tests).
- **ACTIVE off-screen targets keep their edge arrow inside the deadband** — the "turn around" cue survives for targets that are currently visible; only deactivated ones lose it.
- **Behind-camera flip:** `ndc` of a behind-camera target equals the ndc of its point reflection through the camera (both clip and w negate), so the arrow direction is negated to point where the user must turn.
- **Degenerate projection guard (deviation from the prototype):** a target on the camera plane (`w = 0`, e.g. exactly at the camera) has no defined screen direction — the seam returns `hidden` for that frame instead of NaN transforms.
- Calls `camera.updateMatrixWorld()` (parity with the prototype); the camera is otherwise not modified. Positions are **camera-local** — the presenter attaches indicators as camera children.
- All returned `Vector3`s are freshly allocated per call (three per call worst case). Fine at tens of targets; revisit only with profiler evidence.

## Examples

```ts
const placement = computeTargetPlacement({
  targetWorldPos: marker.getWorldPosition(new THREE.Vector3()),
  camera: getCamera()!,
  hudDistance: 2.5,
  distanceMin: 1.5,
  distanceMax: 3.0,
  previousState: prev,
  isXrSession: true,
});
if (placement.state === 'arrow') {
  arrowMesh.position.copy(placement.arrowPosition);
  arrowMesh.rotation.set(0, 0, placement.arrowRotationZ);
}
```

## Tests

- `wayfinding-placement.test.ts` — parity port of the Prototype-2 `hud-placement.test.js` suite (state selection, hysteresis deadband, behind-camera flip, frustum extents both paths, label formatting) plus boundary validation and the degenerate-projection guard. The prototype's `getEvaluationCamera` test is intentionally not ported (function dropped by the mono-camera decision).
- `wayfinding-placement.property.test.ts` — fast-check contracts: deadband never flickers / monotone activation over arbitrary frame sequences; arrows always on the edge-margin rectangle boundary at `z = -hudDistance`; behind-camera point-reflection symmetry (opposite arrow directions).
