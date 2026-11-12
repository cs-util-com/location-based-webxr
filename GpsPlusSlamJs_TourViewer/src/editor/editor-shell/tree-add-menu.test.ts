/**
 * Why these tests matter: a station row's "+" adds in place through this
 * menu, from the mouse and from the keyboard alone. The focus must come
 * back to the station's "+" before the add runs (the add's redraw keeps
 * it there by the station's id: `editor-shell.test.ts`), or a keyboard
 * user is dropped to the page's top after every add. The menu's Escape
 * must stop there (the page's Escape drops the selection), and an item
 * that is off must add nothing.
 *
 * @vitest-environment jsdom
 */
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_CHOICES } from "../../kinds/edit-kinds.js";
import {
  addMenuSpot,
  createTreeAddMenu,
  type TreeAddChoice,
} from "./tree-add-menu.js";

/** A tree body with one station's "+". */
function plusFor(body: HTMLElement, id: string): HTMLButtonElement {
  const plus = document.createElement("button");
  plus.type = "button";
  plus.dataset["add"] = id;
  body.append(plus);
  return plus;
}

let body: HTMLElement;
let choose: ReturnType<typeof vi.fn<(id: string, kind: TreeAddChoice) => void>>;

beforeEach(() => {
  body = document.createElement("div");
  document.body.replaceChildren(body);
  choose = vi.fn<(id: string, kind: TreeAddChoice) => void>();
});

afterEach(() => {
  document.body.replaceChildren();
});

