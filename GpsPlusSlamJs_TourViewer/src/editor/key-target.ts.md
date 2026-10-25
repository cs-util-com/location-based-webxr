# key-target.ts

## Purpose

Says whose a key is, by the element it was pressed on: a field's or a
menu's. The desktop editor's page keys run on the window (the 3D view's
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
  (`MENU_BUTTON_KEYS`: ArrowDown, ArrowUp, Home, End, Enter, Space,
  Escape).
- Both take any `EventTarget | null` and answer false for anything that
  is not an element (the window, the document, null).

## Invariants & assumptions

- A menu's keys are the menu button pattern's: the arrows, Home and End
  move in it, Escape closes it (`menu-button.ts`). On a menu's button,
  ArrowDown and ArrowUp open it. Inside an open menu the page's keys stand
  back from every key; on the button only from the pattern's keys. A
  letter on the button is the page's: a click on View's Top view puts the
  focus back on View's button, and T must still toggle the top view there
  (typeahead was decided against, so no letter is a menu's).
- A button that opens a dialog (`aria-haspopup="dialog"`) is not a menu's.
- The shell asks `inMenu` FIRST, before the help's Escape: with the help
  open, Escape in a menu closes the menu (the help closes on the next).
- The page's Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y stay out of fields only:
  in a menu they still undo and redo.

## Examples

```ts
window.addEventListener("keydown", (event) => {
  if (inField(event.target) || inMenu(event.target)) return;
  if (event.code === "KeyT") toggleTop();
});
```

## Tests

- `key-target.test.ts` (jsdom): the field kinds, an editable element, a
  plain button, null and the window; a menu, its item and an element
  inside the item, a menu button and an element inside it; a dialog's
  button and the body are not a menu's.
- End to end: `playwright-tests/editor3d-edit.spec.js` ("keys pressed in
  a menu stay in the menu"): with a pin selected in 3D, View opened by
  ArrowDown, then ArrowDown, ArrowDown, End, Home, T and Escape, and Home
  on the closed menu's button, change nothing, move neither the pin nor
  the camera and leave the top view off; with the help open, Escape in a
  menu closes the menu. `editor3d-shell.spec.js`: T on View's button,
  after Top view from the menu, toggles the top view off.
