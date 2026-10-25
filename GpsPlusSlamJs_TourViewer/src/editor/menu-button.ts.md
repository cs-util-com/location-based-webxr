# menu-button.ts

## Purpose

A menu button by the WAI-ARIA menu button pattern: a button that opens a
menu of commands. The desktop editor's top bar has three: File, View, and
Edit (the 3D view's Undo and Redo at a phone's width) (`edit.html`,
`edit-main.ts`).

## Public API

- `createMenuButton({ button, menu })` -> `MenuButton`:
  - `button` - the `<button>` that opens the menu; it needs an `id` (the
    menu's `aria-labelledby`);
  - `menu` - the element holding the items; it needs an `id` (the
    button's `aria-controls`). Its items are its `[role="menuitem"]`,
    `[role="menuitemcheckbox"]` and `[role="menuitemradio"]` elements.
  - Throws when either has no `id`.
- `MenuButton`:
  - `isOpen()`;
  - `open(at = "first")` - open on the first (or `"last"`) usable item;
  - `close(returnFocus)` - close; with `returnFocus` the focus goes back
    to the button.

## Invariants & assumptions

- At creation: the button gets `aria-haspopup="menu"`,
  `aria-expanded="false"` and `aria-controls`; the menu gets `role="menu"`,
  `aria-labelledby` and `hidden`; every item `tabindex="-1"` (items are
  reached by the arrow keys, never by Tab).
- **Usable items** are the items neither `hidden`, nor `disabled`, nor
  `aria-disabled="true"`, nor `display: none` by the page's styles (the
  View menu's Top view and Frame over the map). The arrow keys move through them only, wrapping;
  Home and End jump. With no usable item the focus stays on the button.
- **Opening:** a click, Enter or Space (they click a button) and
  ArrowDown open on the first usable item, ArrowUp on the last. The open
  button carries the class `on`.
- **Closing:** Escape (focus back to the button; the event stops there, so
  the page's own Escape, which deselects, does not run as well); Tab (no
  focus change: the focus moves on); a click on an item (after the item's
  own handler; the focus goes back to the button unless the handler moved
  it elsewhere, e.g. into a dialog); a press (pointerdown) outside the
  menu and its button; a second click on the button; another menu opening
  (one is open at a time, module state).
- **Placement:** on opening, the menu takes its place from the page's
  styles (`left` cleared); if its right edge would pass the window's
  less 8 px, it moves left by that much, but never so far that its left
  edge comes within 8 px of the window's (`style.left`, negative px).
- The roles, words and checked states of the items are the page's; this
  module never writes them, except `tabindex`.
- Touch: everything goes through clicks, so a tap opens, a tap on an item
  runs it, and a tap outside closes.

## Examples

```ts
const file = createMenuButton({
  button: document.getElementById("file-menu-btn") as HTMLButtonElement,
  menu: document.getElementById("file-menu") as HTMLElement,
});
saveItem.addEventListener("click", save); // the menu closes after it
```

## Tests

- `menu-button.test.ts` (jsdom) - the attributes, a click and the arrow
  keys opening, the arrows skipping disabled and hidden items and
  wrapping, Home and End, Escape's focus return and that it stops there,
  Tab, an item's click closing the menu (focus back, or kept where the
  item moved it), a press outside, one menu at a time, a menu with no
  usable item, an item hidden by a style skipped, the move back inside the
  window and its left-edge limit (stubbed boxes: jsdom has no layout),
  the missing-id refusal.
- `menu-button.property.test.ts` (jsdom) - over generated menus (usable,
  disabled and hidden items) and key sequences: the focus is always on a
  usable item and each key moves it as the pattern says; Escape ends
  closed with the focus on the button.
- End to end: `playwright-tests/editor3d-shell.spec.js` (the File and
  View menus from the keyboard, Edit by touch at a phone's width),
  `editor.spec.js` (the menus inside the window at 390 and 1280 px) and every editor spec through
  `playwright-tests/editor-menus.js`.
