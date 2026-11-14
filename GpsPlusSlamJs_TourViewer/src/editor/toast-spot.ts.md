# toast-spot.ts

## Purpose

Where the editor's toasts stand in a short window (a phone held
sideways): at the 3D view's bottom-left corner, beside the map controls,
instead of their usual place over the map controls row. In a window that
short the usual place is the middle of the view, where the selection's
gizmo stands, and a toast there took the press meant for the gizmo (an
undo and a redo toast stand six seconds, while the next gesture follows
at once).

## Public API

- `toastSpot(view, controls, win) -> ToastSpot | null`, pure.
  - `view`: the 3D view's canvas box (`#view3d canvas`), `controls`: the
    map controls' box (`#map-controls`), both in CSS px from the window's
    top left (a `DOMRect` fits); `win`: the window's size.
  - Returns `{ left, right, bottom }`, px from the window's left, right and
    bottom edge: 12 px in from the view's left; right up to 8 px short of
    the map controls when they stand at the view's foot (their bottom
    within 80 px over it), else 12 px short of the view's right edge;
    level with the controls' bottom, else 14 px over the view's foot.
  - `null` keeps the usual place: a window taller than
    `SHORT_WINDOW_MAX_H` (560 px), no view or an empty one, or less than
    160 px of room (a toast squeezed thinner would stand taller than the
    view).
- `placeToasts(el, spot)`: writes the spot as the element's inline
  `left`, `right` and `bottom` and marks it `in-view`; `null` clears all
  of them, so the next toast in a tall window has the usual place back.
- `SHORT_WINDOW_MAX_H`: 560.

## Invariants

- The spot stands inside the view and clear of the map controls (a
  property test over view and control positions).
- `edit-main.ts`'s `toast()` places the toasts each time one is shown,
  only in the 3D view; a window resized while a toast shows keeps the old
  place until the next toast.
- The CSS (`editor-shell.css`, `#toasts.in-view`) left-aligns the stack
  and shows the newest toast alone, so the stack never climbs over the
  gizmo; an older toast shows again once the newer ones go. A toast with
  an Undo hidden under a newer one keeps its Undo in the top bar and on
  Ctrl+Z.

## Examples

```ts
placeToasts(
  toasts,
  toastSpot(canvas.getBoundingClientRect(), controls.getBoundingClientRect(), {
    width: innerWidth,
    height: innerHeight,
  }),
);
```

## Tests

- `toast-spot.test.ts`: the sideways phone's place, the height bound, the
  controls elsewhere or hidden, no room, the property, the placement and
  its clearing.
- `playwright-tests/editor3d-folders.spec.js`, "the undo and redo toasts
  keep clear of the gizmo": the toasts' boxes clear of the gizmo and a
  press on the gizmo while they show, by mouse and touch, sideways, on a
  phone and on a desktop.
