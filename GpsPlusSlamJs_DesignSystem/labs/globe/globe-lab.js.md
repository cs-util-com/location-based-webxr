# labs/globe/globe-lab.js - the globe lab

- Purpose: globe plan 2026-09-26-0539 §7, M0-M1. The globe package's
  surface (`/globe/globe-surface.js`), served no-build: the Earth textured
  from the committed Blue Marble pyramid, lit by one sun, seen from 3.4
  Earth radii over 30°N 15°E with north up, and a credits line (the short
  names, the full texts and GIBS's acknowledgement in a `<details>`, built
  with `textContent` only). M2-M4 add the target, the turn and the real sun.
- Test API, `window.__globeLab`: `ready`, `error`, `view`, `state()`
  (`{ models, tileErrors, radiusM, activeSources, creditShorts }`),
  `readPixels(points)` (normalised canvas points, read in the same task as a
  render).
- Invariants & assumptions: the page's import map maps `three` to the
  framework's copy and `3d-tiles-renderer` (and `/plugins`) to the vendored
  library; nothing leaves the machine.
- Tests: `globe.smoke.spec.mjs` (boots, lit centre, black corners,
  textured: the luminance spread around the centre, every credit named, no
  tile error, no request off 127.0.0.1, no console or page error).
