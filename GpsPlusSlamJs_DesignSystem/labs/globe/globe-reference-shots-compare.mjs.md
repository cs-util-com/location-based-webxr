# globe-reference-shots-compare.mjs

- Purpose: puts two captures of the globe's reference views side by side,
  for a refactor that must leave the globe looking the same (the view-core
  move, [the full-globe editor plan](../../../GpsPlusSlamJs_Docs/docs/2026-10-27-1850-editor-on-the-full-globe-plan.md)).
  The captures come from `globe-reference-shots.smoke.spec.mjs`: the owner's
  reference link (`at=46.948,7.4474&land=1&flight=2&osm=1&eye=1&dust=1&time=2026-10-05T11:00:00Z`)
  with the time pinned, every view a held camera, and every network answer
  local (synthetic heights, an empty city, a numbered OSM test pattern),
  at six views: space, space looking at the sky, the approach (300 km),
  above the clouds (30 km), below the clouds (1.5 km over the ground) and
  street level (2 m), plus `views.json` with each view's credits, tile
  counts and near plane. Every request to a host other than the dev
  server fails the capture. A second test runs on Playwright's clock: the
  approach view with the clouds' default drift (`7-drift.png`, after 5 s
  of 16 ms frames from a paused instant) and `trace.json`, the intro
  flight's first 240 frames stepped one at a time from that instant (per
  frame the camera's distance, direction and forward, the clouds' offset
  uniform, the world frame's target and the speed dust's state).
- Use:

  ```sh
  GLOBE_SHOTS_DIR=C:/gps/shots/before node scripts/test-timing/machine-slot.mjs run -- pnpm --dir GpsPlusSlamJs_DesignSystem run test:e2e labs/globe/globe-reference-shots.smoke.spec.mjs
  # ...the change, then the same with .../after...
  node GpsPlusSlamJs_DesignSystem/labs/globe/globe-reference-shots-compare.mjs C:/gps/shots/before C:/gps/shots/after C:/gps/shots/diff
  ```

  Keep the images out of git (they are about 1-2 MB a view).

- Public API: `diffRgba(a, b, { thresholds, gain })` for two RGBA buffers of
  one size: `max` (the largest channel difference anywhere), `shares` (the
  share of pixels whose largest colour channel differs by more than each
  threshold, default 0, 1, 4, 16 and 48 levels; alpha ignored) and `image`
  (the difference amplified `gain` times as opaque grey). RangeError for
  buffers of different or non-RGBA sizes. Run as a script with
  `<before> <after> <out>`: writes `<view>-pair.png` (before, after, the
  difference) and prints a line per view and every `views.json` fact that
  differs. Exit 1 when a view is missing or the sizes differ, 2 for a wrong
  call; a pixel difference is reported, never judged. The views compared
  are the fixed `VIEW_NAMES` (the seven the capture writes), not the
  files a folder happens to hold, so a view missing on either side fails.
  `diffTrace(a, b)`: null for equal traces, `{ lengths }` for different
  lengths (exit 1), else `{ fields }` with each differing field's first
  frame and largest numeric difference (null when not numeric), printed
  per field; a missing `trace.json` exits 1. Before the comparison
  `dropRepeatedFrames(trace)` removes each frame equal in every field to
  the one before it (a frame drawn without the clock moving; their number
  depends on scheduling), and the script prints how many it dropped.
- Invariants: the verdict (invisible noise or a visible change) is the
  reader's, with the pair image in front of them; the script only measures.
- Tests: `globe-reference-shots-compare.test.mjs` (the counting per channel,
  the strict thresholds including `>0`, alpha ignored, the amplified
  image, the size check; the trace difference; `main` failing on a view
  missing from the before side).
