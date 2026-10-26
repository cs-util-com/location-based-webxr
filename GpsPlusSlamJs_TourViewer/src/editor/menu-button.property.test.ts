// @vitest-environment jsdom
/**
 * Why this property matters: the File menu's items come and go (Save a
 * copy disabled while no tour is open, the keep-the-debug-data switch
 * hidden for a tour without a walk), and an arrow key that lands on a
 * disabled or hidden item leaves a keyboard user on nothing. Over
 * generated menus and key sequences: while the menu is open the focus is
 * always on a usable item (or on the button when none is usable), each
 * arrow step moves exactly one usable item along (wrapping), and Escape
 * always ends closed with the focus on the button.
 */
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { createMenuButton } from "./menu-button.js";

type Key = "ArrowDown" | "ArrowUp" | "Home" | "End";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("menu button: properties over generated menus and keys", () => {
  it("the focus stays on a usable item and steps one usable item at a time", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("usable", "disabled", "hidden"), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(fc.constantFrom<Key>("ArrowDown", "ArrowUp", "Home", "End"), {
          maxLength: 30,
          size: "max",
        }),
        (kinds, keys) => {
          document.body.innerHTML = `<button id="b" type="button">File</button><div id="m">${kinds
            .map(
              (kind, i) =>
                `<button role="menuitem" type="button" id="i${String(i)}"${
                  kind === "disabled" ? " disabled" : ""
                }${kind === "hidden" ? " hidden" : ""}>${String(i)}</button>`,
            )
            .join("")}</div>`;
          const button = document.getElementById("b") as HTMLButtonElement;
          const menu = document.getElementById("m") as HTMLElement;
          const menuButton = createMenuButton({ button, menu });
          const usable = kinds
            .map((kind, i) => (kind === "usable" ? `i${String(i)}` : null))
            .filter((id): id is string => id !== null);
          const focused = () => (document.activeElement as HTMLElement).id;
          button.click();
          expect(focused()).toBe(usable[0] ?? "b");
          for (const key of keys) {
            const before = usable.indexOf(focused());
            menu.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true }),
            );
            // With no usable item the focus stays on the button.
            const n = usable.length;
            const expected =
              key === "Home"
                ? 0
                : key === "End"
                  ? n - 1
                  : key === "ArrowDown"
                    ? (before + 1) % n
                    : (before - 1 + n) % n;
            expect(focused()).toBe(n === 0 ? "b" : usable[expected]);
          }
          menu.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          expect(menuButton.isOpen()).toBe(false);
          expect(focused()).toBe("b");
        },
      ),
      { numRuns: 300 },
    );
    // 300 generated menus of up to 30 keys each, in jsdom (its
    // getComputedStyle, focus and innerHTML are most of it): about 2 s
    // alone, 2.9-4.7 s beside another package's unit tests, and 5.0 and
    // 8.8 s in the two loaded gate runs it failed (2026-10-25/26), past the
    // default 5 s. The time out is for a hang, not for a slow machine.
  }, 30_000);
});
