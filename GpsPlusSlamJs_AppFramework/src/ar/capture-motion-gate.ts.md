# `capture-motion-gate.ts`

- **Purpose:** the policy that decides whether a _due_ image capture fires on
  the current frame or is deferred until device motion settles, so that
  motion-blurred frames are skipped.

- **Public API:**
  - `decideCapture(input): 'capture' | 'defer'` — stateless decision over
    `{ windowMaxAngular, windowMaxLinear, maxAngularVelocity, maxLinearVelocity, msSinceDue, maxWaitMs }`.
    Returns `'capture'` when both windowed maxima are at/below their
    thresholds (calm), OR when `msSinceDue >= maxWaitMs` (never-calm safety
    fallback). Otherwise `'defer'`.
  - `class MotionWindow(size?, angularGlitchCeiling?, linearGlitchCeiling?)` —
    fixed-size ring of recent valid velocity pairs.
    - `push(angularVel, linearVel): boolean` — records a sample; returns
      `false` and stores nothing if it exceeds a glitch ceiling or is
      non-finite.
    - `maxAngular()` / `maxLinear()` — max over the window, or `Infinity` when
      empty (so "no data" reads as not-calm).
    - `reset()` — clear (on tracking loss / capture restart).
  - Exported constant: `DEFAULT_MOTION_WINDOW_SIZE` (3).
  - `MotionFilterConfig` / `DEFAULT_MOTION_FILTER` — the user-facing config the
    gate consumes, shared with `ImageCaptureConfig.motionFilter`.
  - `MOTION_FILTER_CONSTRAINTS` — `{min, max, step}` per threshold: the bounds
    outside which the gate stops being a gate (below ~0.05 it rejects
    everything, above ~5 rad/s ≈ 286°/s or 5 m/s it never rejects), plus the
    granularity a settings slider should use.
  - `validateMotionFilterConfig(options): MotionFilterConfig` — normalizes an
    UNTRUSTED persisted config: `enabled` boolean-or-default, thresholds
    clamped to `MOTION_FILTER_CONSTRAINTS` with non-finite values falling back
    to the default, nullish/missing group default-fills entirely.
  - Module-internal tuning constants (NOT exported): angular glitch ceiling
    (50 rad/s) and linear glitch ceiling (20 m/s), overridable per-instance via
    the `MotionWindow` constructor.

- **Invariants & assumptions:**
  - **Empty window ⇒ `Infinity` ⇒ not calm.** No capture can fire before at
    least one valid sample exists (except via the `maxWaitMs` fallback).
  - **Glitch rejection never pollutes the window.** A relocalization spike is
    dropped, so it cannot force a spurious defer; the manager additionally
    refuses to capture _on_ a glitch frame (see `image-capture.ts`).
  - The gate **only ever delays** a capture; it never advances one.
  - Window size + glitch ceilings are internal constants, not user config — the
    user surface is only `enabled`/`maxAngular`/`maxLinear`/`maxWaitMs`.
  - **This module owns its config's bounds** (2026-07-27): a consumer app that
    persists a `MotionFilterConfig` calls `validateMotionFilterConfig` rather
    than restating the ranges. The recorder's settings catalog used to carry
    its own copy of this table; that is what drifts.
  - Both windowed maxima are compared (not the instantaneous linear sample) so
    linear motion is judged as robustly as angular (plan §4.2).

- **Examples:**

  ```ts
  const win = new MotionWindow();
  win.push(0.2, 0.1); // valid
  win.push(1000, 0); // glitch -> rejected, returns false
  decideCapture({
    windowMaxAngular: win.maxAngular(),
    windowMaxLinear: win.maxLinear(),
    maxAngularVelocity: 0.6,
    maxLinearVelocity: 2.5,
    msSinceDue: 0,
    maxWaitMs: 4000,
  }); // 'capture' (calm)
  ```

- **Tests:** `capture-motion-gate.test.ts` — calm→capture, fast→defer, fallback
  fires at `maxWaitMs`, glitch rejected without polluting the window, empty
  window not calm.

- **Related docs:**
  `GpsPlusSlamJs_Docs/docs/2026-06-23-2105-blurry-frame-motion-gating-plan.md`
  (§4.2-4.4), `pose-motion.ts.md`, `image-capture.ts.md`.
