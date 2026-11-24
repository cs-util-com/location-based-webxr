# `ar-parent-target.ts`

## Purpose

The target transform T of an AR world group (odometry NUE to GPS-world
NUE), read from the store once for everything that needs it: the binding that
sets the group to T, and the deferred anchors that re-place their content
to T^-1. Composing T in one place keeps the two from disagreeing; if they
did, content would carry part of the alignment twice. It also answers the
anchors' other session questions, and holds the registry of alignment
bindings per group.

A package entry (`gps-plus-slam-app-framework/ar/ar-parent-target`) for its
parsers and types, which an app uses to offer the switches behind its own
debug flag (the Tour Viewer's `anchor-test-switches.ts`). The target itself
is reached through `enableArWorldGroupAlignment` (which creates it and
registers the binding) and `deferred-anchors.ts` (which looks the binding
up).

## Public API

- `createArParentTarget(store, { devJump?, deferAnchors? }): ArParentTarget`
  - `defersAnchors()`: false for `deferAnchors: false`; the anchors
    under this target then follow every change of T at once. For
    `deferAnchors: 'ab'` it alternates by the session clock: true for the
    first `ANCHOR_DEFERRAL_AB_PERIOD_S` (15 s) after the first `tick`,
    false for the next, and so on, so one session measures the frame time
    with the deferral on and off. `RangeError` for any other value.
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
    Each is clamped to 100 m and 180 deg either way: the address is
    untrusted, and a huge jump would turn the transform to NaN.
  - `devWorldJumpFromPage()`: reads `location.search` only under
    `import.meta.env.DEV`; a production build folds the reader away.
  - The jump (north by `metres`, a yaw by `degrees`) is composed on top of
    the alignment as `Tr(n * metres) x RotY(n * degrees) x alignment` after
    the n-th period (the first lands one period after the first tick), so a
    tester can watch anchored content hold through a world jump. The jump
    lands in one frame, as every change of T does
    (`ar-world-group-alignment.ts.md`).
  - `DEV_WORLD_JUMP_PERIOD_S = 10`.
- Anchor deferral switch (`AnchorDeferral = boolean | 'ab'`)
  - `parseAnchorDeferral(search)`: false for `anchors=0` (trimmed),
    `'ab'` for `anchors=ab` (any case); any other value, or none, keeps
    the deferral on.
  - `anchorDeferralFromPage()`: reads `location.search` only under
    `import.meta.env.DEV`, else true; a production build folds the reader
    away. For a frame-time comparison with the deferral on and off.
- Apps that want the switches in a production build read the address
  themselves with the two parsers and pass `devJump` / `deferAnchors` to
  `enableArWorldGroupAlignment` (the Tour Viewer does, behind
  `?debug=1`); the parsers are a dist entry for that.
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
  the dev jump composition and its refusals, the page readers (dev jump
  and deferral switch, `anchors=ab` included, the jump clamped), `defersAnchors()` and its
  A/B alternation at the period edges, the registry.
- `ar-parent-target.build.test.ts`: bundles the alignment module the way an
  app's production build sees it and asserts the dev jump reader and the
  `anchors` switch are gone
  (with the development build as the control).
