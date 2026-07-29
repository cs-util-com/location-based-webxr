/**
 * Dragging the mobile map sheet up and down.
 *
 * WHY A SHEET RATHER THAN A SPLITTER. On a phone the two-row grid gave each view
 * half the height and the 3D pane was a letterbox. DEC-10 makes the 3D view fill
 * the viewport with the map as a full-width sheet over it — and once the map is
 * a sheet, "let me make the area I care about bigger" (D8) is just dragging it,
 * with no separate resize affordance to design. It is also the pattern the
 * RecorderApp's map browser already settled on.
 *
 * WHY THE CLAMP IS THE INTERESTING PART. Dragged to either extreme one view
 * disappears — and with it the handle that would bring it back, so the app is
 * stuck until a reload. The clamp is pure and tested for that reason; the rest
 * of this file is three pointer listeners.
 *
 * @see sheet-drag.ts.md
 */

/** Smallest sheet, as a fraction of the main area. Leaves the map usable. */
export const MIN_SHEET_FRACTION = 0.2;

/** Largest sheet. Leaves enough 3D visible to be worth having behind it. */
export const MAX_SHEET_FRACTION = 0.8;

/**
 * Constrains a sheet height to the range where BOTH views survive.
 *
 * Total over every input, including `NaN`: a `NaN` height renders as
 * `height: NaN%`, which the browser silently ignores, so the sheet would stop
 * responding with nothing logged anywhere. `NaN` clamps to the minimum.
 */
export function clampSheetHeight(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return fraction === Number.POSITIVE_INFINITY
      ? MAX_SHEET_FRACTION
      : MIN_SHEET_FRACTION;
  }
  return Math.min(MAX_SHEET_FRACTION, Math.max(MIN_SHEET_FRACTION, fraction));
}

export interface SheetDragOptions {
  /** The grab bar. */
  readonly handle: HTMLElement;
  /** The element whose height the drag sets — the map container. */
  readonly sheet: HTMLElement;
  /** The area the fraction is measured against. */
  readonly bounds: HTMLElement;
  /** Called after every height change, so the views can resize their canvases. */
  readonly onResize: () => void;
}

/**
 * Wires the handle to the sheet.
 *
 * Pointer events rather than touch + mouse: one code path covers finger, pen and
 * mouse, and `setPointerCapture` keeps the drag alive when the pointer leaves
 * the 24 px handle — which it does immediately on a phone.
 */
export function attachSheetDrag(options: SheetDragOptions): () => void {
  const { handle, sheet, bounds, onResize } = options;

  const apply = (fraction: number): void => {
    const clamped = clampSheetHeight(fraction);
    sheet.style.height = `${(clamped * 100).toFixed(2)}%`;
    // The handle rides the top edge of the sheet, so it is always grabbable at
    // the boundary the user is actually moving.
    handle.style.bottom = `${(clamped * 100).toFixed(2)}%`;
    onResize();
  };

  const onMove = (event: PointerEvent): void => {
    const box = bounds.getBoundingClientRect();
    if (box.height === 0) return;
    // Measured from the BOTTOM: the sheet is anchored there, so a pointer
    // higher up means a taller sheet.
    apply((box.bottom - event.clientY) / box.height);
  };

  const onDown = (event: PointerEvent): void => {
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", onMove);
    event.preventDefault();
  };

  const onUp = (event: PointerEvent): void => {
    handle.removeEventListener("pointermove", onMove);
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);

  return () => {
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    handle.removeEventListener("pointermove", onMove);
  };
}
