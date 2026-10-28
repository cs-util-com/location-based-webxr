/**
 * A finger's long press, timed by the page: iOS sends no context menu for
 * one, so the 3D view's ground menu would have no way to open there. One
 * finger held down and still (within `tolerancePx` of where it went down)
 * for `holdMs` fires once, at the point it went down. A move past the
 * tolerance, a second finger, a release or a cancel before then stops it
 * for that press.
 *
 * @see long-press.ts.md
 */

/** Screen point, CSS px. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** The long press's numbers: about half a second, and the tap's
 *  tolerance (a finger moving less is still a tap, `INPUT.tapPx`). */
export const LONG_PRESS = Object.freeze({ holdMs: 500, tolerancePx: 8 });

export interface LongPress {
  /** A finger went down: the first starts the hold, a second stops it. */
  down(pointerId: number, at: Point): void;
  /** A finger moved: past the tolerance the hold stops. */
  move(pointerId: number, at: Point): void;
  /** A finger went up or was cancelled. */
  end(pointerId: number): void;
  /** Stop the hold under way (a gizmo drag took the press). */
  cancel(): void;
}

export function createLongPress(deps: {
  readonly holdMs: number;
  readonly tolerancePx: number;
  readonly schedule: (run: () => void, ms: number) => number;
  readonly cancel: (id: number) => void;
  readonly fire: (at: Point) => void;
}): LongPress {
  const holdMs =
    Number.isFinite(deps.holdMs) && deps.holdMs > 0
      ? deps.holdMs
      : LONG_PRESS.holdMs;
  const tolerancePx =
    Number.isFinite(deps.tolerancePx) && deps.tolerancePx >= 0
      ? deps.tolerancePx
      : LONG_PRESS.tolerancePx;
  let held: { pointerId: number; at: Point; timer: number } | null = null;
  const down = new Set<number>();

  const stop = (): void => {
    if (held === null) return;
    deps.cancel(held.timer);
    held = null;
  };

  return {
    down(pointerId, at) {
      down.add(pointerId);
      if (down.size > 1) {
        stop();
        return;
      }
      stop();
      const timer = deps.schedule(() => {
        const was = held;
        held = null;
        if (was !== null) deps.fire(was.at);
      }, holdMs);
      held = { pointerId, at, timer };
    },
    move(pointerId, at) {
      if (held === null || pointerId !== held.pointerId) return;
      if (Math.hypot(at.x - held.at.x, at.y - held.at.y) > tolerancePx) stop();
    },
    end(pointerId) {
      down.delete(pointerId);
      if (held !== null && pointerId === held.pointerId) stop();
    },
    cancel: stop,
  };
}
