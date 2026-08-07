# `sheet-drag.ts`

**Purpose.** Let the mobile map sheet be dragged up and down over the full-bleed 3D view, and keep both views from ever vanishing.

## Public API

- `clampSheetHeight(fraction): number` — constrains to `[MIN_SHEET_FRACTION, MAX_SHEET_FRACTION]`. Pure.
- `MIN_SHEET_FRACTION` (0.2), `MAX_SHEET_FRACTION` (0.8).
- `attachSheetDrag({ handle, bounds, onResize })` → a detach function. Writes `--sheet-height` onto `bounds`; the stylesheet does the rest.

## Invariants & assumptions

- **Neither view may reach zero height.** Dragged to an extreme, one view disappears — and with it the handle that would bring it back, so the app is stuck until reload. That is why the clamp is a separate, tested, pure function rather than a `Math.min` inline in a listener.
- **`clampSheetHeight` is total, including `NaN`.** A `NaN` height renders as `height: NaN%`, which the browser silently ignores: the sheet would simply stop responding with nothing logged anywhere. `NaN` clamps to the minimum.
- **The sheet IS the splitter (DEC-10 / D8).** Once the map is a bottom sheet, "make the area I care about bigger" is dragging it — there is no second resize affordance to design or explain.
- **Pointer events, not touch + mouse.** One code path covers finger, pen and mouse, and `setPointerCapture` keeps the drag alive when the pointer leaves the 24 px handle, which it does immediately on a phone.
- **The height is a CUSTOM PROPERTY, not an inline style, and that fixes two bugs.** The stylesheet declares `var(--sheet-height, 45%)` for both the sheet and the handle, so the handle sits on the sheet's edge from **first paint**. While the drag handler alone set the offset, the absolutely-positioned bar fell back to its static position — the top of the grid container — leaving a 24 px handle floating over the 3D view ~400 px from the sheet it resizes. And because only the mobile media query reads the property for the sheet height, a phone dragged and then rotated past the breakpoint no longer carries a stale height into the desktop grid.
- **`onResize` is not optional.** Both canvases size themselves from their container and neither notices a container that changed without a window resize; without it the map renders into stale dimensions after every drag.
- Wired unconditionally rather than behind a breakpoint check: on desktop the handle is `display: none`, so the listeners cost nothing, and a JS breakpoint could disagree with the one in the stylesheet.

## Examples

```ts
attachSheetDrag({
  handle: document.getElementById("sheet-handle"),
  bounds: document.querySelector("main"),
  onResize: () => {
    mapView.map.invalidateSize();
    buildingView.resize();
  },
});
```

## Tests

- `sheet-drag.test.ts` — a normal drag is preserved; both extremes clamp so neither view vanishes; the limits leave room for both; and nonsense input (`NaN`, `Infinity`) is total.
- `playwright-tests/` — _"puts the 3D view behind a draggable map sheet"_, at a 390×780 viewport: the 3D view fills the main area, the map is a full-width bottom sheet over it, **the grab bar starts on the sheet's edge before any drag**, and dragging it grows the sheet. That pre-drag assertion is load-bearing: the drag itself grabs the bar wherever it happens to be and the first move snaps to the clamp, so it passes whether or not the bar started in the right place.
