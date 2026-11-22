# `ar-world-group-alignment.ts` — framework-default alignment for `arWorldGroup`

- **Purpose:** wire the store's alignment matrix to `arWorldGroup.matrix` in
  a single call, so the AR view (camera + every GPS anchor under
  `arWorldGroup`) is GPS-registered without each app re-deriving the store
  read + frame-loop plumbing by hand.

- **Public API:**
  - `enableArWorldGroupAlignment(options) → ArWorldGroupAlignmentHandle`
    - `options.store: SubscribableStore` — read via `selectAlignmentMatrix`.
    - `options.arWorldGroup: THREE.Object3D`: the node whose `.matrix` is set
      to each alignment.
    - Returns a handle with `dispose()` that removes the store subscription
      and the per-frame update.
    - **Disposal is automatic on session teardown.** The binding registers
      itself with the session-disposer registry (`ar/session-disposers.ts`) that
      `resetWebXRState()` flushes, so a caller can enable it once and never hold
      the handle — it cannot outlive its session. (Before this, the store
      subscription leaked across sessions: `clearFrameUpdates()` drops the
      per-frame tick but not the subscription, and two example apps independently
      grew bespoke per-app disposal bookkeeping to compensate.) The handle is
      still returned for stopping alignment mid-session, and is idempotent +
      self-deregistering so the manual `dispose()` and the teardown flush never
      double-run.

- **The parent binding (deferred anchors):** T is composed once, in
  `ar/ar-parent-target.ts` (the store alignment plus, in development builds
  only, the `?devWorldJumpM` / `?devWorldJumpDeg` synthetic jump), and the
  helper registers a binding for the group (`registerArParentBinding`). The
  binding and the deferred anchors under the group (`ar/deferred-anchors.ts`)
  both read that one T, so content never carries the alignment twice. The
  group's anchor set runs its pass inside this helper's frame update, right
  after the alignment step, so it reads the frame's matrix. `dispose()`
  unregisters the binding, disposes the target and tells the binding's
  dispose listeners (the anchor set then ticks itself).

- **Invariants & assumptions:**
  - **Every change lands at once.** T is read once per frame (by the
    target's version), in the frame step, and copied exactly into
    `arWorldGroup.matrix` (`matrixAutoUpdate = false`, subtree refreshed),
    whatever its size, its rotation or the frame epoch. The framework always
    shows the newest alignment and never slides the world through the poses
    in between; an app that wants smoothing adds it above this layer. The dev
    jump is a T change like any other.
  - An alignment already present at enable time lands on the first frame.
  - `null` (or non-finite) alignment is ignored (no spurious identity target).
  - **Single-driver rule:** the helper owns `arWorldGroup.matrix`. Do
    **not** call it for a group that another driver already writes (the
    recorder drives its own lerper).

- **Examples:**

  ```ts
  const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
  // …per-frame, the framework frame loop now sets arWorldGroup.matrix.
  handle.dispose(); // on teardown
  ```

- **Tests:** `ar-world-group-alignment.test.ts` covers: adopt-at-enable, null
  ignored, every change exact in its frame (the first one, a 1 cm step, a
  0.1 degree yaw, a large step and yaw, a 30 degree yaw, each change of a
  noisy 1 Hz series, around an epoch change), dispose-stops-updates, and the
  session-lifecycle disposal (auto-dispose when `runSessionDisposers()` flushes,
  `dispose()`-after-flush is an idempotent no-op, and a manual `dispose()`
  deregisters so the later flush is a no-op). Driven with the real `frame-loop`
  (`runFrameUpdates`) + `session-disposers` (`runSessionDisposers`) + a minimal
  fake `SubscribableStore`. The parent binding: registered with the applied
  target, pass after the alignment step (it sees the new T), unregistered on
  dispose with its listeners told.

- **Related:** `alignment-lerper.ts` (a smoothing primitive for apps that
  drive their own group; not used here),
  `ar/session-disposers.ts` (the teardown registry this binds to),
  `gps-anchor.ts` (anchors ride this alignment), the plan at
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-0650-gps-anchor-frame-architecture-bug-and-plan.md`
  (Slice 2 / Bug A), and the disposal plan at
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-2149-arworldgroup-alignment-session-scoped-disposal.md`.
