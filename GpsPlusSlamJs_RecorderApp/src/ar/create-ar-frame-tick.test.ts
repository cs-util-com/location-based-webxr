import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createArFrameTick } from './create-ar-frame-tick';
import {
  createArSessionResources,
  type ArSessionResources,
} from './ar-session-resources';

/**
 * The per-XR-frame tick runs 60+ Hz and, before it was extracted, was only
 * reachable by driving a whole Enter-AR. These tests pin its arithmetic and
 * its null-handling directly.
 */

/** Stand-in for the live render camera; the tick only passes it through. */
function fakeCamera() {
  return {} as never;
}

describe('createArFrameTick', () => {
  let resources: ArSessionResources;

  beforeEach(() => {
    vi.useFakeTimers();
    resources = createArSessionResources();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Why this matters: dt is handed to the lerper and the follower as SECONDS.
  // A regression to milliseconds would make both overshoot by 1000x while
  // every type still checks out.
  it('passes elapsed time to consumers in seconds, measured between ticks', () => {
    const update = vi.fn();
    resources.alignmentLerper = {
      update,
      dispose: vi.fn(),
    } as unknown as ArSessionResources['alignmentLerper'];

    const tick = createArFrameTick({ resources, getCamera: () => null });

    vi.advanceTimersByTime(500);
    tick();
    expect(update).toHaveBeenCalledWith(0.5);

    vi.advanceTimersByTime(250);
    tick();
    expect(update).toHaveBeenLastCalledWith(0.25);
  });

  // Why this matters: the tick is built BEFORE initAR, so at the first frames
  // most slots are still null. It must never throw on an empty record —
  // a throw here kills the frame loop for the whole session.
  it('is a no-op when every slot is still empty', () => {
    const tick = createArFrameTick({ resources, getCamera: () => null });
    vi.advanceTimersByTime(16);
    expect(() => tick()).not.toThrow();
  });

  // Why this matters: resources are read at FIRE time. A tick created before
  // the stats overlay exists must still drive it once it appears.
  it('picks up resources created after it was built', () => {
    const tick = createArFrameTick({ resources, getCamera: () => null });
    tick();

    const update = vi.fn();
    resources.statsOverlay = {
      update,
      dispose: vi.fn(),
    } as unknown as ArSessionResources['statsOverlay'];

    vi.advanceTimersByTime(16);
    tick();
    expect(update).toHaveBeenCalledTimes(1);
  });

  // Why this matters: the follower needs a camera, the lerper does not.
  // Losing the camera (between sessions, or before the renderer exists) must
  // not stall alignment interpolation.
  it('still advances the lerper when no camera is available', () => {
    const lerperUpdate = vi.fn();
    const followerUpdate = vi.fn();
    resources.alignmentLerper = {
      update: lerperUpdate,
      dispose: vi.fn(),
    } as unknown as ArSessionResources['alignmentLerper'];
    resources.cameraFollower = {
      update: followerUpdate,
      dispose: vi.fn(),
    } as unknown as ArSessionResources['cameraFollower'];

    const tick = createArFrameTick({ resources, getCamera: () => null });
    vi.advanceTimersByTime(16);
    tick();

    expect(lerperUpdate).toHaveBeenCalledTimes(1);
    expect(followerUpdate).not.toHaveBeenCalled();
  });

  // Why this matters: the map overlay is a CSS3D layer whose reprojection is
  // the most expensive thing in the tick. Updating it while hidden is wasted
  // work every single frame.
  it('reprojects the map only while it is visible', () => {
    const updatePosition = vi.fn();
    let visible = false;
    resources.mapOverlay = {
      isVisible: () => visible,
      updatePosition,
    } as unknown as ArSessionResources['mapOverlay'];

    const camera = fakeCamera();
    const tick = createArFrameTick({
      resources,
      getCamera: () => camera,
    });

    vi.advanceTimersByTime(16);
    tick();
    expect(updatePosition).not.toHaveBeenCalled();

    visible = true;
    vi.advanceTimersByTime(16);
    tick();
    // The live render camera must be forwarded so heading-up rotation is
    // computed against what the user is actually looking through.
    expect(updatePosition).toHaveBeenCalledWith(0.016, camera);
  });

  // Why this matters: the follower gets the camera positionally; swapping the
  // argument order with dt would silently produce a NaN-free but wrong lerp.
  it('drives the follower with (camera, dt)', () => {
    const followerUpdate = vi.fn();
    resources.cameraFollower = {
      update: followerUpdate,
      dispose: vi.fn(),
    } as unknown as ArSessionResources['cameraFollower'];

    const camera = fakeCamera();
    const tick = createArFrameTick({
      resources,
      getCamera: () => camera,
    });

    vi.advanceTimersByTime(100);
    tick();
    expect(followerUpdate).toHaveBeenCalledWith(camera, 0.1);
  });
});
