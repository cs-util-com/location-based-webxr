# `ar-parent-target.ts`

## Purpose

The target transform T of an AR world group (odometry NUE to GPS-world
NUE), read from the store once for everything that needs it: the binding that
sets the group to T, and the deferred anchors that re-place their content
to T^-1. Composing T in one place keeps the two from disagreeing; if they
did, content would carry part of the alignment twice. It also answers the
anchors' other session questions, and holds the registry of alignment
bindings per group.

Internal: no package entry. Reached through `enableArWorldGroupAlignment`
(which creates the target and registers the binding) and
`deferred-anchors.ts` (which looks the binding up).

## Public API

- `createArParentTarget(store, { devJump? }): ArParentTarget`
  - `target()`: T as a `Matrix4` (identity before the first alignment; do
    not mutate). A null or non-finite store alignment is ignored and the
    last T kept.
  - `version()`: increases whenever `target()` changes.
  - `frameEpoch()`: `state.qrDetected.frameEpoch`, read structurally; 0
    without the slice or for a non-number.
  - `isMature()`: `isMatureAlignment` over the session's GPS extent of
    device fixes only (synthetic code votes span tens of metres per lock and
    would end the follow phase early); sticky once true, through a data
    reset too.
  - `sessionElapsedS(elapsedS)`: seconds since the first `tick`; 0 for a
    non-finite input.
  - `tick(elapsedS)`: starts the session clock on its first call and
    advances the dev jump clock. Non-finite input is ignored.
  - `dispose()`: stops listening to the store.
  - `RangeError` for a dev jump with a non-finite value or a non-positive
    period; a zero jump (0 m, 0 degrees) is ignored.
- Development-only synthetic world jump
  - `parseDevWorldJump(search)`: `?devWorldJumpM=<m>` and/or
    `?devWorldJumpDeg=<deg>` to `{ metres, degrees, periodS: 10 }`, or null.
  - `devWorldJumpFromPage()`: reads `location.search` only under
    `import.meta.env.DEV`; a production build folds the reader away.
  - The jump (north by `metres`, a yaw by `degrees`) is composed on top of
    the alignment as `Tr(n * metres) x RotY(n * degrees) x alignment` after
    the n-th period (the first lands one period after the first tick), so a
    tester can watch anchored content hold through a world jump. The jump
    lands in one frame, as every change of T does
    (`ar-world-group-alignment.ts.md`).
  - `DEV_WORLD_JUMP_PERIOD_S = 10`.
- Binding registry
  - `ArParentBinding { group, target, step, attachPass, onDispose }`.
  - `registerArParentBinding(binding)`: one per group, a newer one
    replaces; the returned function removes only its own.
  - `getArParentBinding(group)`: the binding, or null.

## Invariants

- One T per group: the binding and every deferred anchor under the group read
  the same matrix, the dev jump included.
- The store is only read (selectors and `subscribe`), never dispatched to.

## Tests

- `ar-parent-target.test.ts`: T follows the store, bad matrices ignored, the
  epoch read, maturity from device fixes only and sticky, the session clock,
  the dev jump composition and its refusals, the page reader, the registry.
- `ar-parent-target.build.test.ts`: bundles the alignment module the way an
  app's production build sees it and asserts the dev jump reader is gone
  (with the development build as the control).
