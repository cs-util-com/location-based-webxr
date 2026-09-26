# shadow-probe.ts - the shadow pixel probe's test hook

- Purpose: owner feedback round 2 (plan 2026-09-26-2055, M1). The owner saw
  no shadow on the phone while the replay e2e passed, because that e2e
  checked only the stats line's "shadows on" (the rule is active), never a
  shadow pixel. With `?shadowProbe=1`, the desktop replay exposes
  `window.__physicsShadowProbe`, so `playwright-tests/replay-shadows.spec.js`
  can rest a ball on the reconstructed floor and count the pixels its
  shadow darkens. The AR path runs the same wiring (`startDemoShadows`, the
  same light, receiver and balls), so a shadow too small here is too small
  on the phone.
- Public API:
  - `createShadowProbe(deps)` returns `{ pause, dropOnFloor(flat?),
standAt(azimuthDeg), viewCamera(), atRest(), ballScreen(),
setShadowsEnabled(on), readRegion(x, y, w, h) }`:
    - `dropOnFloor`: a 15 x 15 grid of downward rays over the room's mesh;
      of the FIRST surfaces they meet, the lowest that faces up (world
      normal y at least 0.7) and has floor all around it (eight rays on a
      ring of `ringM`, default 0.15 m, meet an upward first surface within
      `toleranceM`, default 2 cm); spawns a ball 0.3 m above it with no
      velocity and stands the view at azimuth 0; the hit, or null. First
      surfaces only, because a reconstructed room has stray facets under its
      floor; the flat ring, because a ball on a small patch rolled off into
      a hole (both measured on the replay fixture). The ring and tolerance
      were swept (0.1-0.25 m, 2-8 cm): on the fixture's blocky floor only
      0.15 m / 2 cm found a point the ball stayed on.
    - `standAt(azimuthDeg, backM = 1.2)`: a standing phone user's view of
      the ball, 1.5 m above the floor and `backM` away at the azimuth
      (0 = +x); `viewCamera` is it (or
      null before a drop). The replay wires it as the camera the shadow
      square follows, as AR does with the phone (the replay's own camera
      hangs about 200 m over the room);
    - `atRest`: true once the last ball stayed within 0.5 mm for 1 s;
    - `ballScreen`: the last ball's centre and radius in the standing view,
      in drawing-buffer pixels (top-left origin);
    - `setShadowsEnabled`: the demo's switch (`DemoShadows.setEnabled`);
    - `readRegion`: renders one frame through the standing view and
      returns that rect's RGBA bytes, read in the same task as the render.
  - `installShadowProbe(target, probe)` puts it on the window; the returned
    function removes it (only if it is still this probe).
  - `restTracker(now)` and `REST_MS` (the rest rule, 0.5 mm over 1 s).
- Invariants: installed only with `?shadowProbe=1` (`main.ts`), never in
  normal use; it adds no per-frame work.
- Tests: `shadow-probe.test.ts` (the rest rule; the floor under a table
  top, never a wall; not a narrow strip seen through a gap; the standing
  view from four sides with the ball at the centre; the deps wiring;
  install/remove); the pixel read: `replay-shadows.spec.js` (measured
  2026-09-26 at the demo's 63.4° light on the blocky floor, lower middle of
  four sides: 717 darkened pixels at 1.2 m, 221 at 2.5 m, 82 at 4 m, the
  ball's own disc about 2,260 / 950 / 440; so a resting ball's shadow is
  visible from a standing view on THAT floor, small at 4 m; the "Off" skin
  cannot be measured in the replay, where there is no camera feed behind).
