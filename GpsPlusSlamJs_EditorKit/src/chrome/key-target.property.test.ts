// @vitest-environment jsdom
/**
 * Why these properties matter: the page's keys run on the window and ask
 * `inField` and `inMenu` whose a key is, from wherever the focus happens
 * to be: deep inside a menu item, on a label inside a menu's button, on a
 * plain element next to one. The example tests pin one small tree. Over
 * generated trees and keys, these read the answer against the rule walked
 * by hand up the target's ancestors: a key is the menu's exactly when an
 * element at or above the target is a menu, or when it is one of the keys
 * that open or close a menu and an element at or above the target is a
 * menu's button; a target is a field exactly when it is an input, a text
 * area, a select or editable, whatever is around it.
 */
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { inField, inMenu } from "./key-target.js";

afterEach(() => {
  document.body.innerHTML = "";
});

/** One element of a generated tree: its kind and its children. */
interface Node {
  readonly kind: (typeof KINDS)[number];
  readonly children: readonly Node[];
}

const KINDS = [
  "div",
  "span",
  "menu",
  "menu-button",
  "dialog-button",
  "menuitem",
  "input",
  "textarea",
  "select",
  "editable",
] as const;

const tree: fc.Arbitrary<Node> = fc.letrec<{ node: Node }>((tie) => ({
  node: fc.record({
    kind: fc.constantFrom(...KINDS),
    // A leaf at least as often as a branch, so the trees stay finite.
    children: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.constant([]),
      fc.array(tie("node"), { maxLength: 3 }),
    ),
  }),
})).node;

/** Builds `node` under `parent`; returns every element made. */
function build(node: Node, parent: Element): HTMLElement[] {
  const tag = ["input", "textarea", "select"].includes(node.kind)
    ? node.kind
    : node.kind.endsWith("button") || node.kind === "menuitem"
      ? "button"
      : node.kind === "span"
        ? "span"
        : "div";
  const el = document.createElement(tag);
  if (node.kind === "menu") el.setAttribute("role", "menu");
  if (node.kind === "menuitem") el.setAttribute("role", "menuitem");
  if (node.kind === "menu-button") el.setAttribute("aria-haspopup", "menu");
  if (node.kind === "dialog-button") {
    el.setAttribute("aria-haspopup", "dialog");
  }
  // jsdom has no editing host: the property is what the rule reads.
  Object.defineProperty(el, "isContentEditable", {
    value: node.kind === "editable",
  });
  parent.append(el);
  // An input, a text area or a select holds no elements.
  const kids = ["input", "textarea", "select"].includes(tag)
    ? []
    : node.children.flatMap((child) => build(child, el));
  return [el, ...kids];
}

/** The target and its ancestors, walked by hand. */
function selfAndAncestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    out.push(at);
  }
  return out;
}

const OPEN_CLOSE = ["ArrowDown", "ArrowUp", "Enter", " ", "Escape"];

const key = fc.constantFrom(
  ...OPEN_CLOSE,
  "Home",
  "End",
  "t",
  "T",
  "f",
  "Delete",
  "ArrowLeft",
  "z",
);

describe("key targets over generated trees (property)", () => {
  it("a key is the menu's exactly by the rule, from any target", () => {
    fc.assert(
      fc.property(tree, fc.nat(), key, (root, pick, k) => {
        document.body.innerHTML = "";
        const all = build(root, document.body);
        const target = all[pick % all.length]!;
        const chain = selfAndAncestors(target);
        const inAMenu = chain.some((e) => e.getAttribute("role") === "menu");
        const onAButton = chain.some(
          (e) => e.getAttribute("aria-haspopup") === "menu",
        );
        expect(inMenu(target, k)).toBe(
          inAMenu || (OPEN_CLOSE.includes(k) && onAButton),
        );
      }),
    );
  });

  it("a target is a field by its own kind alone", () => {
    fc.assert(
      fc.property(tree, fc.nat(), (root, pick) => {
        document.body.innerHTML = "";
        const all = build(root, document.body);
        const target = all[pick % all.length]!;
        const own =
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable;
        expect(inField(target)).toBe(own);
      }),
    );
  });
});
