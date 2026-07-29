# `sheet-drag.ts`

**Purpose.** Let the mobile map sheet be dragged up and down over the full-bleed 3D view, and keep both views from ever vanishing.

## Public API

- `clampSheetHeight(fraction): number` — constrains to `[MIN_SHEET_FRACTION, MAX_SHEET_FRACTION]`. Pure.
- `MIN_SHEET_FRACTION` (0.2), `MAX_SHEET_FRACTION` (0.8).
- `attachSheetDrag({ handle, sheet, bounds, onResize })` → a detach function.

## Invariants & assumptions

- **Neither view may reach zero height.** Dragged to an extreme, one view disappears — and with it the handle that would bring it back, so the app is stuck until reload. That is why the clamp is a separate, tested, pure function rather than a `Math.min` inline in a listener.
- **`clampSheetHeight` is total, including `NaN`.** A `NaN` height renders as `height: NaN%`, which the browser silently ignores: the sheet would simply stop responding with nothing logged anywhere. `NaN` clamps to the minimum.
- **The sheet IS the splitter (DEC-10 / D8).** Once the map is a bottom sheet, "make the area I care about bigger" is dragging it — there is no second resize affordance to design or explain.
- **Pointer events, not touch + mouse.** One code path covers finger, pen and mouse, and `setPointerCapture` keeps the drag alive when the pointer leaves the 24 px handle, which it does immediately on a phone.
- **The handle rides the sheet's top edge**, so it is always grabbable at the boundary the user is moving.
- **`onResize` is not optional.** Both canvases size themselves from their container and neither notices a container that changed without a window resize; without it the map renders into stale dimensions after every drag.
- Wired unconditionally rather than behind a breakpoint check: on desktop the handle is `display: none`, so the listeners cost nothing, and a JS breakpoint could disagree with the one in the stylesheet.

## Examples

```ts
attachSheetDrag({
  handle: document.getElementById("sheet-handle"),
  sheet: document.getElementById("map"),
  bounds: document.querySelector("main"),
  onResize: () => {
    mapView.map.invalidateSize();
    buildingView.resize();
  },
});
```

## Tests

- `sheet-drag.test.ts` — a normal drag is preserved; both extremes clamp so neither view vanishes; the limits leave room for both; and nonsense input (`NaN`, `Infinity`) is total.
- `playwright-tests/osm-demo.spec.js` — _"puts the 3D view behind a draggable map sheet"_, at a 390×780 viewport: the 3D view fills the main area, the map is a full-width bottom sheet over it, and dragging the handle grows it.
