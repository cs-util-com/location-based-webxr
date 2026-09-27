# shadow-diagnostics.ts - the shadow's state on the status line, and the first-visit rebuild

- Purpose: owner report on r753 (2026-09-27): on a preview's FIRST visit (a
  new origin, so Chrome's camera/AR permission prompt) the balls rest on the
  mesh but cast no shadow until the Mesh dropdown is switched and back, which
  recreates the occluder and so its shadow receiver. The cause is not known
  and shows only on the phone. This module reads what the receiver's program
  was compiled with, and drives a one-shot rebuild of the occluder the way
  the Mesh dropdown does, so a screenshot of the status line shows the state
  before and after.
- Public API:
  - `RECEIVER_NODE`: the framework's receiver node name
    (`occupancy-occluder-shadow-receiver`).
  - `programFlags(gl, program)`: `{ shadowMap, normals, dirShadows }` from
    the GL program's attached shader sources (three prefixes them with its
    `#define`s `USE_SHADOWMAP` and `HAS_NORMAL`; the directional-shadow count
    is substituted into the body, so it is read from the `directionalShadow
Map`/`Matrix` array size), or
    null without a program or source. `flagsText` prints "S1N0D1" or "none".
  - `createReceiverFlagsReader(renderer, root)`: a function giving the
    receiver's flags now: "off" when no receiver is attached, "none" before
    it is compiled, else the flags of `renderer.properties.get(material)
.currentProgram`. It re-reads the sources only when the program object
    changes (the status line updates every frame).
  - `createFirstVisitRebuild({ rebuild, meshTris, readFlags, now,
startedAtMs })`: `tick(visibilityState)` once per XR frame; on the first
    tick where the state is `visible` AND the mesh has triangles, it reads
    the flags, calls `rebuild` once, and then records the flags of the new
    receiver once it has a program (or whatever it reads after 120 frames).
    `text()`: "rebuild pending" or "rebuilt 3.2 s S0N0D1>S1N1D1" (seconds
    since the session started); `rebuilt()`.
- Invariants: the rebuild runs at most once per session; never while the
  session is `hidden` or `visible-blurred` (the permission prompt's
  states), never before the mesh has triangles. Reading the shader sources
  is a diagnostic cost paid once per program.
- Tests: `shadow-diagnostics.test.ts` (flags from stub shader sources,
  absent defines and no program, the reader's receiver lookup and cache, the
  rebuild's conditions, its once-only rule, the before/after record and the
  give-up path). The wiring: `ar-mode.test.ts` (rebuild once, only when
  visible with a mesh, before the shadows' update); the real flags in a real
  renderer: `playwright-tests/replay-shadows.spec.js` (first-load cases read
  "rx S1N?D1" from the status line).
- Record: `GpsPlusSlamJs_Docs/docs/2026-09-27-*-ar-shadows-first-visit-findings.md`
  (primary repo).
