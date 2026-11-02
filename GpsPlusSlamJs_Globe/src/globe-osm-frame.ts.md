# globe-osm-frame.ts - the OSM map's per-frame step

- Purpose: attach, switch, fade and pose the OSM overlay each frame (G1 6),
  moved out of the globe lab.
- Public API: `createOsmFrameStep({ osm, terrain, ellipsoid, group, camera,
onAttach? })` returns `step(nowMs, { on, fadeM, groundUnderCameraM,
bandShare })` with `step.attached()` and `step.pose()`.
  - Nothing happens before the map is first on; then the overlay is attached
    once (`osm.attach(terrain)`, then `onAttach`, the page's credit line) and
    from then on set enabled, faded and updated every frame, off included.
  - The pose: `aboveGroundM` is the camera's height over the drawn ground,
    NaN when the relief has no pixels or no ground under the camera;
    `speedMps` is measured in the globe's frame (the world is recentred
    under the camera), 0 on the first frame, the time step floored at 1 ms.
  - `pose()` is the last `{ aboveGroundM, speedMps }`, null before.
- Tests: `globe-osm-frame.test.ts` (attach once and the call order, NaN
  heights, the speed in the Earth's frame).
