/**
 * Pure view-model for the placement controls (the "Place anchor" button,
 * the status banner, the copy-link action, and the error line).
 *
 * Derives everything the placement UI shows from the tested `SetupState`
 * finite state machine. Keeping it pure lets us unit-test the async-UX
 * contract (idle → in-progress → final, plus the failure revert) without a
 * DOM — see `placement-view.test.ts`. The DOM layer in `main.ts` only
 * copies these fields onto elements; it contains no branching logic.
 */

import type { SetupState } from "./setup-state-machine.js";

// Internal shape (not re-exported): reachable as `PlacementView["button"]`.
interface PlaceButtonView {
  /** Shown only in the cache-miss placement branch. */
  readonly visible: boolean;
  readonly label: string;
  readonly disabled: boolean;
}

export interface PlacementView {
  readonly button: PlaceButtonView;
  /** Sentence describing what the user should do / what just happened. */
  readonly banner: string;
  /**
   * Whether to surface the "copy link" share button. Shown once the anchor is
   * saved into the URL, so the user can hand the shareable link to another
   * device or person (decision F1).
   */
  readonly copyLink: { readonly visible: boolean };
  /** Last placement error, or null. */
  readonly error: string | null;
}

const HIDDEN_BUTTON: PlaceButtonView = {
  visible: false,
  label: "Place anchor",
  disabled: true,
};

function buttonFor(state: SetupState): PlaceButtonView {
  switch (state.phase) {
    case "awaiting-tracking":
    case "ready-to-place":
      // Soft gate (D2): always enabled in the placement branch.
      return {
        visible: true,
        label: "Place anchor",
        disabled: false,
      };
    case "saving":
      return { visible: true, label: "Saving…", disabled: true };
    case "saved":
      return { visible: true, label: "Saved ✓", disabled: true };
    default:
      return HIDDEN_BUTTON;
  }
}

function bannerFor(state: SetupState): string {
  switch (state.phase) {
    case "booting":
      return "Starting…";
    case "awaiting-tracking":
    case "ready-to-place":
      return state.trackingReady
        ? "Tracking looks good — place your anchor."
        : 'You can place now, but moving until "Ready" makes the anchor more accurate.';
    case "saving":
      return "Saving your anchor…";
    case "saved":
      return "Saved into the page link — reload to test persistence, or copy the link to open this anchor on another device.";
    case "relocalising":
      return "Move around to re-localise your saved anchor.";
    case "anchor-shown":
      return "Your saved anchor is shown at its real-world spot.";
  }
}

/** Map a `SetupState` to the render-ready placement view-model. Total/pure. */
export function toPlacementView(state: SetupState): PlacementView {
  return {
    button: buttonFor(state),
    banner: bannerFor(state),
    copyLink: { visible: state.phase === "saved" },
    error: state.errorMessage,
  };
}
