# ball-status.ts - the balls' state for the status line

- Purpose: owner feedback round 2 (plan 2026-09-26-2055, M1). The owner saw
  no shadow on the phone, and the desktop replay cannot tell which of the
  remaining causes it was: the stats line now says, on the phone, how many
  balls came to rest (a resting ball is where a shadow is seen) and how
  many fell through the reconstructed floor (on the replay fixture's sparse
  room they do). One format for AR and the replay.
- Public API:
  - `createBallStatus()` returns `{ update(balls, viewerY) }` giving
    `{ balls, resting, fellThrough, inRange }` per physics step (a fixed
    1/60 s, so frame-rate independent): resting is a ball that moved less
    than `RESTING_MOVE_M` (2 mm) in each of the last `STILL_STEPS` (30)
    steps (one still step is only a bounce's apex); fell through is a ball
    more than `FELL_THROUGH_BELOW_VIEWER_M` (3 m) below the viewer; in range
    counts the optional predicate (the shadow's reach). When the number of
    balls changes every stillness count starts over; a despawn and a spawn
    in the same step keep the number, so a pair can be wrong for one step
    (at worst half a second more before "resting").
    - Limit: a ball that fell onto a stray facet less than 3 m under the
      floor still reads "resting", where no shadow is seen.
  - `ballStatusText(status)`: "balls 3 (2 resting, 1 fell through, 2 in
    shadow range)", only the counts that are there.
  - `statsText(status, colliderTris, shadowsNote)`: the whole stats line,
    "balls N (...) · collider N tris · shadows on"; the e2e reads
    "balls N " and "collider N tris" from it.
  - `diagnosticsText({ depthSamples, depthAgeMs, meshTris, colliderAgeMs,
start? })`: appended to that line in AR and the replay (owner first-load
    report on r752, 2026-09-27: shadows missing only on a page's first load,
    no cause found in the code), " · depth 12 (0.2 s ago) · mesh 950 tris ·
    collider 0.3 s old · start: physics 0.8 s, AR 2.3 s"; "depth 0" and
    "collider not built" before the first sample or build; `start` (AR only)
    is the tap-to-physics-ready and tap-to-AR-running time. One screenshot
    shows which link from the depth stream to a resting ball was missing.
    Round 4 (first-visit report on r753): optional `shadow` (" · rx S1N1D1 ·
    sun cast, map 1024, renders 3": the receiver's program flags from
    `shadow-diagnostics.ts`, the light, its map and the rig's renders) and,
    in AR, `xr` (" · xr visible (first 1.3 s) · rx rebuilt 3.2 s
    S0N0D1>S1N1D1": the session's visibility, the time to its first visible
    frame, and the one-shot receiver rebuild's note).
- Tests: `ball-status.test.ts` (resting only after STILL_STEPS still
  steps and ended by a move, the range predicate, fell through below the
  viewer, a changed set resets, the text) and `.property.test.ts` (over any
  sequence of frames: the counts never contradict each other or exceed the
  balls).
