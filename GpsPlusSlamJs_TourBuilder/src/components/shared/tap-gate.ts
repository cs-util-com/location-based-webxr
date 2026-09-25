/**
 * Pure tap-vs-drag gate for pointer picking.
 *
 * Decides whether a pointer down→up pair is a *tap* (a select) rather than an
 * OrbitControls camera-drag or a long-press. Pure so the thresholds are
 * unit-tested; `pointer-tap-picker.ts` owns the DOM listeners and the
 * multi-touch bookkeeping and asks this predicate the one question that
 * matters.
 */

/** One pointer event reduced to what the gate needs. */
export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

const DRAG_TOLERANCE_PX = 5;
const MAX_TAP_MS = 400;

/** True when the pointer moved ≤ 5 px and was released within 400 ms. */
export function isTap(down: PointerSample, up: PointerSample): boolean {
  const movedPx = Math.hypot(up.x - down.x, up.y - down.y);
  return movedPx <= DRAG_TOLERANCE_PX && up.timeMs - down.timeMs <= MAX_TAP_MS;
}
