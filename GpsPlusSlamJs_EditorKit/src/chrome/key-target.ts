/**
 * Whose a key is, by its target: a field's (typing, its own undo), a
 * menu's (the menu button pattern's keys, `menu-button.ts`) or a
 * toolbar's or radio group's (their arrows, Home and End). The editor's page keys - the 3D view's nudges and
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

/** The keys a menu's button answers (the menu button pattern): the
 *  arrows, Enter and Space open its menu, Escape closes it. Home and End
 *  move only inside an open menu, so on the button they stay the page's
 *  (the shell's Home frames the whole tour). */
const MENU_BUTTON_KEYS: ReadonlySet<string> = new Set([
  "ArrowDown",
  "ArrowUp",
  "Enter",
  " ",
  "Escape",
]);

/** `key` is the menu's: any key inside a menu, and on (or inside) a
 *  button that opens one the keys that open or close it. A letter on
 *  the button stays the page's (View's Top view by a click puts the focus
 *  back on View's button, and T must still toggle it). */
export function inMenu(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="menu"]') !== null) return true;
  return (
    MENU_BUTTON_KEYS.has(key) &&
    target.closest('[aria-haspopup="menu"]') !== null
  );
}

/** The keys a toolbar and a radio group move their focus by. */
const COMPOSITE_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

/** `key` is a toolbar's or a radio group's: an arrow, Home or End
 *  inside an element with `role="toolbar"` or `role="radiogroup"` (the
 *  long-text writer's toolbar and view picker). Any other key there stays
 *  the page's. */
export function inComposite(target: EventTarget | null, key: string): boolean {
  return (
    COMPOSITE_KEYS.has(key) &&
    target instanceof Element &&
    target.closest('[role="toolbar"], [role="radiogroup"]') !== null
  );
}
