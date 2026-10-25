// @vitest-environment jsdom
/**
 * Why these tests matter: the editor's page keys (the 3D view's nudges,
 * the shell's T, F and Home) run on the window, so they also see keys a
 * field or a menu answers itself. A key typed in a field, or an arrow
 * moving through a menu (or opening one from its button), must not also
 * move the selected pin or the camera behind it. These pin which targets
 * keep their keys: the fields, and every element of a menu or a menu's
 * button - and that the rest of the page does not.
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

  it("an item of a menu, the menu itself and a menu's button are the menu's", () => {
    document.body.innerHTML = `
      <button id="btn" aria-haspopup="menu"><span id="lbl">View</span></button>
      <div id="menu" role="menu">
        <button id="item" role="menuitem"><kbd id="kbd">T</kbd></button>
      </div>
      <button id="dialog-btn" aria-haspopup="dialog">Details</button>
      <button id="plain">Help</button>`;
    for (const id of ["#btn", "#lbl", "#menu", "#item", "#kbd"]) {
      expect(inMenu(at(id)), id).toBe(true);
    }
    // A button that opens a dialog is not a menu's.
    expect(inMenu(at("#dialog-btn"))).toBe(false);
    expect(inMenu(at("#plain"))).toBe(false);
    expect(inMenu(document.body)).toBe(false);
    expect(inMenu(null)).toBe(false);
    expect(inMenu(window)).toBe(false);
  });
});
