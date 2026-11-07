// @vitest-environment jsdom
/**
 * Why these tests matter: the tree is the 3D view's way into the tour,
 * and it must work from the keyboard too: every card, item row and code
 * row a button (Tab reaches it, Enter and Space press it), no button
 * inside another (a browser cannot tell which one was pressed), and the
 * focus kept on the same control when a press redraws the tree - else a
 * keyboard user is thrown back to the top of the page after every
 * selection. The drawing is checked from the page's own store: what the
 * folds and the selection say is what the tree shows.
 */
import {
  createEmptyTourManifest,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { manifestToWrite, tourDocumentActions } from "../../tour-document.js";
import { createTourViewerStore } from "../../tour-viewer-session.js";
import { editorViewActions, editorViewReducer } from "../editor-view.js";
import type { ShellPictures } from "./shell-pictures.js";
import { drawTree } from "./shell-tree.js";
import { buildTree, type TreeModel } from "./tree-model.js";

const AT = "2026-10-22T10:00:00Z";

const STATIONS = [
  {
    id: "gate",
    title: "The old gate",
    description: "Where the wall stood",
    geo: { lat: 48.1371, lon: 11.5754, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    blocks: [
      {
        id: "photo-1",
        kind: "picture",
        view: "plane",
        image: "photo-1",
        widthM: 1,
        caption: "The arch",
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
    ],
  },
  {
    id: "steps",
    title: "The town hall steps",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    steps: [],
    blocks: [],
  },
] as unknown as TourStation[];

/** The photo's own image asset: a captured photo's file. */
const PHOTO_ASSET = {
  id: "photo-1",
  path: "content/photo-1.jpg",
  kind: "image" as const,
  width: 4,
  height: 3,
};

const CODES = [{ id: "level-1", title: "Code 1", meta: "Printed code" }];

const store = createTourViewerStore(undefined, {
  editorView: editorViewReducer,
});
store.dispatch(
  tourDocumentActions.opened({
    manifest: {
      ...createEmptyTourManifest(),
      assets: [PHOTO_ASSET],
      stations: STATIONS,
    },
  }),
);

let dock: {
  root: HTMLElement;
  stationsHead: HTMLButtonElement;
  fold: HTMLButtonElement;
  body: HTMLElement;
};
const shown: string[] = [];
const pictures: ShellPictures = {
  show: (_el, path) => shown.push(path),
  sweep: vi.fn(),
  clear: vi.fn(),
};

beforeEach(() => {
  document.body.innerHTML = `<aside id="t"><div><button id="s"></button>
    <button id="f"></button></div><div id="b"></div></aside>`;
  dock = {
    root: document.getElementById("t") as HTMLElement,
    stationsHead: document.getElementById("s") as HTMLButtonElement,
    fold: document.getElementById("f") as HTMLButtonElement,
    body: document.getElementById("b") as HTMLElement,
  };
  shown.length = 0;
  store.dispatch(editorViewActions.selected({ id: null }));
  store.dispatch(editorViewActions.stationFolded({ id: "gate", open: false }));
  store.dispatch(editorViewActions.stationFolded({ id: "steps", open: false }));
});

/** The tree's model from the store as it stands, for `query`. */
function model(query = ""): TreeModel {
  const { tourDocument, editorView } = store.getState();
  const tour = manifestToWrite(tourDocument);
  return buildTree({
    stations: tour?.stations ?? [],
    assets: tour?.assets ?? [],
    codes: CODES,
    view: editorView,
    layers: ["codes", "names"],
    query,
  });
}

/** The tree drawn from the store as it stands (`query`: its search). */
function draw(query = "") {
  drawTree(
    dock,
    model(query),
    store.getState().editorView.foldedDocks.tree,
    pictures,
  );
}

describe("drawTree", () => {
  // Why: a folded station is one line in the list, as a file explorer
  // draws it - its grip, its fold arrow, then its number and its name, and
  // how many items it holds - so a tour's stations fit the dock at a
  // glance; its picture and items belong to the unfolded station only (a
  // folded card asks for no picture at all).
  it("draws a folded station as one row: grip, arrow, number and name, its count", () => {
    draw();
    const cards = [...dock.body.querySelectorAll(".card")];
    expect(cards.map((c) => c.querySelector(".nm")?.textContent)).toEqual([
      "The old gate",
      "The town hall steps",
    ]);
    expect(cards.map((c) => c.querySelector(".n")?.textContent)).toEqual([
      "1",
      "2",
    ]);
    expect(dock.stationsHead.textContent).toContain("Stations");
    // The gate holds a photo, the steps nothing: a count only where
    // there is something to count.
    expect(
      cards.map((c) =>
        [...(c.querySelector(".head")?.children ?? [])].map((e) => e.className),
      ),
    ).toEqual([
      ["grip", "tw", "pick", "meta", "ib add"],
      ["grip", "tw", "pick", "ib add"],
    ]);
    const count = cards[0]?.querySelector(".meta");
    expect([count?.textContent, count?.getAttribute("title")]).toEqual([
      "1",
      "1 item",
    ]);
    for (const card of cards) {
      // The row is the card's only child; the number and the name are
      // siblings in its button, in that order.
      expect([...card.children].map((c) => c.className)).toEqual(["head"]);
      const pick = card.querySelector(".head > .pick");
      expect([...(pick?.children ?? [])].map((c) => c.className)).toEqual([
        "n",
        "nm",
      ]);
    }
    expect(dock.body.querySelector(".pic, .ds, .kids")).toBeNull();
    // Folded, no card is `open`: its name stays one line.
    expect(dock.body.querySelector(".card.open")).toBeNull();
    expect(shown).toEqual([]);
  });

  // Why: unfolded, a station shows its picture under its row - only when
  // it has one, never an empty placeholder - then its items (its
  // description is the inspector's, not a line of the list); a station
  // with none says so rather than show nothing. An unfolded row shows no
  // count: its items are listed under it.
  it("shows an unfolded station's picture and items below its row", () => {
    store.dispatch(editorViewActions.stationFolded({ id: "gate", open: true }));
    store.dispatch(
      editorViewActions.stationFolded({ id: "steps", open: true }),
    );
    draw();
    const gate = dock.body.querySelector('.card[data-station="gate"]');
    expect([...(gate?.children ?? [])].map((c) => c.className)).toEqual([
      "head",
      "pic",
      "kids",
    ]);
    expect(gate?.querySelector(".meta")).toBeNull();
    expect(gate?.querySelector(".kids")?.textContent).toBe("The arch");
    // The gate's picture is its first photo, asked for its unfolded card.
    expect(shown).toEqual(["content/photo-1.jpg"]);
    const steps = dock.body.querySelector('.card[data-station="steps"]');
    expect([...(steps?.children ?? [])].map((c) => c.className)).toEqual([
      "head",
      "kids",
    ]);
    const empty = steps?.querySelector(".kids .emptyrow");
    expect(empty?.firstChild?.textContent).toBe("Nothing here yet. ");
    expect(empty?.querySelector("button")?.textContent).toBe("Add content");
    // Unfolded, the card says so (`open`): its name may wrap there.
    expect(gate?.classList.contains("open")).toBe(true);
    expect(steps?.classList.contains("open")).toBe(true);
  });

  it("makes every card, item and code a button, none inside another", () => {
    store.dispatch(editorViewActions.stationFolded({ id: "gate", open: true }));
    draw();
    const picks = [...dock.body.querySelectorAll("[data-select]")];
    // A station's picture strip selects it as its row does: its second
    // way there, out of the Tab order, so a keyboard meets the row once.
    expect(picks.map((p) => p.getAttribute("data-select"))).toEqual([
      "station:gate",
      "station:gate",
      "photo-1",
      "station:steps",
      "level-1",
    ]);
    for (const pick of picks) {
      expect(pick.tagName).toBe("BUTTON");
      expect((pick as HTMLButtonElement).type).toBe("button");
    }
    expect(dock.body.querySelectorAll("button button")).toHaveLength(0);
    // Every button of the tree has words for a screen reader.
    for (const button of dock.body.querySelectorAll("button")) {
      const words =
        button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(words.trim()).not.toBe("");
    }
  });

  it("shows the selection and the unfolded station", () => {
    store.dispatch(editorViewActions.selected({ id: "photo-1" }));
    store.dispatch(editorViewActions.stationFolded({ id: "gate", open: true }));
    draw();
    const gate = dock.body.querySelector('.card[data-station="gate"]');
    expect(gate?.classList.contains("ctx")).toBe(true);
    expect(gate?.querySelector(".kid.sel")?.textContent).toContain("The arch");
    expect(
      gate?.querySelector("[data-unfold]")?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("keeps the focus on the control that was pressed when it draws again", () => {
    draw();
    const pick = dock.body.querySelector<HTMLButtonElement>(
      '[data-select="station:steps"]',
    );
    pick?.focus();
    store.dispatch(editorViewActions.selected({ id: "station:steps" }));
    draw();
    const now = document.activeElement;
    expect(now).not.toBe(pick);
    expect(now?.getAttribute("data-select")).toBe("station:steps");
    // A fold arrow, a section header and a chip keep it too.
    for (const selector of [
      '[data-add="gate"]',
      '[data-unfold="gate"]',
      '[data-section="codes"]',
      '[data-layer="names"]',
    ]) {
      dock.body.querySelector<HTMLElement>(selector)?.focus();
      draw();
      expect(document.activeElement?.matches(selector)).toBe(true);
    }
  });

  // Why: a station's content is added in place, from its row: its "+"
  // opens the type menu for that station (`tree-add-menu.ts`), and an
  // empty station's line offers the same as "Add content" - a shortcut
  // into the one menu, never a second way. Both say which station they
  // add to, for a screen reader and in a tooltip.
  it("gives each station's row a + and an empty station's line Add content, both opening the type menu", () => {
    store.dispatch(
      editorViewActions.stationFolded({ id: "steps", open: true }),
    );
    draw();
    const adds = [...dock.body.querySelectorAll<HTMLElement>("[data-add]")];
    expect(adds.map((a) => a.dataset["add"])).toEqual(["gate", "steps"]);
    const plus = adds[0];
    expect(plus?.tagName).toBe("BUTTON");
    expect(plus?.title).toBe('Add to "The old gate"');
    expect(plus?.getAttribute("aria-label")).toBe('Add to "The old gate"');
    expect(plus?.getAttribute("aria-haspopup")).toBe("menu");
    expect(plus?.closest(".head")).not.toBeNull();
    const fill = dock.body.querySelectorAll<HTMLElement>("[data-fill]");
    expect([...fill].map((f) => f.dataset["fill"])).toEqual(["steps"]);
    expect(fill[0]?.getAttribute("aria-haspopup")).toBe("menu");
    expect(fill[0]?.getAttribute("aria-label")).toBe(
      'Add content to "The town hall steps"',
    );
  });

  // Why: a card is dragged by its grip to reorder the tour. The grip is
  // no button (Earlier and Later in the inspector are the keyboard's way),
  // so it sits beside the card's buttons, never inside one, hidden from a
  // screen reader.
  it("gives each card a grip to drag it by, outside its buttons", () => {
    draw();
    const grips = [...dock.body.querySelectorAll<HTMLElement>(".card .grip")];
    expect(grips.map((g) => g.dataset["drag"])).toEqual(["gate", "steps"]);
    for (const grip of grips) {
      expect(grip.tagName).toBe("SPAN");
      expect(grip.closest("button")).toBeNull();
      expect(grip.getAttribute("aria-hidden")).toBe("true");
      expect(grip.title).toBe("Drag to change its place in the tour");
    }
  });

  // Why: every station starts locked, so a lock on every row would say
  // nothing; the row marks the one that is not, whose position a drag in
  // the scene may move.
  it("marks an unlocked station's row, and no locked one", () => {
    store.dispatch(
      editorViewActions.stationLocked({ id: "steps", locked: false }),
    );
    draw();
    const marks = [...dock.body.querySelectorAll<HTMLElement>(".head .lockg")];
    expect(
      marks.map((m) => m.closest<HTMLElement>(".card")?.dataset["station"]),
    ).toEqual(["steps"]);
    expect(marks[0]?.title).toBe("Its position is unlocked: it can be moved");
    expect(marks[0]?.closest("button")).toBeNull();
    store.dispatch(
      editorViewActions.stationLocked({ id: "steps", locked: true }),
    );
  });

  // Why: the tree finds what its search names and shows where it is - a
  // station whose items match is listed unfolded with just those - and
  // a search that finds nothing says so, in place of an empty dock.
  it("lists what a search finds, and says when it finds nothing", () => {
    draw("arch");
    const cards = [...dock.body.querySelectorAll<HTMLElement>(".card")];
    expect(cards.map((c) => c.dataset["station"])).toEqual(["gate"]);
    expect(cards[0]?.querySelector(".kids")?.textContent).toBe("The arch");
    expect(dock.body.querySelector(".nomatch")).toBeNull();
    draw("zebra");
    expect(dock.body.querySelectorAll(".card")).toHaveLength(0);
    expect(dock.body.querySelector(".nomatch")?.textContent).toBe(
      'Nothing matches "zebra".',
    );
    // The head counts the tour's stations, found or not.
    expect(dock.stationsHead.querySelector(".count")?.textContent).toBe("2");
  });

  // Why: a station's story folders (a later format) come before its free
  // items, each its own row with its entries under it, a level deeper.
  // The format has none yet, so the draw is checked on a model made by
  // hand; the folder row is no button (no command acts on it yet).
  it("draws a station's story folders before its free items", () => {
    store.dispatch(editorViewActions.stationFolded({ id: "gate", open: true }));
    const built = model();
    const [gate, ...rest] = built.cards;
    if (gate === undefined) throw new Error("no gate");
    const folder = {
      id: "story-1",
      title: "The siege",
      open: true,
      children: [
        { id: "pin-9", kind: "pin" as const, title: "A shot", selected: false },
      ],
    };
    drawTree(
      dock,
      { ...built, cards: [{ ...gate, folders: [folder] }, ...rest] },
      false,
      pictures,
    );
    const kids = dock.body.querySelector('.card[data-station="gate"] .kids');
    expect(
      [...(kids?.children ?? [])].map((c) => [c.className, c.textContent]),
    ).toEqual([
      ["folder", "The siege1"],
      ["kid deep", "A shot"],
      ["kid", "The arch"],
    ]);
    expect(kids?.querySelector(".folder")?.tagName).toBe("DIV");
  });

  it("folds the dock to its head", () => {
    store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: true }),
    );
    draw();
    expect(dock.root.classList.contains("collapsed")).toBe(true);
    expect(dock.fold.getAttribute("aria-expanded")).toBe("false");
    store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: false }),
    );
  });
});
