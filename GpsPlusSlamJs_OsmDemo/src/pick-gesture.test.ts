/**
 * Whether a pointer gesture is a pick at all (DEC-R13-8).
 *
 * WHY THESE TESTS EXIST. The ninth testing session found that left-click and
 * right-click do the same thing: `building-view.ts` picked on `pointerup` after
 * a still pointer and never read `event.button`, so button 2 ran the same pick
 * and ordered the NPC — on top of the browser's own context menu. Right-click is
 * reserved for the Google-Maps-style "copy the coordinates here" affordance the
 * session asked for, and reserving a channel means it must first stop doing
 * something else.
 *
 * The decision lives in a pure module for the same reason `pick.ts` does:
 * `BuildingView` needs a `WebGLRenderer`, so every branch of a guard written
 * inside it is unreachable by the unit suite.
 */

import { describe, expect, it } from "vitest";

import { PICK_MOVE_TOLERANCE_PX, isPickGesture } from "./pick-gesture.js";

/** A pointer release at `(x, y)` from `button`, with the defaults a tap has. */
function up(
  button: number,
  x = 100,
  y = 100,
): { button: number; clientX: number; clientY: number } {
  return { button, clientX: x, clientY: y };
}

const DOWN = { x: 100, y: 100 };

describe("isPickGesture", () => {
  it("accepts a still primary click", () => {
    expect(isPickGesture(DOWN, up(0))).toBe(true);
  });

  /**
   * THE FINDING THIS MODULE EXISTS FOR (R13-7, DEC-R13-8). Before the guard a
   * right-click ordered the agent, so the context menu and a walk arrived
   * together.
   */
  it("refuses the secondary button", () => {
    expect(isPickGesture(DOWN, up(2))).toBe(false);
  });

  /**
   * A TOUCH TAP MUST STILL ORDER, and it needs no `pointerType` clause to do so:
   * a touch contact reports `button: 0` on both `pointerdown` and `pointerup`,
   * so the primary-button test already admits it. Spelling the exemption as
   * `pointerType !== "mouse"` instead would widen the guard for no gain and let
   * a pen barrel-button press (`button: 2`, `pointerType: "pen"`) through as an
   * order, which is the exact class of accidental ordering this stage removes.
   */
  it("accepts a touch tap, which reports the primary button", () => {
    expect(isPickGesture(DOWN, up(0))).toBe(true);
  });

  it("refuses the middle and back buttons too", () => {
    expect(isPickGesture(DOWN, up(1))).toBe(false);
    expect(isPickGesture(DOWN, up(3))).toBe(false);
    expect(isPickGesture(DOWN, up(4))).toBe(false);
  });

  /**
   * `button` is `-1` on a pointer event with no button state change, which
   * `pointerup` should never produce — but the value is external data and
   * `-1 !== 0` must fall on the refusing side rather than be read as "primary".
   */
  it("refuses the no-button sentinel", () => {
    expect(isPickGesture(DOWN, up(-1))).toBe(false);
  });

  /**
   * THE BEHAVIOUR THAT PREDATES THIS MODULE and must survive it: MapControls
   * consumes drags, so a click at the end of a 200 px pan would otherwise select
   * whatever happened to be under the pointer when it stopped.
   */
  it("refuses a drag beyond the tolerance", () => {
    expect(isPickGesture(DOWN, up(0, 100 + PICK_MOVE_TOLERANCE_PX + 1))).toBe(
      false,
    );
  });

  it("accepts a wobble at exactly the tolerance", () => {
    expect(isPickGesture(DOWN, up(0, 100 + PICK_MOVE_TOLERANCE_PX))).toBe(true);
  });

  /**
   * The tolerance is a MANHATTAN distance, matching what the view has always
   * measured — so the two axes share the budget rather than each getting it.
   */
  it("sums both axes against the tolerance", () => {
    const half = PICK_MOVE_TOLERANCE_PX / 2;
    expect(isPickGesture(DOWN, up(0, 100 + half, 100 + half))).toBe(true);
    expect(isPickGesture(DOWN, up(0, 100 + half + 1, 100 + half + 1))).toBe(
      false,
    );
  });

  /**
   * No `pointerdown` was seen — a pointer that entered the canvas already
   * pressed, or a release after `dispose()` re-armed nothing. There is no origin
   * to measure against, and guessing one would make a drag from outside the
   * canvas read as a tap.
   */
  it("refuses a release with no recorded press", () => {
    expect(isPickGesture(undefined, up(0))).toBe(false);
  });

  /**
   * The button is checked even when there is no press to measure against, so
   * the two guards cannot be reordered into one that passes on a right-click.
   */
  it("refuses a secondary release with no recorded press", () => {
    expect(isPickGesture(undefined, up(2))).toBe(false);
  });
});
