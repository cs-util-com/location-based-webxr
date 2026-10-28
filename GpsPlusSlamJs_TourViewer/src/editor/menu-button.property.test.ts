// @vitest-environment jsdom
/**
 * Why this property matters: the File menu's items come and go (Save a
 * copy disabled while no tour is open, the keep-the-debug-data switch
 * hidden for a tour without a walk, the 3D view's commands hidden by a
 * style over the map), and an arrow key that lands on a hidden item leaves
 * a keyboard user on nothing. Over generated menus - items usable,
 * disabled the pattern's way (`aria-disabled`: reachable, inert), disabled
 * by the attribute (which cannot take the focus), hidden by the attribute
 * or by a style - and key sequences, including keys pressed with the
 * focus moved off every item: while the menu is open the focus is always
 * on a reachable item (or on the button when none is), each arrow step
 * moves exactly one reachable item along (wrapping; from no item, ArrowDown
 * goes to the first and ArrowUp to the last), and Escape always ends
 * closed with the focus on the button.
 */
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { createMenuButton } from "./menu-button.js";

type Key = "ArrowDown" | "ArrowUp" | "Home" | "End";
/** A key, or the focus moved off the items (a press elsewhere that kept
 *  the menu open: the next key starts from no item). */
type Step = Key | "blur";
type Kind = "usable" | "off" | "disabled" | "hidden" | "styled";

const ATTRIBUTE: Readonly<Record<Kind, string>> = {
  usable: "",
  off: ' aria-disabled="true"',
  disabled: " disabled",
  hidden: " hidden",
  styled: ' class="styled"',
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("menu button: properties over generated menus and keys", () => {
  it("the focus stays on a reachable item and steps one reachable item at a time", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Kind>(
            "usable",
            "off",
            "disabled",
            "hidden",
            "styled",
          ),
          { minLength: 1, maxLength: 8 },
        ),
        fc.array(
          fc.constantFrom<Step>("ArrowDown", "ArrowUp", "Home", "End", "blur"),
          { maxLength: 30, size: "max" },
        ),
        (kinds, steps) => {
          document.body.innerHTML = `<style>.styled { display: none; }</style><button id="b" type="button">File</button><div id="m">${kinds
            .map(
              (kind, i) =>
                `<button role="menuitem" type="button" id="i${String(i)}"${ATTRIBUTE[kind]}>${String(i)}</button>`,
            )
            .join("")}</div>`;
          const button = document.getElementById("b") as HTMLButtonElement;
          const menu = document.getElementById("m") as HTMLElement;
          const menuButton = createMenuButton({ button, menu });
          const reachable = kinds
            .map((kind, i) =>
              kind === "usable" || kind === "off" ? `i${String(i)}` : null,
            )
            .filter((id): id is string => id !== null);
          const focused = () => (document.activeElement as HTMLElement).id;
          button.click();
          expect(focused()).toBe(reachable[0] ?? "b");
          for (const step of steps) {
            if (step === "blur") {
              (document.activeElement as HTMLElement).blur();
              continue;
            }
            const before = reachable.indexOf(focused());
            menu.dispatchEvent(
              new KeyboardEvent("keydown", { key: step, bubbles: true }),
            );
            // With no reachable item the focus stays on the button.
            const n = reachable.length;
            const expected =
              step === "Home"
                ? 0
                : step === "End"
                  ? n - 1
                  : step === "ArrowDown"
                    ? (before + 1) % n
                    : before < 0
                      ? n - 1
                      : (before - 1 + n) % n;
            expect(focused()).toBe(n === 0 ? "b" : reachable[expected]);
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
