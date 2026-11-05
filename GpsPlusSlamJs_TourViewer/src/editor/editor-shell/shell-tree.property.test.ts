// @vitest-environment jsdom
/**
 * Why these tests matter: a folded station in the tree is ONE line - its
 * number chip, then its name beside it, the name cut with an ellipsis
 * when it is longer than the dock - whatever the creator called it. A
 * name is free text from the tour file: any length, spaces, line breaks,
 * markup-looking characters. Whatever it is, the folded card must draw
 * the same one-row structure (no picture, no description, no items), set
 * the name as text (never markup), keep the full name in the row
 * button's title and accessible name, and its stylesheet must hold the
 * row to one fixed-height line (no wrap, cut with an ellipsis). What a
 * browser lays out is checked in `playwright-tests/editor3d-tree.spec.js`;
 * this is the part that holds for every name without one.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { initialEditorViewState } from "../editor-view.js";
import type { ShellPictures } from "./shell-pictures.js";
import { drawTree } from "./shell-tree.js";
import { buildTree, type TreeModel } from "./tree-model.js";

const pictures: ShellPictures = {
  show: () => undefined,
  sweep: () => undefined,
  clear: () => undefined,
};

/** A station named `title`, with a photo, a description and a pin. */
function station(id: string, title: string): TourStation {
  return {
    id,
    title,
    description: "A line about it",
    geo: { lat: 48.1371, lon: 11.5754, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: `${id}-photo`,
        kind: "picture",
        view: "plane",
        image: "photo",
        widthM: 1,
        createdAtIso: "2026-11-03T10:00:00Z",
        pose: { position: [1, 1, 1], rotation: [0, 0, 0, 1] },
      },
    ],
  } as unknown as TourStation;
}

/** Names of any length: short, long, with spaces, breaks and markup. */
const names = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.string({ minLength: 40, maxLength: 400 }),
  fc
    .array(fc.constantFrom("The", "old", "gate", "<b>", "&amp;", "\n", " "), {
      maxLength: 80,
    })
    .map((words) => words.join(" ")),
);

/** The tree of `stations`, every station folded; their photo an image. */
function treeOf(stations: TourStation[]): TreeModel {
  return buildTree({
    stations,
    assets: [
      {
        id: "photo",
        path: "content/photo.jpg",
        kind: "image",
        width: 4,
        height: 3,
      },
    ],
    codes: [],
    view: initialEditorViewState,
    layers: [],
  });
}

/** The body of the tree drawn for `stations`, every station folded. */
function drawn(stations: TourStation[]): HTMLElement {
  document.body.innerHTML = `<aside id="t"><button id="s"></button>
    <button id="f"></button><div id="b"></div></aside>`;
  const body = document.getElementById("b") as HTMLElement;
  drawTree(
    {
      root: document.getElementById("t") as HTMLElement,
      stationsHead: document.getElementById("s") as HTMLButtonElement,
      fold: document.getElementById("f") as HTMLButtonElement,
      body,
    },
    treeOf(stations),
    false,
    pictures,
  );
  return body;
}

describe("a folded station's row", () => {
  it("is one row of a number chip and the name beside it, for any name", () => {
    fc.assert(
      fc.property(fc.array(names, { minLength: 1, maxLength: 6 }), (list) => {
        const stations = list.map((name, i) => station(`s${String(i)}`, name));
        const body = drawn(stations);
        const cards = [...body.querySelectorAll<HTMLElement>(".card")];
        expect(cards).toHaveLength(list.length);
        const model = treeOf(stations);
        cards.forEach((card, i) => {
          const title = model.cards[i]?.title ?? "";
          // One child: the row. No picture, description or items.
          expect([...card.children].map((c) => c.className)).toEqual(["head"]);
          const head = card.children[0] as HTMLElement;
          // The explorer row: grip, fold arrow, the button, the count of
          // its one photo, then its "+".
          expect([...head.children].map((c) => c.className)).toEqual([
            "grip",
            "tw",
            "pick",
            "meta",
            "ib add",
          ]);
          // The "+" names its station whatever the name holds.
          expect(head.querySelector(".add")?.getAttribute("aria-label")).toBe(
            `Add to "${title}"`,
          );
          const pick = head.querySelector<HTMLButtonElement>(".pick");
          expect([...(pick?.children ?? [])].map((c) => c.tagName)).toEqual([
            "SPAN",
            "SPAN",
          ]);
          expect(pick?.querySelector(".n")?.textContent).toBe(String(i + 1));
          const nm = pick?.querySelector(".nm");
          // The name is text, never markup, whole in the page.
          expect(nm?.textContent).toBe(title);
          expect(nm?.children).toHaveLength(0);
          // The full name stays readable where the ellipsis cuts it.
          expect(pick?.title).toBe(title);
          expect(pick?.textContent).toBe(`${String(i + 1)}${title}`);
          expect(card.querySelector("br, img, .pic, .ds, .kids")).toBeNull();
        });
      }),
      { numRuns: 60 },
    );
  });
});

describe("the row's stylesheet", () => {
  // From the package's folder (a jsdom test's `import.meta.url` is no
  // file URL).
  const css = readFileSync("src/editor/editor-shell/editor-shell.css", "utf8");
  /** The declarations of the rule whose selector is exactly `selector`. */
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("holds the row to one 28 px line, the name cut with an ellipsis", () => {
    const head = rule(".card > .head");
    expect(head).toMatch(/\bdisplay: flex;/);
    expect(head).toMatch(/\balign-items: center;/);
    expect(head).toMatch(/\bheight: 28px;/);
    const pick = rule(".head .pick");
    expect(pick).toMatch(/\bdisplay: flex;/);
    expect(pick).toMatch(/\balign-items: center;/);
    expect(pick).toMatch(/\bmin-width: 0;/);
    const name = rule(".head .nm");
    expect(name).toMatch(/\bwhite-space: nowrap;/);
    expect(name).toMatch(/\boverflow: hidden;/);
    expect(name).toMatch(/\btext-overflow: ellipsis;/);
    expect(name).toMatch(/\bmin-width: 0;/);
    // The chip never shrinks or wraps beside a long name.
    const chip = rule(".head .n");
    expect(chip).toMatch(/\bflex: none;/);
    expect(chip).toMatch(/\bwhite-space: nowrap;/);
  });
});
