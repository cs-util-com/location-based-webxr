/**
 * Whether a pointer gesture is a pick at all (DEC-R13-8).
 *
 * WHY THIS IS ITS OWN MODULE, and not two lines inside the `pointerup` handler.
 * `BuildingView` needs a `WebGLRenderer`, so it has no unit tests — a guard
 * written inside it is a guard whose branches the suite cannot reach. This is
 * the same split `pick.ts` already makes one step later in the chain: the
 * raycast and the listener stay in the view, the judgement lives in a pure
 * module the device layer thinly wraps.
 *
 * TWO QUESTIONS, ONE ANSWER, and they arrived a round apart:
 *
 * - **Was the pointer still?** MapControls consumes drags, so a release at the
 *   end of a 200 px pan must not select whatever ended up under the cursor.
 * - **Was it the primary button?** The ninth session found left-click and
 *   right-click doing the same thing (R13-7): the handler never read
 *   `event.button`, so a right-click ordered the NPC *and* opened the browser's
 *   context menu. DEC-R13-8 reserves the secondary button for the
 *   Google-Maps-style "copy the coordinates here" affordance, and reserving a
 *   channel means first making it inert.
 *
 * @see pick-gesture.ts.md
 */

/**
 * How far the pointer may travel between press and release and still pick,
 * measured as a Manhattan sum in CSS pixels.
 *
 * FOUR, unchanged from the value the view carried inline since W12. It is a
 * wobble budget rather than a drag threshold: MapControls has already handled
 * anything that was actually a pan, so this only has to survive the pointer
 * moving a pixel or two under a finger or a firm click.
 */
export const PICK_MOVE_TOLERANCE_PX = 4;

/**
 * The button value a primary click, a touch contact and a pen tip all report.
 *
 * **A TOUCH TAP NEEDS NO EXEMPTION OF ITS OWN.** Pointer Events specifies
 * `button: 0` for a touch contact on both `pointerdown` and `pointerup`, so the
 * primary-button test admits touch and pen taps unchanged. Spelling the
 * exemption as `pointerType !== "mouse"` instead — the shape the plan first
 * proposed — would widen the guard for no gain and let a pen barrel-button press
 * (`button: 2`, `pointerType: "pen"`) through as an order, which is precisely
 * the accidental ordering DEC-R13-8 removes.
 */
const PRIMARY_BUTTON = 0;

/** Where a `pointerdown` happened, in client coordinates. */
export interface PointerOrigin {
  readonly x: number;
  readonly y: number;
}

/**
 * The `PointerEvent` fields the decision reads.
 *
 * Deliberately not `PointerEvent` itself: this module must be constructible in a
 * test without a DOM, and these three fields are the whole of what it looks at.
 */
export interface PickPointer {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Whether a `pointerup` should produce a pick.
 *
 * `down` is `undefined` when no `pointerdown` was recorded — a pointer that
 * entered the canvas already pressed, or a release after the view re-armed.
 * That is refused rather than measured against a guessed origin, which would
 * make a drag starting off-canvas read as a tap.
 *
 * The button is checked BEFORE the distance, and both are checked independently
 * of `down`, so the two guards cannot be reordered into one that lets a
 * right-click through.
 */
export function isPickGesture(
  down: PointerOrigin | undefined,
  up: PickPointer,
): boolean {
  if (up.button !== PRIMARY_BUTTON) return false;
  if (down === undefined) return false;
  const moved = Math.abs(up.clientX - down.x) + Math.abs(up.clientY - down.y);
  return moved <= PICK_MOVE_TOLERANCE_PX;
}
