/**
 * Per-frame callback registry. The WebXR session owns the single
 * `renderer.setAnimationLoop(...)` hook for the page; components that need
 * a per-frame tick register here and the session's `onXRFrame` invokes
 * `runFrameUpdates(dt, elapsed)` once per frame.
 *
 * Plain functions, not a class: there is exactly one frame loop per session
 * and singletons-of-singletons add no value. See
 * `2026-05-13-ecs-migration-plan.md` for the design rationale and the
 * rules new `FrameUpdate` bodies must follow (pure function of `dt` plus
 * selectors; no direct Redux dispatch from inside a tick).
 *
 * THE MECHANICS LIVE IN `createIsolatedRegistry`, not here. The snapshot
 * semantics (a register/unregister during a tick defers to the next frame, and
 * the snapshot is cached between registry changes so 60–90 Hz costs no
 * allocation) and the per-callback isolation are shared with `xr-frame-loop`
 * and `session-disposers`, which were structurally identical modules until the
 * shape was extracted. This file is now the frame loop's NAME and lifetime;
 * the behaviour is pinned once, in `isolated-registry.test.ts`.
 */

import { createIsolatedRegistry } from '../utils/isolated-registry';
import { createLogger } from '../utils/logger';

const log = createLogger('FrameLoop');

export type FrameUpdate = (dt: number, elapsed: number) => void;

const registry = createIsolatedRegistry<[number, number]>({
  // The sink is passed rather than defaulted so failures keep reporting under
  // THIS registry's logger name; the primitive imports no logger of its own.
  onError: (error) =>
    log.error('A registered FrameUpdate threw; continuing the loop', error),
});

/**
 * Register a per-frame callback. Returns an unregister function.
 *
 * Registration is idempotent — calling with the same `fn` twice is a no-op
 * (it remains a single entry in the underlying `Set`).
 */
export function registerFrameUpdate(fn: FrameUpdate): () => void {
  return registry.register(fn);
}

/**
 * Invoke all registered callbacks. Called by the WebXR session's
 * `onXRFrame` once per frame with the XR-derived `dt` (seconds since the
 * previous frame; 0 on the first frame after a reset) and `elapsed`
 * (seconds since the session started).
 *
 * A throwing handler is isolated: it cannot abort the remaining callbacks nor
 * propagate up through `onXRFrame` and kill the scene render for the whole
 * frame.
 */
export function runFrameUpdates(dt: number, elapsed: number): void {
  registry.run(dt, elapsed);
}

/**
 * Clear all registrations. Called from `resetWebXRState()` so a fresh
 * session starts with an empty registry (any callbacks from the previous
 * session are dropped along with their owning components).
 */
export function clearFrameUpdates(): void {
  registry.clear();
}
