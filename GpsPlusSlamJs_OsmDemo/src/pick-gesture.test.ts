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

import {
  PICK_MOVE_TOLERANCE_PX,
  isPickGesture as isPickGestureOn,
  pickOrigin,
} from "./pick-gesture.js";

/** The scene's own drawing surface (the canvas, in the view). */
const SURFACE = { name: "canvas" };
/** Something else inside the scene's container: a dialog button, say. */
const CONTROL = { name: "button" };

/** A pointer release at `(x, y)` from `button`, with the defaults a tap has. */
function up(
  button: number,
  x = 100,
  y = 100,
  target: unknown = SURFACE,
): { button: number; clientX: number; clientY: number; target: unknown } {
  return { button, clientX: x, clientY: y, target };
}

/** The decision against the scene's surface, as the view asks it. */
const isPickGesture = (
  down: Parameters<typeof isPickGestureOn>[0],
  release: Parameters<typeof isPickGestureOn>[1],
) => isPickGestureOn(down, release, SURFACE);

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

  /**
   * A CONTROL OVER THE SCENE IS NOT THE SCENE. The light dialog lives inside
   * the 3D view's container, so a click on its buttons bubbles to the view's
   * listeners, and the view used to pick at the click's point: the back arrow
   * or "Check heat grid" ordered the NPC to wherever ground lay under the
   * button, and the walk kept the scene repainting under the measurements
   * that followed. Only a release on the drawing surface itself may pick.
   */
  it("refuses a still primary release on another element than the surface", () => {
    expect(isPickGesture(DOWN, up(0, 100, 100, CONTROL))).toBe(false);
  });

  it("refuses a release with no target", () => {
    expect(isPickGesture(DOWN, up(0, 100, 100, null))).toBe(false);
  });
});

describe("pickOrigin", () => {
  it("records a press on the surface", () => {
    expect(pickOrigin(up(0, 12, 34), SURFACE)).toEqual({ x: 12, y: 34 });
  });

  /**
   * A press on a control over the scene records nothing, so a release that
   * then lands on the surface has no origin and cannot pick either.
   */
  it("records nothing for a press on another element", () => {
    expect(pickOrigin(up(0, 12, 34, CONTROL), SURFACE)).toBeUndefined();
  });
});
