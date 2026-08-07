# `session-disposers.ts` — session-scoped teardown registry

- **Purpose:** a `Set`-based registry of one-shot teardown functions tied to a
  single AR session. Components that allocate a non-frame session resource (a
  store subscription, an event listener, a lerper) register a disposer here, and
  the WebXR session's `resetWebXRState()` flushes them on teardown so the
  resource never outlives its session.

- **Why it exists:** `resetWebXRState()` already clears the per-frame registry
  (`frame-loop.ts` via `clearFrameUpdates()`), but resources that are **not**
  per-frame ticks had no teardown hook — most notably the store subscription
  opened by `enableArWorldGroupAlignment`, which leaked across sessions (a
  dangling subscriber pinning the old `arWorldGroup`). Because `initAR()` throws
  while a prior session is still live, every restart must pass through
  `resetWebXRState()`, making it the single chokepoint where flushing is
  guaranteed.

- **Public API:**
  - `registerSessionDisposer(dispose: () => void) → () => void` — register a
    teardown; returns a deregister fn (call it when the resource is disposed
    early so a later flush won't re-run it).
  - `runSessionDisposers()` — snapshot, **clear**, then run each disposer in its
    own `try/catch`. Called from `resetWebXRState()`. This is
    `isolated-registry`'s `runOnce()`; the clear-before-run ordering is what
    makes a second flush a no-op and stops a disposer that re-registers during
    teardown from looping.
  - `clearSessionDisposers()` — drop all without running (test-only hygiene,
    parallels `clearFrameUpdates`).

- **Invariants & assumptions:**
  - **Run-once / clear-on-run:** the set is cleared _before_ the disposers run,
    so a double flush is a no-op and a disposer that re-registers cannot loop.
  - **Isolation:** one throwing disposer is logged and does not abort the rest
    (mirrors `runFrameUpdates`).
  - This is a sibling of `frame-loop.ts` but a distinct registry: `frame-loop`
    holds per-frame ticks invoked every frame; this holds one-shot teardown run
    exactly once on session end.
  - Not part of the public package API (no barrel re-export) — internal wiring
    between `visualization/ar-world-group-alignment.ts` and
    `ar/webxr-session.ts`.

- **Examples:**

  ```ts
  const deregister = registerSessionDisposer(() => subscription.unsubscribe());
  // …on early teardown:
  deregister();
  // …or let resetWebXRState() → runSessionDisposers() flush it on session end.
  ```

- **Tests:** `session-disposers.test.ts` (run-once, clear-on-run, deregister,
  throwing-disposer isolation, `clearSessionDisposers`). The wiring into
  teardown is pinned by `webxr-session.test.ts`
  (`resetWebXRState runs (and clears) registered session disposers`), and the
  real consumer by `visualization/ar-world-group-alignment.test.ts`.

- **Related:** `frame-loop.ts` (the per-frame sibling registry),
  `ar/webxr-session.ts` (`resetWebXRState` flushes this),
  `visualization/ar-world-group-alignment.ts` (the first consumer), and the plan
  at
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-2149-arworldgroup-alignment-session-scoped-disposal.md`.
