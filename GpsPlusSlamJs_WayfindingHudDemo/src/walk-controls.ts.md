# walk-controls.ts

- **Purpose:** pure keyboard walk model for the desktop simulator — key-state tracking plus ground-plane movement math. Ported from the frozen Prototype-1 loop with one deliberate fix: steps are dt-scaled (m/s), not per-frame.
- **Public API:**
  - `directionForKey(key)` — maps `w/a/s/d` (either case) + arrow keys to `MoveDirection`, else null.
  - `createKeyState()` — `{ active, keyDown, keyUp, clear }`; `clear()` exists so window blur never leaves a key stuck.
  - `computeMoveStep(active, cameraQuaternion, dt, speedMps = WALK_SPEED_MPS)` — displacement for one frame.
  - `WALK_SPEED_MPS` (4).
- **Invariants:** movement stays on the ground plane at full speed regardless of camera pitch (vertical component removed, then normalized); diagonals are not faster; opposing keys cancel; a degenerate axis (looking straight down) zeroes only that axis's contribution; `dt ≤ 0`/non-finite → zero step.
- **Tests:** `walk-controls.test.ts` (mapping, dt-scaling/frame-rate independence, diagonal normalization, pitch projection, degenerate cases, default speed).
