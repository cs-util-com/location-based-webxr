# key-target.ts

## Purpose

Says whose a key is, by the element it was pressed on: a field's, a
menu's, or a toolbar's or radio group's. The desktop editor's page keys run on the window (the 3D view's
nudges, turns, deletes and copies, `editor3d-input.ts` through the page's
`keysFree`; the shell's T, F and Home, `editor-shell/editor-shell.ts`;
the page's Ctrl+Z, `edit-main.ts`), so they also see the keys a field or
a menu answers itself, and leave those alone.

## Public API

- `inField(target)` -> `boolean`: an `<input>`, a `<textarea>`, a
  `<select>`, or an element whose `isContentEditable` is true.
- `inMenu(target, key)` -> `boolean`: `key` is the menu's - every key
  when the target is inside an element with `role="menu"`; when it is
  inside (or is) an element with `aria-haspopup="menu"` (a menu button;
  `menu-button.ts` marks both), only the pattern's keys
  (`MENU_BUTTON_KEYS`: ArrowDown, ArrowUp, Enter, Space, Escape). Home
  and End on a closed menu's button are the page's.
- `inComposite(target, key)` -> `boolean`: `key` is an arrow, Home or End
  and the target is inside (or is) an element with `role="toolbar"` or
  `role="radiogroup"` (the long-text writer's toolbar and view picker,
  which move their focus by those keys). Any modifier counts the same.
- All three take any `EventTarget | null` and answer false for anything
  that is not an element (the window, the document, null).

## Invariants & assumptions

- A menu's keys are the menu button pattern's: inside an open menu the
  arrows, Home and End move between its items and Escape closes it
  (`menu-button.ts`); on its button ArrowDown and ArrowUp open it, Enter
  and Space open it as a click does, and Escape closes it when open.
  Inside an open menu the page's keys stand back from every key; on the
  button only from those five. Home and End do nothing on the button
  itself, so they stay the page's there: the shell's Home frames the
  whole tour whether or not View's button has the focus. A
  letter on the button is the page's: a click on View's Top view puts the
  focus back on View's button, and T must still toggle the top view there
  (typeahead was decided against, so no letter is a menu's).
- Inside a toolbar or a radio group the page's keys stand back from the
  arrows, Home and End only: without this an arrow on a toolbar button
  also nudged the selected sign (an undo step) and Home framed the tour.
  Letters, Delete and Escape there stay the page's.
- A button that opens a dialog (`aria-haspopup="dialog"`) is not a menu's.
- The shell asks `inMenu` FIRST, before the help's Escape: with the help
  open, Escape in a menu closes the menu (the help closes on the next).
- The page's Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y stay out of fields only:
  in a menu they still undo and redo.

## Examples

```ts
window.addEventListener("keydown", (event) => {
  if (inField(event.target) || inMenu(event.target, event.key)) return;
  if (event.code === "KeyT") toggleTop();
});
```

## Tests

- `key-target.test.ts` (jsdom): the field kinds, an editable element, a
  plain button, null and the window; a menu, its item and an element
  inside the item, a menu button and an element inside it; a dialog's
  button and the body are not a menu's; a toolbar's and a radio
  group's arrows, Home and End (on the group, a button and an element in
  it) are theirs and their other keys are not.
- The Tour Viewer's `editor-shell/editor-shell.test.ts` ("the page keys next to a toolbar"):
  Home on a toolbar button frames nothing; on a plain button it frames the
  tour. The 3D view's nudge reads the same predicate through the page's
  `keysFree` (`edit-main.ts`, which has no unit seam).
- `key-target.property.test.ts` (jsdom): over generated element trees,
  any target and any key, `inMenu` against the rule walked by hand up the
  ancestors, and `inField` by the target's own kind alone. Shown failing
  by scratch mutations (Home among the button's keys, a field read from
  an enclosing menu).
- End to end: `playwright-tests/editor3d-edit.spec.js` ("keys pressed in
  a menu stay in the menu"): with a pin selected in 3D, View opened by
  ArrowDown, then ArrowDown, ArrowDown, End, Home, T and Escape change
  nothing, move neither the pin nor the camera and leave the top view
  off; Home on the closed menu's button then frames the whole tour (the
  page's key); with the help open, Escape in a
  menu closes the menu. `editor3d-shell.spec.js`: T on View's button,
  after Top view from the menu, toggles the top view off.
