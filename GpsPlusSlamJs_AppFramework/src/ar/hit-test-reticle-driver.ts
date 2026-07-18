/**
 * Hit-test reticle driver — the per-frame WebXR plumbing that drives the
 * screen-centre hit-test reticle whose pure view-model lives in
 * `visualization/hit-test-reticle.ts` (`createReticleMesh` / `updateReticle`).
 *
 * Promoted from the consumer apps (2026-07-18): MinimalExample,
 * WayfindingHudDemo and AnchorStarter each hand-rolled this loop, and the
 * copies had already drifted in their session-end handling. AnchorStarter's
 * copy (the most careful one) is the reference implementation.
 *
 * Responsibilities, all subtle and previously copy-pasted per app:
 * - Request the hit-test source once per session (`requestReferenceSpace
 *   ('viewer')` → `requestHitTestSource`), retrying on transient failure.
 * - Guard the "request still in flight while we shut down" races: a source
 *   that resolves after `dispose()` — or after the session that issued the
 *   request has ended — is cancelled, never adopted.
 * - Register the session `'end'` (and optional `'select'`) listeners exactly
 *   once per session, outside the request-retry path.
 * - Reset per-session state on `'end'` so a fresh session re-requests its own
 *   source with its own listeners.
 *
 * Lifecycle: the handle is torn down only by `dispose()`. In the framework's
 * standard flow `resetWebXRState()` clears the XR frame registry at every
 * session end, so a handle is typically created once per AR session entry and
 * disposed from the app's session-teardown path; the per-session reset logic
 * additionally keeps the handle correct when frames are delivered outside that
 * flow (tests, custom loops).
 */

import { Vector3, type Object3D } from 'three';
import {
  createReticleMesh,
  updateReticle,
} from '../visualization/hit-test-reticle.js';
import { registerXrFrameUpdate } from './xr-frame-loop.js';

/** Live-reticle handle returned by {@link startHitTestReticle}. */
export interface HitTestReticleHandle {
  /** Is a surface currently under the screen-centre reticle? */
  isVisible(): boolean;
  /**
   * Write the reticle's current world position into `out` and return it. Only
   * meaningful while `isVisible()` is true; the value is the GPS-world (NUE)
   * pose once `arWorldGroup` carries the alignment.
   */
  getWorldPosition(out: Vector3): Vector3;
  /** Remove the reticle mesh and unregister the frame loop (idempotent). */
  dispose(): void;
}

/** Arguments for {@link startHitTestReticle}. */
export interface HitTestReticleArgs {
  /**
   * Parent for the reticle mesh — pass `getArWorldGroup()` so the reticle
   * rides the GPS alignment and its world pose is GPS-world (NUE).
   */
  arWorldGroup: Object3D;
  /**
   * Optional tap handler, fired on EVERY WebXR `select` — with the reticle's
   * current world position when a surface is present, or `null` when not.
   * Surface-less taps are reported too so the app can react (GPS gating,
   * "point at the floor" hints); the placement decision stays app-side.
   * When omitted, no `select` listener is registered at all.
   */
  onSelect?: (worldPosition: Vector3 | null) => void;
}

/**
 * Request a screen-centre hit-test source from the live session. Returns
 * `null` when the runtime does not expose `requestHitTestSource` (older WebXR
 * builds); the caller keeps the reticle hidden in that case.
 */
async function requestHitTestSource(
  session: XRSession
): Promise<XRHitTestSource | null> {
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource?.({ space: viewerSpace });
  return source ?? null;
}

/**
 * Cancel a hit-test source, tolerating a dead session. `cancel()` can throw
 * once the source's session has ended (e.g. the app's teardown path calls
 * `dispose()` before this driver's own `'end'` listener has run) — and a
 * dead session has already stopped the hit-test, so there is nothing left to
 * clean up.
 */
function cancelSource(source: XRHitTestSource | null | undefined): void {
  try {
    source?.cancel();
  } catch {
    // Already cancelled or its session is gone.
  }
}

/**
 * Install the hit-test reticle under `arWorldGroup` and start driving it from
 * the XR frame loop. Returns a handle the app reads at placement time (or
 * ignores entirely when it placed via `onSelect`).
 */
export function startHitTestReticle(
  args: HitTestReticleArgs
): HitTestReticleHandle {
  const reticle = createReticleMesh();
  args.arWorldGroup.add(reticle);

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let disposed = false;
  let removeSessionListeners: (() => void) | null = null;
  // Bumped on every session end. An in-flight request remembers the
  // generation it was issued under, so a source (or failure) arriving after
  // its session died is recognized as stale — see the request block below.
  let sessionGeneration = 0;

  const handleSelect = () => {
    args.onSelect?.(
      reticle.visible ? reticle.getWorldPosition(new Vector3()) : null
    );
  };

  // Reset on session end so a fresh session re-requests its own hit-test
  // source. `removeSessionListeners` is cleared too: the listeners were bound
  // to the now-ended session, so the next session must pass the
  // `if (!removeSessionListeners)` guard below and register its own —
  // otherwise its end would never reset the source and a third session would
  // keep a stale, dead handle.
  const handleSessionEnd = () => {
    sessionGeneration += 1;
    hitTestSource = null;
    hitTestSourceRequested = false;
    removeSessionListeners = null;
  };

  const unregister = registerXrFrameUpdate(
    ({ frame, referenceSpace, session }) => {
      // Register the session listeners exactly once. The request-retry path
      // below resets `hitTestSourceRequested`, so they must not live in that
      // block or a failed request would stack duplicates each frame.
      if (!removeSessionListeners) {
        session.addEventListener('end', handleSessionEnd);
        if (args.onSelect) {
          session.addEventListener('select', handleSelect);
        }
        removeSessionListeners = () => {
          session.removeEventListener('end', handleSessionEnd);
          if (args.onSelect) {
            session.removeEventListener('select', handleSelect);
          }
        };
      }

      if (!hitTestSourceRequested) {
        hitTestSourceRequested = true;
        const requestGeneration = sessionGeneration;
        requestHitTestSource(session)
          .then((source) => {
            // Guard the races where the request outlived its context: after
            // dispose(), or after the issuing session ended (a stale source
            // adopted here would shadow the NEXT session's own source).
            // Cancel the orphaned source instead of leaking it.
            if (disposed || requestGeneration !== sessionGeneration) {
              cancelSource(source);
              return;
            }
            hitTestSource = source;
          })
          .catch(() => {
            // Allow a later frame to retry a transient failure — but only
            // within the issuing session. A late failure from an ended
            // session must not reset the flag under the NEXT session, or a
            // duplicate concurrent request would start.
            if (requestGeneration === sessionGeneration) {
              hitTestSourceRequested = false;
            }
          });
      }

      if (!hitTestSource) {
        updateReticle(reticle, null);
        return;
      }

      const [hit] = frame.getHitTestResults(hitTestSource);
      const pose = hit?.getPose(referenceSpace);
      updateReticle(reticle, pose ? pose.transform.matrix : null);
    }
  );

  return {
    isVisible: () => reticle.visible,
    getWorldPosition: (out) => reticle.getWorldPosition(out),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unregister();
      removeSessionListeners?.();
      removeSessionListeners = null;
      // Stop the live hit-test so it does not keep running after teardown.
      cancelSource(hitTestSource);
      hitTestSource = null;
      args.arWorldGroup.remove(reticle);
    },
  };
}
