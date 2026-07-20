# sim-waypoints.ts

- **Purpose:** the desktop simulator's synthetic waypoint layout (Prototype-1 precedent: one ahead, one to the side, one behind, one elevated) plus the wireframe-sphere marker factory shared with the AR tap-to-place mode.
- **Public API:**
  - `SIM_EYE_HEIGHT` (1.6 m) — simulator camera eye height.
  - `SIM_WAYPOINTS: readonly SimWaypoint[]` — `{ id, position }` pairs (world positions relative to the camera start `(0, 1.6, 5)` looking −z). The ids are the stable per-target state keys the HUD requires since the 2026-07-20 per-target config plan; `desktop-sim.ts` maps them 1:1 into `WayfindingTarget`s.
  - `createWaypointMarker(position): THREE.Mesh` — named `waypoint-marker`, copies the position (no aliasing); caller owns scene insertion/disposal.
- **Invariants (pinned by tests — the e2e depends on them):** every waypoint starts beyond `SIM_HUD_CONFIG.distanceMax` (so nothing starts "arrived"); exactly ONE waypoint is straight ahead of the start pose (the initial ring the walk-flow e2e drives at); at least one behind and one elevated target (arrow variety incl. the behind-camera flip); ids are unique (a duplicate would be hidden by the HUD's boundary validation).
- **Tests:** `sim-waypoints.test.ts`.
