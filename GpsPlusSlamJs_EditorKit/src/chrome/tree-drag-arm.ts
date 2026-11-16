/**
 * When a press on a drag grip becomes a drag (`tree-drag.ts`'s `arm`):
 * a finger must rest on the grip first, so a flick that happens to start
 * on it is no reorder; a mouse or a pen drags once it has moved a little,
 * so a click is none. Pure: the times are the events' own, which keeps
 * the rule the same however late the page handles them.
 *
 * @see tree-drag-arm.ts.md
 */

/** How a press on a grip becomes a drag. */
export interface TreeDragArm {
  /** How long a finger rests on the grip before a move drags (ms). */
  readonly holdMs: number;
  /** How far a finger may stray while it rests (px); further, the press
   *  drags nothing. */
  readonly tolerancePx: number;
  /** How far a mouse or a pen moves before it drags (px). */
  readonly movePx: number;
}

/** What a press on a grip is so far: not yet decided, a drag, or no drag
 *  at all (a finger that moved before it rested). */
export type ArmState = "wait" | "drag" | "none";

/** Whether `arm` is a rule `armState` can follow: every value a finite
 *  number, none below 0. */
export function armIsValid(arm: TreeDragArm): boolean {
  return [arm.holdMs, arm.tolerancePx, arm.movePx].every(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
}

/**
 * A press by a `pointer` (the event's `pointerType`) moved `distancePx`
 * from where it went down, `ms` after it. A finger's (`touch`) drags once
 * it has rested `holdMs`, and drags nothing if it strayed past
 * `tolerancePx` before; any other pointer drags from `movePx` on. A move
 * that is not numbers drags nothing.
 */
export function armState(
  arm: TreeDragArm,
  press: {
    readonly pointer: string;
    readonly distancePx: number;
    readonly ms: number;
  },
): ArmState {
  const { pointer, distancePx, ms } = press;
  if (!Number.isFinite(distancePx) || !Number.isFinite(ms)) return "none";
  if (pointer !== "touch") return distancePx >= arm.movePx ? "drag" : "wait";
  if (ms >= arm.holdMs) return "drag";
  return distancePx > arm.tolerancePx ? "none" : "wait";
}
