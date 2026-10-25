// @vitest-environment jsdom
/**
 * Why these tests matter: the editor's page keys (the 3D view's nudges,
 * the shell's T, F and Home) run on the window, so they also see keys a
 * field or a menu answers itself. A key typed in a field, or an arrow
 * moving through a menu (or opening one from its button), must not also
 * move the selected pin or the camera behind it. These pin which targets
 * keep their keys: the fields, every key inside a menu, and on a menu's
 * button the keys that open its menu or move in it - while a letter on
 * the button (T after View's Top view put the focus back there) stays the
 * page's, and the rest of the page keeps every key.
 */
import { afterEach, describe, expect, it } from "vitest";

import { inField, inMenu } from "./key-target.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function at(selector: string): Element {
  const found = document.querySelector(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

describe("key targets", () => {
  it("a text field, a text area, a select and an editable element are fields", () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><select id="s"></select>
      <div id="e" contenteditable="true"></div><button id="b">Go</button>`;
    for (const id of ["#i", "#t", "#s"]) expect(inField(at(id))).toBe(true);
    // jsdom has no editing host: the property is what the page reads.
    Object.defineProperty(at("#e"), "isContentEditable", { value: true });
    expect(inField(at("#e"))).toBe(true);
    expect(inField(at("#b"))).toBe(false);
    expect(inField(null)).toBe(false);
    expect(inField(window)).toBe(false);
  });

  it("every key inside a menu is the menu's; on its button, only the keys that open or move in it", () => {
    document.body.innerHTML = `
      <button id="btn" aria-haspopup="menu"><span id="lbl">View</span></button>
      <div id="menu" role="menu">
        <button id="item" role="menuitem"><kbd id="kbd">T</kbd></button>
      </div>
      <button id="dialog-btn" aria-haspopup="dialog">Details</button>
      <button id="plain">Help</button>`;
    const patternKeys = [
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
      "Enter",
      " ",
      "Escape",
    ];
    for (const id of ["#menu", "#item", "#kbd"]) {
      for (const key of [...patternKeys, "t", "f", "Delete"]) {
        expect(inMenu(at(id), key), `${id} ${key}`).toBe(true);
      }
    }
    for (const id of ["#btn", "#lbl"]) {
      for (const key of patternKeys) {
        expect(inMenu(at(id), key), `${id} ${key}`).toBe(true);
      }
      // The page's keys on a closed menu's button: T, F, Delete.
      for (const key of ["t", "T", "f", "Delete", "ArrowLeft"]) {
        expect(inMenu(at(id), key), `${id} ${key}`).toBe(false);
      }
    }
    // A button that opens a dialog is not a menu's.
    expect(inMenu(at("#dialog-btn"), "ArrowDown")).toBe(false);
    expect(inMenu(at("#plain"), "ArrowDown")).toBe(false);
    expect(inMenu(document.body, "ArrowDown")).toBe(false);
    expect(inMenu(null, "ArrowDown")).toBe(false);
    expect(inMenu(window, "ArrowDown")).toBe(false);
  });
});
