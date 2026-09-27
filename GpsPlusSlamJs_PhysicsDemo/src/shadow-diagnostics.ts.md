# shadow-diagnostics.ts - the shadow's state on the diagnostics line, and the first-visit rebuild

- Purpose: owner report on r753 (2026-09-27): on a preview's FIRST visit (a
  new origin, so Chrome's camera/AR permission prompt) the balls rest on the
  mesh but cast no shadow until the Mesh dropdown is switched and back, which
  recreates the occluder and so its shadow receiver. The cause is not known
  and shows only on the phone; no test reproduces it. This module reads what
  the receiver's program was compiled with, counts the session's and the
  page's visibility changes, and drives a one-time rebuild of the occluder
  the way the Mesh dropdown does, so a screenshot of the diagnostics line
  shows the state before and after.
- Public API:
  - `RECEIVER_NODE`: the framework's receiver node name
    (`occupancy-occluder-shadow-receiver`).
  - `programFlags(gl, program)`: `{ shadowMap, normals, dirShadows }` from
    the GL program's attached shader sources, or null without a program or
    without source. `USE_SHADOWMAP` and `HAS_NORMAL` are `#define`s in
    three's prefix; the directional-shadow count is substituted into the
    shader body (`replaceLightNums`), so it is read from the size of the
    `directionalShadowMap` / `directionalShadowMatrix` arrays.
    `flagsText` prints "S1N0D1" (or "none" for null).
  - `createReceiverFlagsReader(renderer, root)`: the receiver's flags now:
    "off" when no receiver is attached, "none" before it is compiled,
    "unreadable" when a program exists but its sources came back empty, else
    the flags of `renderer.properties.get(material).currentProgram`. The
    sources are re-read only when the program object changes.
  - `rebuildEnabledFromSearch(search)`: false for `?rebuild=0` / `off` /
    `false` (the owner's A/B), true otherwise.
  - `createFirstVisitRebuild({ enabled, rebuild, meshTris, readFlags,
mapAllocated, balls, now, startedAtMs })`: `tick(visibilityState)` once
    per XR frame, before the shadows' update. The rebuild fires once, on the
    first tick where the symptom's preconditions hold: enabled, the session
    `visible`, the mesh has triangles, a receiver is attached (`readFlags()`
    is not "off", so never with shadows off), the shadow map is allocated,
    and a ball exists or `REBUILD_GRACE_MS` (2 s) passed since the first
    triangles. It records the flags before, then the new receiver's flags
    once it has a program (or what it reads after 120 frames). `text()`:
    "off", "pending" or "3.2 s S0N0D1>S1N1D1" (seconds since the session
    started), shown after "rebuild "; `rebuilt()`.
  - `createVisibilityCounter(initial)`: `observe(state)` from events (the XR
    session's `visibilitychange`, the page's `document.visibilitychange`)
    and per frame; counts entries into `visible-blurred` and `hidden`.
    Events are what see a prompt that comes and goes between two frames.
  - `createEvery(intervalMs)`: true at most once per interval (the
    diagnostics line's 4 Hz).
- Invariants: the rebuild runs at most once per session, never while the
  session is `hidden` or `visible-blurred`, never before the mesh, a
  receiver and an allocated map exist. Reading the shader sources is a
  diagnostic cost paid once per program.
- The rebuild's cost: one visible hitch, once. It disposes the occluder (the
  receiver material with it, so three releases that material's program and,
  with no other user, deletes it), builds a new occluder, re-meshes the whole
  grid at once, and the new receiver material links a fresh program on its
  next draw. On a large room that is one long frame.
- Tests: `shadow-diagnostics.test.ts` (flags from sources in three's real
  shape, absent defines and no program, the reader's lookup, cache and
  "unreadable", the rebuild's preconditions and grace time, once-only,
  the before/after record, the give-up path, `?rebuild=0`, the visibility
  counter, the rate). The wiring: `ar-mode.test.ts`; the real flags in a
  real renderer: `playwright-tests/replay-shadows.spec.js` (first-load cases
  read "rx S1N?D1" from the diagnostics line). No test reproduces the
  owner's bug; the replay's first load is healthy.
- Record: `GpsPlusSlamJs_Docs/docs/2026-09-27-1558-ar-shadows-first-visit-findings.md`
  (primary repo).
