# ar-waypoints.ts

- **Purpose:** pure layout of the AR mode's auto-spawned example targets (the 2026-07-17 AR-onboarding revision in the demo plan): three waypoints around the user's session-start pose so the HUD demonstrates itself immediately — ahead ~5 m (instant on-screen ring), right ~4 m (edge arrow), behind ~4.5 m (the flipped "turn around" arrow). Without them a freshly tap-placed nearby waypoint shows NO indicator (on-screen targets inside the activation distance start `hidden` by design) and first-time testers read the demo as broken.
- **Public API:** `buildExampleWaypoints(cameraPosition, cameraQuaternion): Vector3[]` (the 5 / 4 / 4.5 m distances are module-private constants).
- **Invariants (pinned by tests):** every example lies beyond `AR_HUD_CONFIG.distanceMax` (all three are active from frame one); exactly one ahead and one behind the start heading; all at camera eye height (ground-plane directions); a straight-down start pose falls back to world axes instead of yielding NaN; returned vectors are fresh (no caller aliasing).
- **Consumers:** [ar-mode.ts](ar-mode.ts.md) spawns these on the FIRST tracked XR frame (the init-time camera pose is not settled yet).
- **Tests:** `ar-waypoints.test.ts`.
