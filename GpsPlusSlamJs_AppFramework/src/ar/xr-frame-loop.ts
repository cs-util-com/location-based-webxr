/**
 * Per-frame **XR-access** callback registry — the safe seam that lets app
 * code run standard WebXR work (hit-test, light estimation, depth, the WebXR
 * Anchors API, …) without the framework wrapping each capability.
 *
 * The framework owns the single `renderer.setAnimationLoop(onXRFrame)` hook,
 * and the live `XRFrame` never leaves `onXRFrame`. The plain `FrameUpdate`
 * registry (`frame-loop.ts`) only passes `(dt, elapsed)`, which is enough for
 * pose-free ticks but cannot drive hit-test. This registry additionally hands
 * the callback the live `frame`, `referenceSpace`, and `session`.
 *
 * SAFETY CONTRACT (non-negotiable): `frame` / `referenceSpace` / `session` are
 * valid **only synchronously inside the callback**. The `XRFrame` is
 * use-after-frame-unsafe — storing it and reading it on a later tick throws or
 * crashes. Passing them as arguments (never a stashable `getXrFrame()` getter)
 * makes correct use the easy path and stashing the awkward one. Do NOT retain
 * `ctx` or its fields beyond the callback's synchronous execution.
 *
 * See `2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md`
 * §6.2/§6.3 (option H-A2) for the design rationale.
 */

import { createIsolatedRegistry } from '../utils/isolated-registry';
import { createLogger } from '../utils/logger';

/**
 * Live, frame-scoped WebXR context. Valid only synchronously inside the
 * `XrFrameUpdate` callback it is passed to.
 */
export interface XrFrameContext {
  /** The live `XRFrame` for this animation-frame. Use-after-frame-unsafe. */
  readonly frame: XRFrame;
  /** The session's reference space (e.g. for `frame.getPose` / hit-test results). */
  readonly referenceSpace: XRReferenceSpace;
  /** The active `XRSession` (e.g. to call `requestHitTestSource` once). */
  readonly session: XRSession;
  /** Seconds since the previous frame (0 on the first frame after a reset). */
  readonly dt: number;
  /**
   * Seconds from the animation-frame timestamp — **page-relative, NOT
   * session-relative**, despite what this said until 2026-08-13.
   *
   * `onXRFrame` computes it as `time / 1000`, and `time` is the rAF timestamp,
   * so a session entered thirty seconds after page load sees its FIRST frame at
   * `elapsed ≈ 30`. It is monotonic and safe to difference; it is not safe to
   * treat as "time since entry".
   *
   * The old wording cost a consumer a real defect: a frame-rate average
   * initialised its window to `0`, which on a device made the first window as
   * long as the page had been open and reported ~0 fps.
   */
  readonly elapsed: number;
}

/** A per-frame callback that needs live XR access. See the safety contract. */
export type XrFrameUpdate = (ctx: XrFrameContext) => void;

const log = createLogger('XrFrameLoop');

const registry = createIsolatedRegistry<[XrFrameContext]>({
  // Passed, not defaulted, so failures keep this registry's own logger name.
  onError: (error) =>
    log.error('A registered XrFrameUpdate threw; continuing the loop', error),
});

/**
 * Register a per-frame XR-access callback. Returns an unregister function.
 *
 * Registration is idempotent — registering the same `fn` twice is a no-op
 * (it remains a single entry in the underlying `Set`).
 */
export function registerXrFrameUpdate(fn: XrFrameUpdate): () => void {
  return registry.register(fn);
}

/**
 * Invoke all registered XR-access callbacks. Called by the WebXR session's
 * `onXRFrame` once per frame, only when a live `frame` / `referenceSpace` /
 * `session` are all available.
 *
 * A register/unregister made by a handler during the same frame is deferred to
 * the next tick, and each callback is isolated — this registry is the public
 * app seam, so a bug in one app-registered callback (which throws every frame)
 * must not abort the remaining callbacks nor propagate up through `onXRFrame`
 * and kill the scene render for the whole session. Both behaviours come from
 * `createIsolatedRegistry` and are pinned in `isolated-registry.test.ts`.
 */
export function runXrFrameUpdates(ctx: XrFrameContext): void {
  registry.run(ctx);
}

/**
 * Clear all registrations. Called from `resetWebXRState()` so a fresh
 * session starts with an empty registry.
 */
export function clearXrFrameUpdates(): void {
  registry.clear();
}