function opened() {
  const menu = createTreeAddMenu({
    body,
    host: document.body,
    choose,
    chooseForStory: vi.fn(),
  });
  const plus = plusFor(body, "gate");
  plus.focus();
  menu.openFor(plus, "gate", "The old gate");
  const root = document.getElementById("tree-add-menu");
  if (root === null) throw new Error("no menu");
  const item = (kind: string) =>
    root.querySelector<HTMLElement>(`[data-kind="${kind}"]`);
  return { menu, plus, root, item };
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

// Why: the + of a story adds into that story, the + of a station adds to
// the station, and the menu's head says which: two places behind one look
// is where an entry lands in the wrong one. A story holds no story, so the
// menu must not offer one there.
describe("the menu for a story", () => {
  function forStory() {
    const chooseForStory =
      vi.fn<(id: string, kind: Exclude<TreeAddChoice, "story">) => void>();
    const menu = createTreeAddMenu({
      body,
      host: document.body,
      choose,
      chooseForStory,
    });
    const plus = document.createElement("button");
    plus.dataset["storyadd"] = "legend";
    body.append(plus);
    plus.focus();
    menu.openForStory(plus, "legend", "The legend");
    const root = document.getElementById("tree-add-menu");
    if (root === null) throw new Error("no menu");
    return { menu, plus, root, chooseForStory };
  }

  it("names the story, offers no story, and adds into it", () => {
    const { root, plus, chooseForStory } = forStory();
    expect(root.querySelector(".mhead")?.textContent).toBe(
      'Add to the story "The legend"',
    );
    expect(root.getAttribute("aria-label")).toBe(
      'Add to the story "The legend"',
    );
    const story = root.querySelector<HTMLElement>('[data-kind="story"]');
    expect(story?.closest("[hidden]")).not.toBeNull();
    root.querySelector<HTMLElement>('[data-kind="longText"]')?.click();
    expect(chooseForStory).toHaveBeenCalledWith("legend", "longText");
    expect(choose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(plus);
  });

  it("skips the hidden story item from the keys", () => {
    const { root } = forStory();
    key(root, "End");
    expect((document.activeElement as HTMLElement).dataset["kind"]).toBe(
      "character",
    );
    key(root, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset["kind"]).toBe(
      "shortText",
    );
  });

  // Why: a video plays only in a story, so a story's menu is where it is
  // added; it must be on there, saying what it is.
  it("offers a video in a story", () => {
    const { root, chooseForStory } = forStory();
    const video = root.querySelector<HTMLElement>('[data-kind="video"]');
    expect(video?.getAttribute("aria-disabled")).toBeNull();
    expect(video?.textContent).toContain("A video file, played in a story");
    video?.click();
    expect(chooseForStory).toHaveBeenCalledWith("legend", "video");
  });

  // Why: a character is made in the maker before it is added, so it has an
  // item of its own; it must reach the story it was asked for, not its
  // station.
  it("offers a character, added into the story", () => {
    const { root, chooseForStory } = forStory();
    root.querySelector<HTMLElement>('[data-kind="character"]')?.click();
    expect(chooseForStory).toHaveBeenCalledWith("legend", "character");
    expect(choose).not.toHaveBeenCalled();
  });

  it("offers a story again on a station's +", () => {
    const { menu, root } = forStory();
    menu.close(false);
    const plus = plusFor(body, "gate");
    menu.openFor(plus, "gate", "The old gate");
    const story = root.querySelector<HTMLElement>('[data-kind="story"]');
    expect(story?.closest("[hidden]")).toBeNull();
    story?.click();
    expect(choose).toHaveBeenCalledWith("gate", "story");
  });
});

describe("createTreeAddMenu", () => {
  it("opens as a menu titled by its station, the focus on its first item, the video and the character off with their reasons", () => {
    const { root, item } = opened();
    expect(root.hidden).toBe(false);
    expect(root.getAttribute("role")).toBe("menu");
    expect(root.getAttribute("aria-label")).toBe("Add to The old gate");
    expect(root.querySelector(".mhead")?.textContent).toBe(
      "Add to The old gate",
    );
    expect(document.activeElement).toBe(item("shortText"));
    expect(
      document
        .querySelector('[data-add="gate"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (i) => i.dataset["kind"],
      ),
    ).toEqual([...ADD_CHOICES.map((c) => c.kind), "character", "story"]);
    const character = item("character");
    expect(character?.getAttribute("aria-disabled")).toBeNull();
    expect(character?.textContent).toContain("character maker");
    const video = item("video");
    expect(video?.getAttribute("aria-disabled")).toBe("true");
    expect(video?.textContent).toContain(
      "A video plays in a story: add it to one",
    );
    for (const kind of ["longText", "picture", "audio", "model"]) {
      expect(item(kind)?.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("moves with the arrows, Home, End and a letter, through the items that are off too", () => {
    const { root, item } = opened();
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("longText"));
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("picture"));
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("video"));
    key(root, "End");
    expect(document.activeElement).toBe(item("story"));
    key(root, "ArrowUp");
    expect(document.activeElement).toBe(item("character"));
    key(root, "ArrowDown");
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("shortText"));
    key(root, "ArrowUp");
    expect(document.activeElement).toBe(item("story"));
    key(root, "Home");
    expect(document.activeElement).toBe(item("shortText"));
    key(root, "l");
    expect(document.activeElement).toBe(item("longText"));
    key(root, "s");
    expect(document.activeElement).toBe(item("audio"));
    key(root, "s");
    expect(document.activeElement).toBe(item("story"));
    key(root, "s");
    expect(document.activeElement).toBe(item("shortText"));
  });

  it("adds the kind chosen to its station, closed first, the focus back on the station's +", () => {
    const { root, item, plus } = opened();
    item("longText")?.click();
    expect(root.hidden).toBe(true);
    expect(choose).toHaveBeenCalledWith("gate", "longText");
    expect(document.activeElement).toBe(plus);
    expect(plus.getAttribute("aria-expanded")).toBe("false");
  });

  // Why: on a phone the details cover a folded tree, so the station's +
  // cannot take the focus; a keyboard would land on nothing.
  it("goes back to the button pressed while the station's + is out of sight", () => {
    const { menu, plus } = opened();
    plus.closest("div")?.classList.add("collapsed");
    const details = document.createElement("button");
    document.body.append(details);
    menu.close(false);
    menu.openFor(details, "gate", "Gate");
    menu.close(true);
    expect(document.activeElement).toBe(details);
  });

  it("adds nothing for an item that is off, and stays open", () => {
    const { root, item } = opened();
    // A station's video is off: it plays in a story only.
    item("video")?.click();
    expect(choose).not.toHaveBeenCalled();
    expect(root.hidden).toBe(false);
  });

  it("closes on Escape with the focus back on the +, the page's Escape not reached", () => {
    const { root, plus } = opened();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    const event = key(document.activeElement as Element, "Escape");
    document.removeEventListener("keydown", page);
    expect(root.hidden).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(page).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(plus);
  });

  it("closes on Tab and on a press outside, the focus left where it goes", () => {
    const { menu, root, plus } = opened();
    key(root, "Tab");
    expect(root.hidden).toBe(true);
    menu.openFor(plus, "gate", "The old gate");
    expect(menu.isOpen()).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe("addMenuSpot", () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 250, height: 120 };

  it("opens under the button, rightwards from 20 px left of its right edge", () => {
    expect(
      addMenuSpot({ top: 100, right: 400, bottom: 128 }, size, view),
    ).toEqual({ left: 380, top: 130 });
  });

  it("keeps 8 px inside the window's edges and opens above where there is no room below", () => {
    expect(
      addMenuSpot({ top: 700, right: 20, bottom: 728 }, size, view),
    ).toEqual({ left: 8, top: 578 });
    expect(
      addMenuSpot({ top: 10, right: 2000, bottom: 30 }, size, view).left,
    ).toBe(742);
  });

  it("is inside the window wherever the button is, when the menu fits in it (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 770 }),
        (right, top) => {
          const spot = addMenuSpot(
            { top, right, bottom: top + 28 },
            size,
            view,
          );
          expect(spot.left).toBeGreaterThanOrEqual(8);
          expect(spot.left + size.width).toBeLessThanOrEqual(view.width - 8);
          expect(spot.top).toBeGreaterThanOrEqual(8);
          expect(spot.top + size.height).toBeLessThanOrEqual(view.height - 8);
        },
      ),
    );
  });
});
