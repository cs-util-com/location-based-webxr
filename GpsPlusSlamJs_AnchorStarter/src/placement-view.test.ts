/**
 * Tests for the placement view-model.
 *
 * Why this matters: the repo async-UX rule
 * (`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-29-ref-points-user-feedback.md`)
 * requires that an async action (here: place + save the anchor) shows a
 * distinguishable in-progress state and then a final state, with failures
 * reverting and surfacing the error. These tests assert that transitional
 * contract for BOTH the success path (saving → saved) and the failure path
 * (saving → placeable + errorMessage) at the view-model level, so the DOM
 * glue can stay trivial.
 */

import { describe, it, expect } from "vitest";
import {
  initialSetupState,
  setupReducer,
  type SetupState,
} from "./setup-state-machine.js";
import { toPlacementView } from "./placement-view.js";

/** Drive the FSM into the cache-miss placement branch. */
function placeableState(trackingReady = false): SetupState {
  let state = setupReducer(initialSetupState, {
    type: "BOOTED",
    hasCachedAnchor: false,
  });
  if (trackingReady) {
    state = setupReducer(state, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
  }
  return state;
}

describe("toPlacementView", () => {
  it("hides the button before the placement branch (booting)", () => {
    expect(toPlacementView(initialSetupState).button).toMatchObject({
      visible: false,
    });
  });

  it("shows an enabled, soft-gated button while tracking is still warming up", () => {
    const view = toPlacementView(placeableState(false));
    expect(view.button).toMatchObject({
      visible: true,
      label: "Place anchor",
      disabled: false,
    });
    // Soft gate: copy nudges waiting but does not block.
    expect(view.banner).toContain("moving until");
  });

  it("updates the banner once tracking is good", () => {
    const view = toPlacementView(placeableState(true));
    expect(view.button.disabled).toBe(false);
    expect(view.banner).toContain("Tracking looks good");
  });

  it('SUCCESS PATH: shows in-progress "Saving…" then final "Saved ✓" + share link', () => {
    const saving = setupReducer(placeableState(true), {
      type: "PLACE_REQUESTED",
    });
    const inProgress = toPlacementView(saving);
    // In-progress state must be distinguishable and block re-entry.
    expect(inProgress.button).toMatchObject({
      label: "Saving…",
      disabled: true,
    });
    expect(inProgress.copyLink.visible).toBe(false);

    const saved = setupReducer(saving, { type: "PLACE_SUCCEEDED" });
    const final = toPlacementView(saved);
    // Final state reflects the durable end state, not just dispatch.
    expect(final.button).toMatchObject({ label: "Saved ✓" });
    // The shareable-link confirmation is reached on the success path.
    expect(final.copyLink.visible).toBe(true);
    expect(final.banner).toContain("copy the link");
    expect(final.error).toBeNull();
  });

  it("FAILURE PATH: reverts to an enabled button and surfaces the error", () => {
    const saving = setupReducer(placeableState(true), {
      type: "PLACE_REQUESTED",
    });
    const failed = setupReducer(saving, {
      type: "PLACE_FAILED",
      message: "Storage quota exceeded",
    });
    const view = toPlacementView(failed);
    expect(view.button).toMatchObject({
      label: "Place anchor",
      disabled: false,
    });
    expect(view.error).toBe("Storage quota exceeded");
    expect(view.copyLink.visible).toBe(false);
  });

  it("cache-hit branch keeps the button hidden and coaches relocalisation", () => {
    const relocalising = setupReducer(initialSetupState, {
      type: "BOOTED",
      hasCachedAnchor: true,
    });
    expect(toPlacementView(relocalising).button.visible).toBe(false);
    expect(toPlacementView(relocalising).banner).toContain("re-localise");

    const shown = setupReducer(relocalising, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(toPlacementView(shown).banner).toContain("real-world spot");
  });
});
