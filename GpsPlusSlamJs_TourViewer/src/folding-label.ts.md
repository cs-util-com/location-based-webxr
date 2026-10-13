# folding-label.ts

## Purpose

A HUD chip whose label folds to its icon after its first use (polish round
M3, the owner's D-P4 on the H1 strip): remembered per device, and a long
press shows the label again. Used for the creator's "Place a pin" and
"Take a photo" chips in AR (`main.ts`).

## Public API

- `wireFoldingLabel({ button, key, label, store, now })` - wires one chip.
  - `button` carries its icon and a `.chip-label`; the page's CSS hides the
    label while `data-folded="true"` is set.
  - `label` is set as the `aria-label`, folded or not (an icon-only chip
    keeps its name).
  - `store` is `localStorage` (or null): the folded state is kept under
    `tour-viewer.hud.folded.<key>` (`"1"` folded, `"0"` unfolded); `main.ts`
    passes the page's one guarded store (`stepStoreOrUndefined`).
  - `schedule(fn, ms)` is a one-shot timer returning its cancel
    (`setTimeout` on the page).
- `LONG_PRESS_MS` (500) - a press at least this long unfolds instead of
  acting.
- `FoldStore`, `FoldingButton` - the structural types (the unit tests pass
  plain objects).

## Invariants & assumptions

- A click that follows a long press is swallowed in the capture phase
  (`preventDefault` + `stopImmediatePropagation`; capture runs first at the
  target whatever the registration order), so a long press never also
  places a pin.
- A tap (shorter than `LONG_PRESS_MS`) runs the chip's action and folds the
  label, remembered (`"1"`); a press held for `LONG_PRESS_MS` unfolds it
  while the finger is down - a phone ends a long press in the context menu,
  not a click - remembered as `"0"`; the context menu is suppressed.
- Storage that throws (a private window, blocked site data) is treated as
  none: the chip keeps working, unfolded at each load.
- A disabled chip fires no click, so it neither acts nor folds.

## Examples

```ts
wireFoldingLabel({
  button: element("setup-pin"),
  key: "setup-pin",
  label: "Place a pin",
  store: window.localStorage,
  now: () => performance.now(),
});
```

## Tests

- `folding-label.test.ts` - unfolded until first used, then folded and
  remembered; the accessible name kept; a long press unfolds without
  acting; no storage and throwing storage; every press shorter than the
  threshold is a tap (property); a touch long press that ends in the
  context menu unfolds; a cancelled press neither acts nor unfolds.
