# labs/globe/globe-lab.js - the globe lab

- Purpose: globe plan 2026-09-26-0539 §7, M0. The globe package's surface
  (`/globe/globe-surface.js`), served no-build: an untextured Earth lit by
  one sun, seen from 3.4 Earth radii. M1-M4 add the imagery, the credits,
  the target and the turn.
- Test API, `window.__globeLab`: `ready`, `error`, `state()` (`{ models,
tileErrors, radiusM }`), `readPixels(points)` (normalised canvas points,
  read in the same task as a render).
- Invariants & assumptions: the page's import map maps `three` to the
  framework's copy and `3d-tiles-renderer` (and `/plugins`) to the vendored
  library; nothing leaves the machine.
- Tests: `globe.smoke.spec.mjs` (boots, lit centre, black corners, no tile
  error, no request off 127.0.0.1, no console or page error).
