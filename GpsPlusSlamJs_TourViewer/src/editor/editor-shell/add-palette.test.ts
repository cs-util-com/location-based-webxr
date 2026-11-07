/**
 * Why these tests matter: the palette is a keyboard user's way to add
 * anything anywhere. Its field keeps the focus while the arrows move the
 * row Enter adds, so a screen reader must hear that row through
 * `aria-activedescendant`; it must close before it adds (the add redraws
 * the tree) and give the focus back where it was; its Escape must not
 * reach the page, which would drop the selection; and Ctrl+K must not be
 * Ctrl+Shift+K or Ctrl+Alt+K, which belong to others.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaletteAdd } from "./add-palette-model.js";
import { createAddPalette, isPaletteKey } from "./add-palette.js";

const STATIONS = [
  { id: "column", number: 1, title: "The Marian column" },
  { id: "gate", number: 2, title: "The old gate" },
];

let add: ReturnType<typeof vi.fn<(what: PaletteAdd) => void>>;
let start: HTMLButtonElement;

beforeEach(() => {
  start = document.createElement("button");
  document.body.replaceChildren(start);
  add = vi.fn<(what: PaletteAdd) => void>();
});

afterEach(() => {
  document.body.replaceChildren();
});

function opened(selected: string | null = "gate") {
  const palette = createAddPalette({
    host: document.body,
    stations: () => STATIONS,
    selectedStation: () => selected,
    add,
  });
  start.focus();
  palette.open();
  const field = document.getElementById(
    "add-palette-input",
  ) as HTMLInputElement;
  const box = document.getElementById("add-palette") as HTMLElement;
  const options = () => [
    ...document.querySelectorAll<HTMLElement>(
      '#add-palette-list [role="option"]',
    ),
  ];
  return { palette, field, box, options };
}

function key(target: Element, k: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function type(field: HTMLInputElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("createAddPalette", () => {
  it("opens with the focus in its field, the selection's rows listed, the first the active one", () => {
    const { field, box, options } = opened();
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(field);
    expect(options().map((o) => o.textContent)).toEqual([
      "Short textin 2 The old gate",
      "Long textin 2 The old gate",
      "New stationat the centre of the view",
    ]);
    expect(field.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("narrows as it is typed, and Enter adds the first row, closed first, the focus back", () => {
    const { field, box } = opened();
    type(field, "long column");
    add.mockImplementation(() => {
      expect(box.hidden).toBe(true);
    });
    key(field, "Enter");
    expect(add).toHaveBeenCalledWith({ kind: "longText", stationId: "column" });
    expect(document.activeElement).toBe(start);
  });

  it("moves the row Enter adds with the arrows, round at either end", () => {
    const { field, options } = opened();
    key(field, "ArrowUp");
    expect(field.getAttribute("aria-activedescendant")).toBe(options()[2]?.id);
    key(field, "ArrowDown");
    key(field, "ArrowDown");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    key(field, "Enter");
    expect(add).toHaveBeenCalledWith({ kind: "longText", stationId: "gate" });
  });

  it("adds a row clicked", () => {
    const { options, box } = opened();
    options()[2]?.click();
    expect(add).toHaveBeenCalledWith({ kind: "station" });
    expect(box.hidden).toBe(true);
  });

  it("adds nothing when nothing matches, and says so", () => {
    const { field, options, box } = opened();
    type(field, "zebra");
    expect(options()).toEqual([]);
    expect(field.getAttribute("aria-activedescendant")).toBeNull();
    expect(document.querySelector(".pempty")?.textContent).toContain(
      "Nothing matches",
    );
    key(field, "Enter");
    expect(add).not.toHaveBeenCalled();
    expect(box.hidden).toBe(false);
  });

  it("closes on Escape with the focus back, the page's Escape not reached", () => {
    const { field, box } = opened();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    const event = key(field, "Escape");
    document.removeEventListener("keydown", page);
    expect(box.hidden).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(page).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(start);
    expect(add).not.toHaveBeenCalled();
  });

  it("closes on Tab and on a press on its backdrop, adding nothing", () => {
    const { palette, field, box } = opened();
    key(field, "Tab");
    expect(box.hidden).toBe(true);
    // Back where it was opened, so the Tab moves on from there: the palette
    // is the page's last element and has nothing after it.
    expect(document.activeElement).toBe(start);
    palette.open();
    document
      .getElementById("add-palette-back")
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(palette.isOpen()).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it("opens again empty, the rows of the selection then", () => {
    const { palette, field } = opened();
    type(field, "long");
    key(field, "Escape");
    palette.open();
    expect(field.value).toBe("");
  });
});

describe("isPaletteKey", () => {
  const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("is Ctrl+K and Cmd+K, by letter or by place on a non-Latin layout", () => {
    expect(isPaletteKey(press({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isPaletteKey(press({ key: "K", metaKey: true }))).toBe(true);
    expect(isPaletteKey(press({ key: "л", code: "KeyK", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("is not K alone, nor with Shift or Alt, nor another letter at K's place", () => {
    expect(isPaletteKey(press({ key: "k" }))).toBe(false);
    expect(
      isPaletteKey(press({ key: "K", ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(isPaletteKey(press({ key: "k", ctrlKey: true, altKey: true }))).toBe(
      false,
    );
    // Dvorak's T sits where QWERTY's K is.
    expect(isPaletteKey(press({ key: "t", code: "KeyK", ctrlKey: true }))).toBe(
      false,
    );
  });
});

describe("the palette's kind chips and marks", () => {
  const texts = (rows: readonly HTMLElement[]) =>
    rows.map((r) => r.querySelector(".pl")?.textContent);

  // Why: the chips narrow by kind on a touch screen, where typing costs the
  // most; a press must not take the focus from the field (the keyboard
  // would drop), and a second press must give every kind back.
  it("narrows the rows by a chip, the field keeping the focus", () => {
    const { field, options } = opened();
    const chips = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "#add-palette .pfil .chip",
      ),
    ];
    expect(chips.map((c) => c.textContent)).toEqual([
      "Short text",
      "Long text",
      "Station",
    ]);
    const long = chips[1] as HTMLButtonElement;
    const press = new Event("pointerdown", { bubbles: true, cancelable: true });
    long.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    long.click();
    expect(long.getAttribute("aria-pressed")).toBe("true");
    expect(texts(options())).toEqual(["Long text"]);
    expect(document.activeElement).toBe(field);
    long.click();
    expect(long.getAttribute("aria-pressed")).toBe("false");
    expect(texts(options())).toEqual([
      "Short text",
      "Long text",
      "New station",
    ]);
  });

  it("starts each open with no chip on", () => {
    const { palette, options } = opened();
    document
      .querySelector<HTMLButtonElement>(
        '#add-palette .pfil [data-pf="shortText"]',
      )
      ?.click();
    palette.close(false);
    palette.open();
    expect(texts(options())).toEqual([
      "Short text",
      "Long text",
      "New station",
    ]);
    expect(
      document.querySelectorAll('#add-palette .chip[aria-pressed="true"]'),
    ).toHaveLength(0);
  });

  // Why: the mark shows why a row is listed; a name comes from a file
  // anyone can write, so it must arrive as text, never as markup.
  it("marks the words found in a row, as text", () => {
    const { field } = opened();
    type(field, "gate");
    expect(
      [...document.querySelectorAll("#add-palette .pt mark")].map(
        (m) => m.textContent,
      ),
    ).toContain("gate");
    STATIONS.push({ id: "x", number: 3, title: "<b>gate</b>" });
    try {
      type(field, "gate");
      expect(document.querySelector("#add-palette .pt b")).toBeNull();
    } finally {
      STATIONS.pop();
    }
  });
});
