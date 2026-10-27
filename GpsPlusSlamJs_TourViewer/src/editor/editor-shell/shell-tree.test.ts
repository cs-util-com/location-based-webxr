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
import { buildTree } from "./tree-model.js";

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
});

/** The tree drawn from the store as it stands. */
function draw() {
  const { tourDocument, editorView } = store.getState();
  const tour = manifestToWrite(tourDocument);
  drawTree(
    dock,
    buildTree({
      stations: tour?.stations ?? [],
      assets: tour?.assets ?? [],
      codes: CODES,
      view: editorView,
      layers: ["codes", "names"],
    }),
    editorView.foldedDocks.tree,
    pictures,
  );
}

describe("drawTree", () => {
  it("draws a card per station, its number, name and description", () => {
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
    // The gate's card picture is its first photo.
    expect(shown).toEqual(["content/photo-1.jpg"]);
  });

  it("makes every card, item and code a button, none inside another", () => {
    store.dispatch(editorViewActions.stationFolded({ id: "gate", open: true }));
    draw();
    const picks = [...dock.body.querySelectorAll("[data-select]")];
    expect(picks.map((p) => p.getAttribute("data-select"))).toEqual([
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
      '[data-unfold="gate"]',
      '[data-section="codes"]',
      '[data-layer="names"]',
    ]) {
      dock.body.querySelector<HTMLElement>(selector)?.focus();
      draw();
      expect(document.activeElement?.matches(selector)).toBe(true);
    }
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
