/**
 * Session-scoped disposer registry. Components that allocate a resource tied to
 * a single AR session — a store subscription, an event listener, a lerper —
 * register a teardown function here; the WebXR session's `resetWebXRState()`
 * flushes them on teardown so the resource never outlives the session it
 * belonged to.
 *
 * This is a sibling of `frame-loop.ts` (also a `Set`-based registry) but serves
 * a different need: `frame-loop` holds *per-frame ticks* invoked every frame and
 * wiped by `clearFrameUpdates()`; this registry holds *one-shot teardown* run
 * exactly once on session end. The split keeps each registry's contract crisp.
 *
 * Why it exists: `resetWebXRState()` already clears the frame-update registry,
 * but resources like the store subscription opened by
 * `enableArWorldGroupAlignment` are not per-frame ticks and had no teardown hook
 * — so they leaked across sessions (a dangling subscriber pinning the old
 * `arWorldGroup`). Because `initAR()` throws if a prior session is still live,
 * every restart must pass through `resetWebXRState()`, making it the single
 * chokepoint where flushing these disposers is guaranteed. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-2149-arworldgroup-alignment-session-scoped-disposal.md.
 */

import { createIsolatedRegistry } from '../utils/isolated-registry';
import { createLogger } from '../utils/logger';

const log = createLogger('SessionDisposers');

const registry = createIsolatedRegistry<[]>({
  // Passed, not defaulted, so failures keep this registry's own logger name.
  onError: (error) =>
    log.error('A session disposer threw; continuing teardown', error),
});

/**
 * Register a session-scoped teardown function. Returns a deregister function
 * (call it when the resource is disposed early, so a later flush won't re-run
 * the teardown).
 */
export function registerSessionDisposer(dispose: () => void): () => void {
  return registry.register(dispose);
}

/**
 * Run and drop every registered disposer. Called from `resetWebXRState()` on
 * session teardown.
 *
 * The set is snapshotted and **cleared before** running, so (a) a second flush
 * is a no-op rather than re-tearing-down an already-released resource, and (b) a
 * disposer that re-registers during teardown cannot loop. Each disposer runs in
 * its own `try/catch` so one throwing teardown cannot abort the rest — mirroring
 * `runFrameUpdates`.
 */
export function runSessionDisposers(): void {
  registry.runOnce();
}

/**
 * Drop all registrations without running them. Test-only hygiene helper
 * (parallels `clearFrameUpdates`) so a spec that registers a disposer cannot
 * leak it into the next spec.
 */
export function clearSessionDisposers(): void {
  registry.clear();
}
