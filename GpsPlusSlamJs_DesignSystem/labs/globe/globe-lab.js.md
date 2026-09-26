# labs/globe/globe-lab.js - the globe lab

- Purpose: globe plan 2026-09-26-0539 §7, M0-M3. The globe package's
  surface (`/globe/globe-surface.js`), served no-build: the Earth textured
  from the committed Blue Marble pyramid, lit by the real sun, with night
  lights, a water glint and clouds, and a credits line (the short names, the full texts and GIBS's acknowledgement in a
  `<details>`, built with `textContent` only). A loading label ("Loading
  Earth imagery: n of m") shows while tiles are pending, and the error box
  names tiles that could not load ("a coarser level shows there") and global
  maps that could not load. The label counts the three global maps too, so
  it ends only when the clouds (the largest file) have arrived. M4 adds the
  tunables panel.
- The light (M3): `solarPosition(time, 0, 0)` from `/fw/geo/solar-position.js`
  through `sunDirectionEcef` into `globe.setSun`, every frame, for
  `#time=<ISO>` or now; intensity π, Neutral tone mapping, no ambient
  light, a black sky (plan §7.3). The surface's tuning comes from the hash:
  `nightGain` (0-100), `waterRoughness` and `cloudOpacity` (0-1);
  anything else keeps the default.
- The intro (M2, `/globe/globe-target.js`, `/globe/globe-camera.js`):
  - `spin`: from 30°N 15°E, the view's longitude falling 3°/s, so the
    surface moves west to east across the screen as the Earth turns;
  - `turning`: once `chooseGlobeTarget` has a target, the turn from the
    spin's pose to the target's, eased by `smoothstep` over `turnMs`;
  - `arrived`: the target held at the centre, north up.
  - fovY 50°, the disc filling 90 % of the narrower side
    (`orbitDistanceToFit`, re-fitted whenever the width or the height
    changes), the setting the z0-z3 imagery was sized for.
  - Hash parameters: `#at=<lat>,<lng>` (the target; absent or malformed
    means none), `spinMs` (the wait for a fix before the Central Park
    fallback, default 3000) and `turnMs` (default 5000). A hash change and
    the "Replay the turn" button start the sequence again, from the spin's
    start (a hash edit mid-turn therefore jumps back; fine for a lab).
  - Phase 1 has no GPS (DEC-PRG-10): the fix is always null. The target is
    chosen only while spinning, so a fix arriving after the fallback would
    be ignored; phase 6 (the real locate timeout) has to decide that.
- Test API, `window.__globeLab`: `ready`, `error`, `spinStart`, `state()`
  (`{ models, tileErrors, cachedBytes, pendingTiles, loadedTiles, phase,
target, source, history, runs, spinMs, turnMs, centreLatLon, timeMs,
sunEcef, tuning, radiusM, activeSources, loadingShown, loadingVisible,
cacheBudgetBytes, creditShorts, mapsLoaded, mapErrors, mapsTotal }`), `project(lat, lng)` (a
  place's normalised canvas point, for probes at known places),
  `readPixels(points)` (normalised canvas points, read in the same task as
  a render).
  - `history` lists `{ phase, source, atMs }` per change since the start,
    and `runs` counts the starts, so a test reads a sequence instead of
    racing it.
  - `centreLatLon` is found through the library's frame: a ray against the
    drawn tiles, the hit converted by the tiles' ellipsoid. The ray is aimed
    1e-5 of the half-frame off both axes (about 50 m, 0.0008° on the
    ground): observed 2026-09-26, a ray crossing a tile edge of constant
    latitude exactly found no tile, or at a tile corner the far side of the
    Earth (the cause, shared vertices or three's triangle test, is not
    established). A hit beyond the Earth's centre reads as null.
- Invariants & assumptions: the page's import map maps `three` to the
  framework's copy and `3d-tiles-renderer` (and `/plugins`) to the vendored
  library; nothing leaves the machine. The sun is real, so a view can be on
  the night side: the tests pin `#time=`.
- Tests: `globe.smoke.spec.mjs`:
  - on a fixed view (`#at=30,15&spinMs=0&turnMs=0`, 11:00 UTC on an
    equinox so it is day): boots, lit centre,
    black corners, textured (the luminance spread around the centre), every
    credit named, the loading label shown then gone, the cache within its
    budget, no tile error, no request off 127.0.0.1, no console or page
    error; and with every level 2-3 tile answering 404, no hole (no probe
    showing the black sky exactly; the parent drawn), the error box, and no
    error but the library's own per-tile lines;
  - the centre within 0.01° of the target after arriving (the visual
    requirement is 0.25°; 0.01° also catches a geodetic-normal camera), for
    Cologne, Tokyo, (0, 179.9), (80, -40) and the spin start's antipode (the
    longest turn; not the exact-antipode branch, which the unit tests
    cover), reported across {0.01, 0.1, 0.25, 0.5}°;
  - with no `#at`: `waiting`, then `fallback` no earlier than `spinMs`,
    arriving at Central Park; the replay button runs it again;
  - (M3, equinox noon) the day side lit at the subsolar point (dark at
    midnight), night lights over Tokyo (none with `nightGain=0`), and the
    glint at the specular point with the clouds off (gone with
    `waterRoughness=1`): each check also run with its term off, where it
    must fail; floors reported across ±50 %;
  - (M3) no night lights on the day side (Tokyo at noon local, the same
    with `nightGain=0`), and the sun over 91.86°E at 06:00 UTC (the whole
    solarPosition chain, not mirrored);
  - no seam at 180° (the view 1 px west of 180°, at 179.894°, so a pixel
    quad straddles the line, asserted per row; per row, the jump across 180°
    against the largest ordinary jump: 0.67x with the fix, 4.02x without);
  - a global map answering 404: the error box says so, the loading label
    ends, the globe still draws, no page error.
