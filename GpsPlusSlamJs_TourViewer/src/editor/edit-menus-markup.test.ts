// @vitest-environment jsdom
/**
 * Why these tests matter: the editor's menus are the page's markup
 * (`edit.html`), and two of their accessibility contracts live there, out
 * of every script's sight. A menu item disabled by the `disabled`
 * attribute cannot take the focus, so a screen reader passes over it as
 * if it were not there (the menu button pattern keeps it reachable with
 * `aria-disabled`, `menu-button.ts`); and a shortcut shown as a visible
 * `<kbd>` was read into the item's name ("Save Ctrl+S") instead of being
 * announced as its shortcut (`aria-keyshortcuts`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = new DOMParser().parseFromString(
  readFileSync(resolve(packageRoot, "edit.html"), "utf8"),
  "text/html",
);
// The menus get their role from menu-button.ts at run time: named by id.
const items = [
  ...page.querySelectorAll<HTMLElement>(
    ':is(#file-menu, #edit-menu, #view-menu) [role^="menuitem"]',
  ),
];

describe("edit.html's menu items", () => {
  it("are never disabled by the attribute that takes their focus", () => {
    expect(items.length).toBeGreaterThanOrEqual(12);
    for (const item of items) {
      expect(item.hasAttribute("disabled"), item.id).toBe(false);
    }
  });

  it("announce a shown shortcut as the item's shortcut, not as its words", () => {
    const withKeys = items.filter((item) => item.querySelector("kbd") !== null);
    for (const item of withKeys) {
      for (const kbd of item.querySelectorAll("kbd")) {
        expect(kbd.getAttribute("aria-hidden"), item.id).toBe("true");
      }
    }
    expect(
      Object.fromEntries(
        withKeys.map((item) => [
          item.id,
          item.getAttribute("aria-keyshortcuts"),
        ]),
      ),
    ).toEqual({
      "file-save": "Control+S",
      "edit-undo": "Control+Z",
      "edit-redo": "Control+Shift+Z",
      "studio-top": "T",
      "studio-frame": "F",
    });
  });
});
