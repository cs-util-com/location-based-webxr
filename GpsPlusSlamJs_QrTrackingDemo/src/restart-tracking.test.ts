/**
 * The demo's restart wiring (QR near-frontal pose plan M3b b5).
 *
 * Why these tests matter: the demo had no tracking store, so the session
 * never told it about an odometry restart and its fused QR window would keep
 * combining detections from two coordinate frames. The session needs a
 * `tracking` group (a store holding the tracking slice, plus the restart
 * callback); the demo gives it a store of its OWN, so the per-frame pose
 * dispatches never reach the HUD's store (which re-renders on every change).
 */
import { describe, expect, it, vi } from "vitest";
import { createRestartTracking } from "./restart-tracking.js";

describe("createRestartTracking", () => {
  it("reports a restart as a frame change", () => {
    const onFrameChanged = vi.fn();
    const tracking = createRestartTracking(onFrameChanged);
    tracking.onRestarted();
    expect(onFrameChanged).toHaveBeenCalledTimes(1);
  });

  it("hands the session a store of its own that holds the tracking slice", () => {
    const a = createRestartTracking(() => {});
    const b = createRestartTracking(() => {});
    expect(a.store).not.toBe(b.store);
    expect(a.store.getState().tracking.phase).toBe("initializing");
  });
});
