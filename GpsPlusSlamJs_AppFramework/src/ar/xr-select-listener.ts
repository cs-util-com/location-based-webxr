/**
 * Every WebXR `select` (a tap in AR the DOM overlay did not cancel) with
 * where it pointed, for an app that needs taps but no hit-test reticle -
 * the Tour Viewer's visitor tapping a pin (station blocks plan B2b step 5).
 * The reticle driver (`hit-test-reticle-driver.ts`) hears its taps the
 * same way and reads the ray with the same `targetRayOf`.
 *
 * - The session's `select` and `end` listeners are registered once per
 *   session, from the XR frame loop (the first frame of each session).
 * - The `viewer` space is requested once per session; a request that
 *   resolves after its session ended, or after `dispose()`, is dropped.
 * - A tap before the viewer space is known, or one whose event carries no
 *   readable pose, is reported with a null ray (the screen centre).
 *
 * @see xr-select-listener.ts.md
 */

import { registerXrFrameUpdate } from './xr-frame-loop.js';

/**
 * Where a tap pointed: the input source's target ray as a column-major 4x4
 * pose RELATIVE TO THE VIEWER (the camera's own frame; the ray runs along
 * the pose's -Z). For a screen tap it starts at the viewer and passes
 * through the tapped point.
 */
export interface SelectTargetRay {
  readonly targetRayInViewer: readonly number[];
}

/**
 * The tap's target ray relative to `viewerSpace`, read from a `select`
 * event - or null when the event, its frame or the pose is missing, or the
 * frame refuses (it is only active while the event is dispatched).
 */
export function targetRayOf(
  event: unknown,
  viewerSpace: XRReferenceSpace | null
): SelectTargetRay | null {
  if (viewerSpace === null || typeof event !== 'object' || event === null) {
    return null;
  }
  const { frame, inputSource } = event as Partial<XRInputSourceEvent>;
  if (typeof frame?.getPose !== 'function' || inputSource === undefined) {
    return null;
  }
  try {
    const pose = frame.getPose(inputSource.targetRaySpace, viewerSpace);
    return pose
      ? { targetRayInViewer: Array.from(pose.transform.matrix) }
      : null;
  } catch {
    return null;
  }
}

/** A running listener of {@link startXrSelectListener}. */
export interface XrSelectListener {
  /** Stop listening: the frame update and the session's listeners go
   *  (idempotent). */
  dispose(): void;
}

/**
 * Call `onSelect` on every WebXR `select` of every AR session from now on,
 * with the tap's target ray ({@link SelectTargetRay}) or null. A throw in
 * `onSelect` is the caller's: it propagates out of the event dispatch.
 */
export function startXrSelectListener(
  onSelect: (tap: SelectTargetRay | null) => void
): XrSelectListener {
  let disposed = false;
  let session: XRSession | null = null;
  let viewerSpace: XRReferenceSpace | null = null;
  /** Bumped per session end: a late viewer space knows it is stale. */
  let generation = 0;

  const handleSelect = (event?: unknown) => {
    onSelect(targetRayOf(event, viewerSpace));
  };
  const stopSession = () => {
    if (session === null) return;
    session.removeEventListener('select', handleSelect);
    session.removeEventListener('end', stopSession);
    session = null;
    viewerSpace = null;
    generation += 1;
  };

  const unregister = registerXrFrameUpdate(({ session: live }) => {
    if (disposed || live === session) return;
    stopSession();
    session = live;
    live.addEventListener('select', handleSelect);
    live.addEventListener('end', stopSession);
    const requested = generation;
    live
      .requestReferenceSpace('viewer')
      .then((space) => {
        if (!disposed && requested === generation) viewerSpace = space;
      })
      .catch(() => {
        // No viewer space: taps come with a null ray (the screen centre).
      });
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unregister();
      stopSession();
    },
  };
}
