/**
 * Where the editor's toasts stand in a short window: at the 3D view's
 * bottom-left corner, beside the map controls, so they never cover the
 * middle of the view, where the selection's gizmo stands.
 */

/** A box on the page (CSS px from the window's top left). */
export interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The toasts' place: px from the window's left, right and bottom edge. */
export interface ToastSpot {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

/** The tallest window that counts as short (a phone held sideways). */
export const SHORT_WINDOW_MAX_H = 560;

/** The toasts' margin from the view's edges. */
const EDGE_PX = 12;
/** The map controls' margin from the view's foot (`#map-controls`). */
const FOOT_PX = 14;
/** The gap kept to the map controls. */
const CONTROLS_GAP_PX = 8;
/** How high over the view's foot map controls count as standing at it. */
const FOOT_REACH_PX = 80;
/** The narrowest place worth giving the toasts. */
const MIN_WIDTH_PX = 160;

function shows(r: Rect | null): r is Rect {
  return r !== null && r.right > r.left && r.bottom > r.top;
}

/**
 * The toasts' place for a window of `win`, the 3D view's canvas at `view`
 * and the map controls at `controls`; `null` keeps their usual place (a
 * window taller than {@link SHORT_WINDOW_MAX_H}, no view, or no room of
 * at least 160 px beside the controls).
 */
export function toastSpot(
  view: Rect | null,
  controls: Rect | null,
  win: { readonly width: number; readonly height: number },
): ToastSpot | null {
  if (win.height > SHORT_WINDOW_MAX_H || !shows(view)) return null;
  const left = view.left + EDGE_PX;
  const atFoot =
    shows(controls) &&
    controls.bottom <= view.bottom &&
    controls.bottom > view.bottom - FOOT_REACH_PX;
  const rightEdge = atFoot
    ? controls.left - CONTROLS_GAP_PX
    : view.right - EDGE_PX;
  if (rightEdge - left < MIN_WIDTH_PX) return null;
  const bottom = atFoot ? controls.bottom : view.bottom - FOOT_PX;
  return {
    left,
    right: win.width - rightEdge,
    bottom: win.height - bottom,
  };
}

/** Stand the toasts' element at `spot`, or give it its usual place. */
export function placeToasts(el: HTMLElement, spot: ToastSpot | null): void {
  el.classList.toggle("in-view", spot !== null);
  el.style.left = spot === null ? "" : `${String(spot.left)}px`;
  el.style.right = spot === null ? "" : `${String(spot.right)}px`;
  el.style.bottom = spot === null ? "" : `${String(spot.bottom)}px`;
}
