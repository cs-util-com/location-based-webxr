/**
 * Pure UV-rectangle geometry shared by every in-world panel.
 *
 * Both the transport panel (component 1) and the paginated text panel
 * (component 2) express their controls as normalized rectangles in a plane's UV
 * space and hit-test taps against them. This module owns the `Rect` type and the
 * point-in-rect test so that shared logic is defined once (jscpd) and reused by
 * each component's own `hitTo…Intent` mapping.
 *
 * UV convention matches `THREE.PlaneGeometry` intersection UVs: origin (0,0) is
 * the bottom-left of the front face, u → right, v → up.
 */

/** A rectangle in normalized panel UV space ([0,1] × [0,1]). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Whether the UV point (u, v) lies within `rect` (edges inclusive). */
export function contains(rect: Rect, u: number, v: number): boolean {
  return (
    u >= rect.x && u <= rect.x + rect.w && v >= rect.y && v <= rect.y + rect.h
  );
}
