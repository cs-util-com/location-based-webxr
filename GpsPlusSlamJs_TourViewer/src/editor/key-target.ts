/**
 * Whose a key is, by its target: a field's (typing, its own undo) or a
 * menu's (the menu button pattern's arrows, Home, End and Escape,
 * `menu-button.ts`). The editor's page keys - the 3D view's nudges and
 * deletes, the shell's T, F and Home, the page's undo - run on the
 * window, so they see these keys too and leave them alone.
 *
 * @see key-target.ts.md
 */

/** A text field, a text area, a select, or an editable element: a key
 *  there goes to the field's own undo (typing in the card, a dialog, the
 *  search), and the page's stays out of it. */
export function inField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

/** Inside a menu, or on (or inside) a button that opens one. */
export function inMenu(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="menu"], [aria-haspopup="menu"]') !== null
  );
}
