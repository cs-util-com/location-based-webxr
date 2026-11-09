// @vitest-environment jsdom
/**
 * Why these tests matter: the shell decides WHEN a typed field is written
 * and to WHICH selection, and when a "Put on the ground" that waits for
 * the ground is called off. None of that is visible in the pure modules
 * (`inspector-edits.ts`, `ground-wait.ts`): a field committed to the
 * station selected after it, a wait that writes to the station the
 * creator left, or a half-typed value written because the inspector was
 * drawn again under the cursor would each be a silent edit of the wrong
 * thing. So the real shell runs here on the page's own markup
 * (`edit.html`) and a real store, with the page's commands as spies.
 *
 * The browser part this needs: Chromium fires `focusout` synchronously on
 * a focused field that a draw takes out of the page (`replaceChildren`),
 * while jsdom fires nothing. `chromiumFocusOut` reproduces that one
 * behaviour, so a draw while typing is tested as the browser runs it; the
 * e2e (`editor3d-inspector.spec.js`) checks the same in Chromium itself.
 */
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEmptyTourManifest,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tourDocumentActions } from "../../tour-document.js";
import type * as TourDocument from "../../tour-document.js";
import { createTourViewerStore } from "../../tour-viewer-session.js";
import { editorViewActions, editorViewReducer } from "../editor-view.js";
import { createEditorShell, type EditorShellDeps } from "./editor-shell.js";
import {
  stationContent,
  storyOf,
  stationBlocks,
} from "../../test-support/station-content.js";

/** How often the tour to write is rebuilt (`manifestToWrite`): the
 *  readout's tick must not pay for it with nothing to show. */
const manifests = vi.hoisted(() => ({ built: 0 }));
vi.mock("../../tour-document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TourDocument>();
  return {
    ...actual,
    manifestToWrite: (...args: Parameters<typeof actual.manifestToWrite>) => {
      manifests.built += 1;
      return actual.manifestToWrite(...args);
    },
  };
});

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const PAGE = new DOMParser().parseFromString(
  readFileSync(resolve(packageRoot, "edit.html"), "utf8"),
  "text/html",
);

const AT = "2026-10-26T10:00:00Z";

function station(id: string, dLat: number, pinText = `Pin ${id}`): TourStation {
  return {
    id,
    title: `Station ${id}`,
    geo: { lat: 48.1371 + dLat, lon: 11.5754, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent([
      {
        id: `p${id}`,
        kind: "shortText",
        view: "pin",
        caption: pinText,
        createdAtIso: AT,
        pose: { position: [5, 1.5, 0], rotation: [0, 0, 0, 1] },
      },
    ]),
  } as unknown as TourStation;
}

/** The ground the fake view has loaded: null until `ground.m` is set. */
const ground: { m: number | null } = { m: null };

function fakeView() {
  return {
    flyTo: vi.fn(() => true),
    frame: vi.fn(),
    setTop: vi.fn(),
    zoom: vi.fn(),
    northUp: vi.fn(),
    readout: () => ({
      tiltDeg: 40,
      headingDeg: 0,
      top: false,
      drawCalls: 0,
      triangles: 0,
      frameMs: 16,
      worstFrameMs: 16,
      slowFrames: 0,
      frameCount: 0,
      recentFrameMs: [],
      mapLoad: { waiting: 0, failed: 0, givenUp: 0, ceilingWaitS: 0 },
    }),
    setLayers: vi.fn(),
    centre: () => ({ lat: 48.1371, lon: 11.5754, alt: 560 }),
    turn: vi.fn(() => true),
    previewRadius: vi.fn(),
    groundAt: () => ground.m,
    origin: () => ({ lat: 48.1371, lng: 11.5754 }),
    mapTiles: vi.fn(() => [
      {
        key: "15/17000/11000",
        status: "failed" as const,
        note: "Request failed",
        ms: null,
      },
    ]),
    retryMap: vi.fn(() => ({ tiles: 1, refused: null, retry: 1 })),
    lastMapRetry: vi.fn(() => null),
  };
}

function setUp() {
  document.body.replaceChildren(
    ...[...PAGE.body.childNodes].map((n) => document.importNode(n, true)),
  );
  const store = createTourViewerStore(undefined, {
    editorView: editorViewReducer,
  });
  store.dispatch(
    tourDocumentActions.opened({
      manifest: {
        ...createEmptyTourManifest(),
        stations: [station("a", 0, "line one\nline two"), station("b", 0.0004)],
      },
    }),
  );
  const select = (id: string | null) =>
    store.dispatch(editorViewActions.selected({ id }));
  const edits = {
    station: vi.fn(),
    text: vi.fn(),
    block: vi.fn(),
    view: vi.fn(),
    model: vi.fn((): "written" => "written"),
    scene: vi.fn(() => true),
    groundItems: vi.fn(),
    addItem: vi.fn(),
    addStory: vi.fn(),
    addToStory: vi.fn(),
    storyTitle: vi.fn(() => "written" as const),
    storyAdvance: vi.fn(() => "written" as const),
    narration: vi.fn(() =>
      Promise.resolve({ kind: "refused" as const, reason: "none" }),
    ),
    editNarration: vi.fn(() => Promise.resolve("written" as const)),
  };
  const deps: EditorShellDeps = {
    store,
    select,
    step: vi.fn(),
    codes: () => [],
    loadPicture: () => Promise.reject(new Error("no pictures here")),
    dialogOpen: () => false,
    stations: {
      add: vi.fn(),
      reorder: vi.fn(),
      moveChild: vi.fn(),
      split: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
    },
    edits,
    say: vi.fn(),
  };
  const shell = createEditorShell(deps);
  const view = fakeView();
  shell.show(view);
  return { store, select, edits, deps, shell, view };
}

/** The inspector's field `name`: a line (an input) or prose (a text
 *  area). */
function field(name: string): HTMLInputElement | HTMLTextAreaElement {
  const found = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#shell-inspector [data-field="${name}"]`,
  );
  if (found === null) throw new Error(`no field ${name}`);
  return found;
}

/** Text typed into `name`, its focus kept, nothing committed. */
function typeInto(
  name: string,
  text: string,
): HTMLInputElement | HTMLTextAreaElement {
  const input = field(name);
  input.focus();
  input.value = text;
  return input;
}

const replaceChildren = Element.prototype.replaceChildren;

/** Chromium's behaviour jsdom lacks: a focused element a
 *  `replaceChildren` takes out of the page gets `focusout` at once,
 *  while it is still in the page. */
function chromiumFocusOut(): void {
  Element.prototype.replaceChildren = function (
    this: Element,
    ...nodes: (Node | string)[]
  ) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.contains(active)) {
      active.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    replaceChildren.apply(this, nodes);
  };
}

/** No picture is in view here: the cards' pictures are not the subject. */
class NoObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoObserver);
  vi.useFakeTimers();
  ground.m = null;
});

afterEach(() => {
  Element.prototype.replaceChildren = replaceChildren;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the tree's add", () => {
  // Why: the globe's view has no place for a station high above a ground
  // that has not loaded (the place under the camera would be kilometres
  // in the air); the "+" then says why instead of adding one there.
  it("adds a station at the view's centre, and says why when the view has none", () => {
    const { deps, shell } = setUp();
    const add = () => {
      document.getElementById("tree-add")?.click();
    };
    add();
    expect(deps.stations.add).toHaveBeenCalledWith(
      { lat: 48.1371, lon: 11.5754, alt: 560 },
      "centre",
    );
    shell.show({ ...fakeView(), centre: () => null });
    add();
    expect(deps.stations.add).toHaveBeenCalledTimes(1);
    expect(deps.say).toHaveBeenCalledWith(
      "Come closer to the ground to add a station here",
    );
    shell.hide();
  });
});

describe("the tree's add in place", () => {
  /** The station's "+" as the tree draws it now. */
  const plus = (id: string) =>
    document.querySelector<HTMLElement>(`#tree-body [data-add="${id}"]`);
  const menu = () => document.getElementById("tree-add-menu");

  // Why: a row's "+" adds to that station, from its type menu, and the
  // new row shows in place: the station unfolds. The add selects what it
  // made, which draws the tree again from inside the action; the focus
  // must come back to the station's "+" drawn again, not fall to the
  // page, so the next add is one key away.
  it("adds the kind chosen to the row's station, unfolded, the focus on its + after the add's own redraw", () => {
    const { edits, select, store, shell } = setUp();
    edits.addItem.mockImplementation((id: string) => {
      select(`p${id}`);
    });
    const before = plus("b");
    before?.click();
    expect(menu()?.hidden).toBe(false);
    expect(before?.getAttribute("aria-expanded")).toBe("true");
    document
      .querySelector<HTMLElement>('#tree-add-menu [data-kind="longText"]')
      ?.click();
    expect(edits.addItem).toHaveBeenCalledWith("b", "longText");
    expect(store.getState().editorView.openStations).toContain("b");
    expect(menu()?.hidden).toBe(true);
    const after = plus("b");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after?.getAttribute("aria-expanded")).toBe("false");
    shell.hide();
  });

  // Why: the menu's Escape is its own - it closes the menu and stops
  // there, the selection kept (the page's Escape drops it).
  it("closes on Escape with the selection kept and the focus on the +", () => {
    const { edits, select, store, shell } = setUp();
    select("station:a");
    plus("a")?.click();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(menu()?.hidden).toBe(true);
    expect(store.getState().editorView.selected).toBe("station:a");
    expect(document.activeElement).toBe(plus("a"));
    expect(edits.addItem).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: an empty station's line offers "Add content", the same menu for
  // the same station - never a second way to add.
  it("opens the same menu from an empty station's Add content", () => {
    const { edits, store, shell } = setUp();
    store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [{ ...station("c", 0), ...stationContent([]) }],
        },
      }),
    );
    store.dispatch(editorViewActions.stationFolded({ id: "c", open: true }));
    document.querySelector<HTMLElement>('#tree-body [data-fill="c"]')?.click();
    expect(menu()?.hidden).toBe(false);
    expect(menu()?.getAttribute("aria-label")).toBe("Add to Station c");
    document
      .querySelector<HTMLElement>('#tree-add-menu [data-kind="shortText"]')
      ?.click();
    expect(edits.addItem).toHaveBeenCalledWith("c", "shortText");
    shell.hide();
  });
});

describe("the Ctrl+K palette", () => {
  const ctrlK = (target: EventTarget = document.body) => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const palette = () => document.getElementById("add-palette");
  const input = () =>
    document.getElementById("add-palette-input") as HTMLInputElement;
  const typeQuery = (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  };
  const enter = () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

  // Why: Ctrl+K adds by kind and place in one query, its place the
  // selection's station when the query names none - an item selected
  // counts as its station - and Chrome's own Ctrl+K (the address bar's
  // search) must not run instead.
  it("opens on Ctrl+K and adds to the selection's station, an item's station for a selected item", () => {
    const { edits, select, shell } = setUp();
    select("pb");
    const event = ctrlK();
    expect(event.defaultPrevented).toBe(true);
    expect(palette()?.hidden).toBe(false);
    expect(document.activeElement).toBe(input());
    typeQuery("long");
    enter();
    expect(edits.addItem).toHaveBeenCalledWith("b", "longText");
    expect(palette()?.hidden).toBe(true);
    ctrlK();
    typeQuery("pin 1");
    enter();
    expect(edits.addItem).toHaveBeenLastCalledWith("a", "shortText");
    shell.hide();
  });

  // Why: its New station is the tree's "+" - the same place, the same
  // words when the view has none.
  it("adds a new station at the view's centre", () => {
    const { deps, shell } = setUp();
    ctrlK();
    typeQuery("new station");
    enter();
    expect(deps.stations.add).toHaveBeenCalledWith(
      { lat: 48.1371, lon: 11.5754, alt: 560 },
      "centre",
    );
    shell.hide();
  });

  // Why: a line field (the tree's search, a name) has no Ctrl+K of its
  // own, so the palette opens there too and the browser's own Ctrl+K
  // (the address bar's search) never runs; in a text of several lines
  // Ctrl+K is the field's (the long-text writer's Link key), and over a
  // dialog it is the dialog's; and the palette is gone with the view.
  it("opens from a line field, leaves Ctrl+K to a text area and to a dialog, and closes with the view", () => {
    const { deps, select, shell } = setUp();
    const search = document.getElementById("tree-search");
    search?.focus();
    const inSearch = ctrlK(search ?? document.body);
    expect(inSearch.defaultPrevented).toBe(true);
    expect(palette()?.hidden).toBe(false);
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(palette()?.hidden).toBe(true);
    select("station:a");
    const area = field("description");
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    area.focus();
    const typed = ctrlK(area);
    expect(typed.defaultPrevented).toBe(false);
    expect(palette()?.hidden).toBe(true);
    (deps as { dialogOpen: () => boolean }).dialogOpen = () => true;
    ctrlK();
    expect(palette()?.hidden).toBe(true);
    (deps as { dialogOpen: () => boolean }).dialogOpen = () => false;
    ctrlK();
    expect(palette()?.hidden).toBe(false);
    shell.hide();
    expect(palette()?.hidden).toBe(true);
  });

  // Why: a touch tablet has neither the keyboard's Ctrl+K nor a mouse
  // for a row's "+": the top bar's Add is the palette's button, and at a
  // phone's width, where the bar has no room for it, the Edit menu's.
  it("opens from the top bar's Add and from the Edit menu's", () => {
    const { shell } = setUp();
    for (const id of ["studio-add", "edit-add"]) {
      const add = document.getElementById(id);
      expect(add?.getAttribute("aria-keyshortcuts"), id).toBe("Control+K");
      add?.click();
      expect(palette()?.hidden, id).toBe(false);
      expect(document.activeElement, id).toBe(input());
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(palette()?.hidden, id).toBe(true);
    }
    shell.hide();
  });

  // Why: the palette gives the focus back where it found it, and the Edit
  // menu's Add closes as the palette opens: with the item hidden the
  // focus fell to the page, so a keyboard lost its place on Escape.
  it("gives the focus back to the Edit button, not to the item its menu hides", () => {
    const { shell } = setUp();
    const item = document.getElementById("edit-add");
    item?.focus();
    item?.click();
    expect(document.activeElement).toBe(input());
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.activeElement).toBe(
      document.getElementById("edit-menu-btn"),
    );
    shell.hide();
  });

  // Why: the palette opened over the help is the topmost layer, so
  // Escape closes it first - the help goes on the next Escape.
  it("closes on Escape before the help it was opened over", () => {
    const { shell } = setUp();
    document.getElementById("studio-help")?.click();
    const help = document.getElementById("shell-help");
    expect(help?.classList.contains("show")).toBe(true);
    ctrlK();
    expect(palette()?.hidden).toBe(false);
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(palette()?.hidden).toBe(true);
    expect(help?.classList.contains("show")).toBe(true);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(help?.classList.contains("show")).toBe(false);
    shell.hide();
  });
});

describe("the tree's search and its Fold every station", () => {
  /** The stations the tree lists now. */
  const listed = () =>
    [...document.querySelectorAll<HTMLElement>("#tree-body .card")].map(
      (c) => c.dataset["station"],
    );

  // Why: the search is typed into a field the tree never redraws, so it
  // keeps its focus and its text while the list under it follows each
  // letter; Escape empties it before it drops the selection, and a
  // station's draw from the store keeps what is searched.
  it("lists what is typed as it is typed, and Escape empties it first", () => {
    const { select, store, shell } = setUp();
    select("station:a");
    const search = document.getElementById("tree-search") as HTMLInputElement;
    search.focus();
    search.value = "pin b";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(listed()).toEqual(["b"]);
    expect(document.activeElement).toBe(search);
    // A draw from the store (a fold) keeps the search.
    store.dispatch(editorViewActions.stationFolded({ id: "a", open: true }));
    expect(listed()).toEqual(["b"]);
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(search.value).toBe("");
    expect(listed()).toEqual(["a", "b"]);
    expect(store.getState().editorView.selected).toBe("station:a");
    shell.hide();
  });

  /** `text` typed into the tree's search. */
  const search = (text: string): HTMLInputElement => {
    const field = document.getElementById("tree-search") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field;
  };

  // Why: a search belongs to the tour it was typed over; another tour
  // opened under it would otherwise list only what matches a word typed
  // for the last one, or nothing.
  it("is emptied when another tour opens", () => {
    const { store, shell } = setUp();
    const field = search("pin b");
    expect(listed()).toEqual(["b"]);
    store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [station("a", 0), station("b", 0.0004)],
        },
      }),
    );
    expect(field.value).toBe("");
    expect(listed()).toEqual(["a", "b"]);
    shell.hide();
  });

  // Why: with a search the list hides stations, so a drop among those
  // shown would put the hidden ones in an order nobody saw; the drag is
  // refused, and saying why keeps it from looking broken.
  it("refuses a drag while it filters, and says why", () => {
    const { deps, shell } = setUp();
    const grips = () => [
      ...document.querySelectorAll<HTMLElement>("#tree-body .grip"),
    ];
    expect(grips().map((g) => g.dataset["drag"])).toEqual(["a", "b"]);
    search("station");
    expect(grips().map((g) => g.dataset["drag"])).toEqual([
      undefined,
      undefined,
    ]);
    expect(grips().every((g) => g.classList.contains("off"))).toBe(true);
    grips()[0]?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(deps.say).toHaveBeenCalledWith(
      "Clear the search to change the order of the stations",
    );
    shell.hide();
  });

  // Why: a station the search unfolded (it found items of it) is open
  // without the store saying so, so its arrow must fold it all the same
  // - and a new search starts with every found station unfolded again.
  it("folds a station it unfolded on that station's arrow", () => {
    const { store, shell } = setUp();
    search("pin b");
    const card = () => document.querySelector("#tree-body .card");
    expect(card()?.classList.contains("open")).toBe(true);
    document
      .querySelector<HTMLElement>('#tree-body [data-unfold="b"]')
      ?.click();
    expect(card()?.classList.contains("open")).toBe(false);
    expect(store.getState().editorView.openStations).not.toContain("b");
    document
      .querySelector<HTMLElement>('#tree-body [data-unfold="b"]')
      ?.click();
    expect(card()?.classList.contains("open")).toBe(true);
    document
      .querySelector<HTMLElement>('#tree-body [data-unfold="b"]')
      ?.click();
    search("pin");
    expect(card()?.classList.contains("open")).toBe(true);
    shell.hide();
  });

  // Why: an item added while a search runs would be made and not shown
  // (its name, "New pin 2", matches no word typed): the add empties the
  // search, so the new row is in the list.
  it("is emptied by an add, so what was added shows", () => {
    const { edits, shell } = setUp();
    const field = search("pin b");
    document.querySelector<HTMLElement>('#tree-body [data-add="b"]')?.click();
    document
      .querySelector<HTMLElement>('#tree-add-menu [data-kind="shortText"]')
      ?.click();
    expect(edits.addItem).toHaveBeenCalledWith("b", "shortText");
    expect(field.value).toBe("");
    expect(listed()).toEqual(["a", "b"]);
    shell.hide();
  });

  // Why: every way the page makes a station ends in this call, a copied
  // item's too: what is new is selected and said, and its name matches
  // nothing typed, so a search left running would hide it. On the 2D map the tree is not
  // drawn, so the search is emptied for the next time it shows.
  it("is emptied at the page's word, drawn if the tree shows", () => {
    const { shell } = setUp();
    const field = search("pin b");
    shell.clearSearch();
    expect(field.value).toBe("");
    expect(listed()).toEqual(["a", "b"]);
    search("pin b");
    shell.hide();
    shell.clearSearch();
    expect(field.value).toBe("");
  });

  // Why: an unfolded station lists all its items; with several unfolded
  // the list gets long, and one press folds them all back to a line each.
  it("folds every unfolded station in one press", () => {
    const { store, shell } = setUp();
    for (const id of ["a", "b"]) {
      store.dispatch(editorViewActions.stationFolded({ id, open: true }));
    }
    expect(document.querySelectorAll("#tree-body .card.open")).toHaveLength(2);
    document.getElementById("tree-collapse")?.click();
    expect(store.getState().editorView.openStations).toEqual([]);
    expect(document.querySelectorAll("#tree-body .card.open")).toHaveLength(0);
    shell.hide();
  });
});

describe("the inspector's typed fields", () => {
  it("are written to the selection they were typed for when the selection changes", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the fountain");
    select("station:b");
    expect(edits.station).toHaveBeenCalledTimes(1);
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "By the fountain",
    });
    shell.hide();
  });

  // Why (B2c): a block's other text fields reach the page as block field
  // edits for the block they were typed for, never as a station's or a
  // pin text's.
  it("write a short text's description as a block field of that block", () => {
    const { select, edits, shell } = setUp();
    select("pa");
    typeInto("description", "Under the arch");
    select("station:b");
    expect(edits.block).toHaveBeenCalledWith(
      "pa",
      "description",
      "Under the arch",
    );
    expect(edits.station).not.toHaveBeenCalled();
    expect(edits.text).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: the page refuses a text over the format's cap (its toast says
  // so). The field was reset to the tour's value before the edit was
  // sent, so the creator's typing was wiped by the refusal; it must stay
  // in the field to be shortened. A written edit still shows the tour's
  // value, as the draw gives it.
  it("keep the typed text in the field when the page refuses the edit", () => {
    const cases = [
      { selection: "pa", name: "description", text: "x".repeat(161) },
      { selection: "pb", name: "title", text: "A pin text the page refuses" },
      { selection: "station:a", name: "title", text: "A name it refuses" },
    ] as const;
    for (const { selection, name, text } of cases) {
      const { select, edits, shell } = setUp();
      edits.block.mockReturnValue("refused");
      edits.text.mockReturnValue("refused");
      edits.station.mockReturnValue("refused");
      select(selection);
      const input = typeInto(name, text);
      input.blur();
      const sent =
        edits.block.mock.calls.length +
        edits.text.mock.calls.length +
        edits.station.mock.calls.length;
      expect(sent, `${selection} ${name}`).toBe(1);
      expect(input.value, `${selection} ${name}`).toBe(text);
      shell.hide();
    }
  });

  it("show the tour's value again when the page writes the edit", () => {
    const { select, edits, shell } = setUp();
    edits.block.mockReturnValue("written");
    select("pa");
    const description = typeInto("description", "Under the arch");
    description.blur();
    expect(edits.block).toHaveBeenCalledTimes(1);
    // The fake page wrote nothing to the store, so the tour's value is
    // still the empty one.
    expect(description.value).toBe("");
    shell.hide();
  });

  it("are written when the view hides", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the fountain");
    shell.hide();
    expect(edits.station).toHaveBeenCalledTimes(1);
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "By the fountain",
    });
  });

  it("are not written by a draw of the inspector while typing, and keep the text and the focus", () => {
    chromiumFocusOut();
    const { store, select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the foun");
    // Another change of the station (here its radius from elsewhere)
    // draws the inspector again under the cursor.
    store.dispatch(
      tourDocumentActions.stationEdited({
        stationId: "a",
        edit: { foundRadiusM: 30 },
        what: "radius",
      }),
    );
    // Drawn again: the folded Place says the new radius.
    expect(
      document.querySelector("#shell-inspector .disc .sum")?.textContent,
    ).toMatch(/^r 30 m/);
    expect(edits.station).not.toHaveBeenCalled();
    expect(field("description").value).toBe("By the foun");
    expect(document.activeElement).toBe(field("description"));
    shell.hide();
  });

  it("are not written by the readout's draw when the ground arrives while typing", () => {
    chromiumFocusOut();
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the foun");
    ground.m = 500;
    vi.advanceTimersByTime(250);
    expect(
      document.querySelector('[data-act="ground-items"]')?.textContent,
    ).toContain("1 off");
    expect(edits.station).not.toHaveBeenCalled();
    expect(field("description").value).toBe("By the foun");
    shell.hide();
  });

  // Why: Chromium fires focusout before the focus moves on, and the
  // commit draws the inspector again at once: that takes the control the
  // focus was moving to out of the page, and Chromium then drops the
  // focus to the page (Tab lost the creator's place, and the next plain
  // key was the page's: T toggled the top view). The shell hands the
  // focus on to that control as drawn again, found by its name.
  it("hand the focus on to the control it was moving to when the commit draws the inspector again", () => {
    const { store, select, edits, shell } = setUp();
    edits.station.mockImplementation((...args: unknown[]) => {
      store.dispatch(
        tourDocumentActions.stationEdited({
          stationId: args[0] as string,
          edit: args[1] as { description: string },
          what: "description",
        }),
      );
    });
    select("station:a");
    const typed = typeInto("description", "By the fountain");
    const name = field("title");
    typed.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: name }),
    );
    expect(edits.station).toHaveBeenCalledTimes(1);
    // Drawn again: a new field under the same name, and it has the focus.
    expect(field("title")).not.toBe(name);
    expect(document.activeElement).toBe(field("title"));
    shell.hide();
  });

  // Why: Tab selects the text of the field it lands on, so typing replaces
  // the value. The field drawn again gets a plain focus, which selects
  // nothing, so a Tab after an edit left the old value to type into. A press
  // on a field keeps its plain focus: a click means a place in the text.
  it.each([
    ["Tab", true],
    ["a press", false],
  ])("selects the field the focus lands on after %s only", (_how, byTab) => {
    const { store, select, edits, shell } = setUp();
    edits.station.mockImplementation((...args: unknown[]) => {
      store.dispatch(
        tourDocumentActions.stationEdited({
          stationId: args[0] as string,
          edit: args[1] as { description: string },
          what: "description",
        }),
      );
    });
    select("station:a");
    const typed = typeInto("description", "By the fountain");
    if (byTab) {
      typed.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    }
    typed.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: field("title"),
      }),
    );
    const next = field("title") as HTMLInputElement;
    expect(document.activeElement).toBe(next);
    expect(next.value.length).toBeGreaterThan(0);
    expect(next.selectionEnd! - next.selectionStart!).toBe(
      byTab ? next.value.length : 0,
    );
    shell.hide();
  });
});

describe("the inspector's Escape and its text of several lines", () => {
  it("puts the tour's value back on Escape, and leaving the field then writes nothing", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    const input = typeInto("description", "Not this");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(input.value).toBe("");
    input.blur();
    expect(edits.station).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: a description is prose, so Enter starts a new line there and
  // must not write the field (it did while the description was a one-line
  // input); leaving it writes the lines.
  it("takes Enter in a description as a new line, and writes the lines when it is left", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    const area = typeInto("description", "line one");
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    area.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(edits.station).not.toHaveBeenCalled();
    area.value = "line one\nline two";
    area.blur();
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "line one\nline two",
    });
    shell.hide();
  });

  // Why: a description of several lines from a tour written elsewhere
  // stays editable here, and an untouched one is not written back (its
  // line ends read as typed text would make every focus an edit).
  it("writes nothing for a description of several lines that is focused and left", () => {
    const { store, select, edits, shell } = setUp();
    store.dispatch(
      tourDocumentActions.stationEdited({
        stationId: "a",
        edit: { description: "one\r\ntwo" },
        what: "description",
      }),
    );
    select("station:a");
    const area = field("description");
    expect(area.readOnly).toBe(false);
    area.focus();
    area.blur();
    select("station:b");
    shell.hide();
    expect(edits.station).not.toHaveBeenCalled();
  });

  it("writes nothing for a pin text of several lines that is focused and left", () => {
    const { select, edits, shell } = setUp();
    select("pa");
    const input = field("title");
    input.focus();
    input.blur();
    select("station:b");
    shell.hide();
    expect(edits.text).not.toHaveBeenCalled();
  });
});

describe("Put items on the ground, waiting for the ground", () => {
  it("is called off by a selection change: ground that arrives later writes nothing", async () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    document
      .querySelector<HTMLButtonElement>('[data-act="ground-items"]')
      ?.click();
    expect(
      document.querySelector('[data-act="ground-items"]')?.textContent,
    ).toContain("Waiting for the ground");
    select("station:b");
    ground.m = 500;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edits.groundItems).not.toHaveBeenCalled();
    expect(edits.scene).not.toHaveBeenCalled();
    shell.hide();
  });

  it("writes once the ground arrives when the selection stays", async () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    document
      .querySelector<HTMLButtonElement>('[data-act="ground-items"]')
      ?.click();
    ground.m = 500;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edits.groundItems).toHaveBeenCalledTimes(1);
    expect(edits.groundItems.mock.calls[0]?.[0]).toEqual([
      { id: "pa", alt: 500 },
    ]);
    shell.hide();
  });
});

describe("the readout's tick", () => {
  // Why: the tick runs five times a second while the 3D view shows; with
  // nothing selected the inspector has nothing to show, and rebuilding
  // the whole tour to find that out cost a manifest build each time.
  it("builds no tour while nothing is selected, and does while something is", () => {
    const { select, shell } = setUp();
    manifests.built = 0;
    vi.advanceTimersByTime(1_000);
    expect(manifests.built).toBe(0);
    select("station:a");
    manifests.built = 0;
    vi.advanceTimersByTime(1_000);
    expect(manifests.built).toBeGreaterThanOrEqual(5);
    shell.hide();
  });
});

/** The tour of `setUp` with a model in station b: two notes, one
 *  section, a clip that does not play by itself. */
function withModel(
  store: ReturnType<typeof setUp>["store"],
  view = "hotspots",
  noted = true,
): void {
  const b = station("b", 0.0004);
  store.dispatch(
    tourDocumentActions.opened({
      manifest: {
        ...createEmptyTourManifest(),
        assets: [{ id: "glb", path: "content/m.glb", kind: "model" }],
        stations: [
          station("a", 0),
          {
            ...b,
            ...stationContent([
              {
                id: "m",
                kind: "model",
                view: view as "placed",
                asset: "glb",
                sizeM: 2,
                createdAtIso: AT,
                pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
                animation: { name: "Swing", autoplay: false },
                annotations: noted
                  ? [
                      { position: [0, 1, 0], normal: [0, 1, 0], title: "Top" },
                      {
                        position: [0.5, 0, 0],
                        normal: [1, 0, 0],
                        title: "Side",
                        text: "The bell's side",
                      },
                    ]
                  : [],
                sections: [
                  { name: "Frame", position: [0, 0.5, 0], normal: [0, 0, 1] },
                ],
              },
            ]),
          },
        ],
      },
    }),
  );
}

function press(act: string): void {
  const b = document.querySelector<HTMLButtonElement>(
    `#shell-inspector [data-act="${act}"]`,
  );
  if (b === null) throw new Error(`no button ${act}`);
  b.click();
}

// Why: the 3D inspector's model parts reach the page as model edits of
// the model they were typed or pressed for, and the buttons that wait for
// a click on the model only ask the 3D view to wait (the store's pick),
// pressed again they stop. A wrong index here would edit another note.
describe("the inspector's model parts", () => {
  it("write a note's title and text, a section's name and the clip's name as model edits", () => {
    const { store, select, edits, shell } = setUp();
    withModel(store);
    select("m");
    typeInto("note-title:1", "Bell side");
    typeInto("note-text:0", "The crown");
    typeInto("section-name:0", "Oak frame");
    typeInto("anim-name", "Ring");
    select("station:a");
    expect(edits.model.mock.calls).toEqual([
      [
        "m",
        { kind: "note-text", index: 1, field: "title", value: "Bell side" },
      ],
      ["m", { kind: "note-text", index: 0, field: "text", value: "The crown" }],
      ["m", { kind: "section-name", index: 0, value: "Oak frame" }],
      ["m", { kind: "animation", name: "Ring", autoplay: false }],
    ]);
    shell.hide();
  });

  // Why this test matters: a model's notes are drawn only in the
  // Hotspots view, so a creator who wrote notes and chose another view
  // would otherwise wonder where they went.
  it("tells a model with notes in another view that its notes show only in Hotspots", () => {
    const hint = "Its notes show only in Hotspots";
    const note = (): string =>
      document.querySelector("#shell-inspector .mview .note")?.textContent ??
      "";
    for (const [view, noted, shows] of [
      ["placed", true, true],
      ["toy", true, true],
      ["hotspots", true, false],
      ["placed", false, false],
    ] as const) {
      const { store, select, shell } = setUp();
      withModel(store, view, noted);
      select("m");
      expect(note().includes(hint), `${view} ${String(noted)}`).toBe(shows);
      shell.hide();
    }
  });

  it("choose a view, flip a section, turn autoplay and delete parts as model edits", () => {
    const { store, select, edits, shell } = setUp();
    withModel(store);
    select("m");
    press("view:cutaway");
    press("section-flip:0");
    press("anim-autoplay");
    press("note-delete:1");
    press("section-delete:0");
    expect(edits.model.mock.calls).toEqual([
      ["m", { kind: "view", view: "cutaway" }],
      [
        "m",
        {
          kind: "section-place",
          index: 0,
          at: { position: [0, 0.5, 0], normal: [0, 0, -1] },
        },
      ],
      ["m", { kind: "animation", name: "Swing", autoplay: true }],
      ["m", { kind: "note-delete", index: 1 }],
      ["m", { kind: "section-delete", index: 0 }],
    ]);
    shell.hide();
  });

  it("ask the 3D view for a click on the model, and stop asking when pressed again", () => {
    const { store, select, edits, shell } = setUp();
    withModel(store);
    select("m");
    press("note-add");
    expect(store.getState().editorView.modelPick).toEqual({ what: "note-add" });
    expect(
      document.querySelector('#shell-inspector [data-act="note-add"]')
        ?.textContent,
    ).toBe("Click the model...");
    press("note-add");
    expect(store.getState().editorView.modelPick).toBeNull();
    press("note-place:1");
    expect(store.getState().editorView.modelPick).toEqual({
      what: "note-place",
      index: 1,
    });
    // Placing a note again brings it into focus.
    expect(store.getState().editorView.modelFocus).toEqual({
      part: "note",
      index: 1,
    });
    press("section-add");
    expect(store.getState().editorView.modelPick).toEqual({
      what: "section-add",
    });
    expect(edits.model).not.toHaveBeenCalled();
    shell.hide();
  });

  it("marks the note in focus, and a press of its number takes the focus away", () => {
    const { store, select, shell } = setUp();
    withModel(store);
    select("m");
    press("note:1");
    const marked = () =>
      [...document.querySelectorAll("#shell-inspector .anno.on")].map(
        (e) => (e as HTMLElement).dataset["note"],
      );
    expect(marked()).toEqual(["1"]);
    press("note:1");
    expect(marked()).toEqual([]);
    shell.hide();
  });
});

// Why these tests matter: a story character's chips must reach the page
// as an edit of HIS station for HIM - his view, or how the step showing
// him moves on - and the chip already pressed must write nothing (a
// second click would otherwise be an undo step that changed nothing).
describe("a story character's chips", () => {
  function withCharacter() {
    const set = setUp();
    const gate = {
      ...station("c", 0.0008),
      ...stationContent([
        storyOf("story-1", [
          {
            id: "w1",
            kind: "character",
            view: "speak",
            name: "Wendel",
            image: "cut",
            caption: "Good day",
            pose: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
            advance: { mode: "tap" },
          },
        ]),
      ]),
    };
    set.store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [station("a", 0), gate],
        },
      }),
    );
    set.select("w1");
    return set;
  }
  const click = (act: string) => {
    const b = document.querySelector<HTMLButtonElement>(
      `#shell-inspector [data-act="${act}"]`,
    );
    if (b === null) throw new Error(`no ${act}`);
    b.click();
  };

  it("write his view and how his step moves on as his station's edit", () => {
    const { edits, shell } = withCharacter();
    click("character-view:w1:two-stations");
    click("character-advance:w1:lineEnd");
    expect(edits.station.mock.calls).toEqual([
      ["c", { character: { block: "w1", view: "two-stations" } }],
      ["c", { character: { block: "w1", advance: "lineEnd" } }],
    ]);
    expect(edits.model).not.toHaveBeenCalled();
    shell.hide();
  });

  it("write nothing for the chip already pressed", () => {
    const { edits, shell } = withCharacter();
    click("character-view:w1:speak");
    click("character-advance:w1:tap");
    expect(edits.station).not.toHaveBeenCalled();
    shell.hide();
  });
});

// Why these tests matter: a story's folder works through the tree's own
// clicks. Its arrow, its name and its + each mean one thing; one that did
// another's job (a + that added to the station, a name that folded a
// selected station) puts a creator's work in the wrong place.
describe("a story's folder in the tree", () => {
  function withStory() {
    const set = setUp();
    const gate = {
      ...station("c", 0.0008),
      ...stationContent([
        storyOf(
          "legend",
          [
            {
              id: "l1",
              kind: "longText",
              view: "card",
              title: "The siege",
              body: "In 1632",
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              advance: { mode: "tap" },
            },
          ],
          "The legend",
        ),
      ]),
    };
    set.store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [station("a", 0), gate],
        },
      }),
    );
    set.store.dispatch(
      editorViewActions.stationFolded({ id: "c", open: true }),
    );
    return set;
  }
  const tree = (selector: string) => {
    const found = document.querySelector<HTMLElement>(`#tree-body ${selector}`);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  const inspectorAct = (act: string) => {
    const found = document.querySelector<HTMLElement>(
      `#shell-inspector [data-act="${act}"]`,
    );
    if (found === null) throw new Error(`no ${act}`);
    return found;
  };

  it("folds by its arrow, and selects by its name, unfolding only its holders", () => {
    const { store, shell } = withStory();
    tree('[data-select="story:legend"]').click();
    expect(store.getState().editorView.selected).toBe("story:legend");
    expect(store.getState().editorView.openStories).toEqual([]);
    tree('[data-folder="legend"]').click();
    expect(store.getState().editorView.openStories).toEqual(["legend"]);
    expect(tree('[data-select="l1"]').textContent).toContain("The siege");
    tree('[data-folder="legend"]').click();
    expect(store.getState().editorView.openStories).toEqual([]);
    shell.hide();
  });

  it("opens its story's menu from its +, and adds into the story", () => {
    const { edits, shell } = withStory();
    tree('[data-storyadd="legend"]').click();
    const menu = document.getElementById("tree-add-menu");
    expect(menu?.querySelector(".mhead")?.textContent).toBe(
      'Add to the story "The legend"',
    );
    menu?.querySelector<HTMLElement>('[data-kind="shortText"]')?.click();
    expect(edits.addToStory).toHaveBeenCalledWith("legend", "shortText");
    expect(edits.addItem).not.toHaveBeenCalled();
    shell.hide();
  });

  it("adds a story from the station's +, into that station", () => {
    const { edits, shell } = withStory();
    tree('[data-add="c"]').click();
    document
      .querySelector<HTMLElement>('#tree-add-menu [data-kind="story"]')
      ?.click();
    expect(edits.addStory).toHaveBeenCalledWith("c");
    shell.hide();
  });

  it("offers a story's Add entry from its inspector, in the same menu", () => {
    const { edits, select, shell } = withStory();
    select("story:legend");
    inspectorAct("add-entry").click();
    document
      .querySelector<HTMLElement>('#tree-add-menu [data-kind="longText"]')
      ?.click();
    expect(edits.addToStory).toHaveBeenCalledWith("legend", "longText");
    shell.hide();
  });

  it("goes from a story's entry row to the entry, unfolding its folder", () => {
    const { store, select, shell } = withStory();
    select("story:legend");
    inspectorAct("goto:l1").click();
    expect(store.getState().editorView.selected).toBe("l1");
    expect(store.getState().editorView.openStories).toEqual(["legend"]);
    shell.hide();
  });

  it("writes a typed title and how an entry moves on as the story's edits", () => {
    const { edits, select, shell } = withStory();
    select("story:legend");
    const title = document.querySelector<HTMLInputElement>(
      '#shell-inspector [data-field="story-title"]',
    );
    if (title === null) throw new Error("no title");
    title.focus();
    title.value = "Better";
    title.blur();
    expect(edits.storyTitle).toHaveBeenCalledWith("legend", "Better");
    select("l1");
    inspectorAct("entry-advance:l1:auto").click();
    expect(edits.storyAdvance).toHaveBeenCalledWith("l1", {
      mode: "auto",
      afterS: 5,
    });
    shell.hide();
  });

  it("writes nothing for the moves-on chip already pressed", () => {
    const { edits, select, shell } = withStory();
    select("l1");
    inspectorAct("entry-advance:l1:tap").click();
    expect(edits.storyAdvance).not.toHaveBeenCalled();
    shell.hide();
  });

  it("deletes a story through the page's one delete", () => {
    const { deps, select, shell } = withStory();
    select("story:legend");
    inspectorAct("delete").click();
    expect(deps.stations.remove).toHaveBeenCalledWith("story:legend");
    shell.hide();
  });
});

describe("the tree during the approach", () => {
  /** The shell shown again on a view that opens on its approach. */
  function onApproach() {
    const set = setUp();
    set.shell.hide();
    set.shell.show(fakeView(), { approach: true });
    return set;
  }
  const treeFolded = (store: ReturnType<typeof setUp>["store"]) =>
    store.getState().editorView.foldedDocks.tree;
  const treeRoot = () => document.getElementById("shell-tree")!;

  it("folds the tree for the flight and unfolds it, animated, at the landing", () => {
    // Why: the flight is the view's to show, so the rail is a tab during
    // it; at the landing it opens with a short animation, and the class
    // that runs it goes when the animation ends (a later unfold of the
    // creator's must not replay it).
    const { store, shell } = onApproach();
    expect(treeFolded(store)).toBe(true);
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(false);
    expect(treeRoot().classList.contains("unfolding")).toBe(true);
    const end = new Event("animationend") as AnimationEvent;
    Object.defineProperty(end, "animationName", { value: "dock-unfold" });
    treeRoot().dispatchEvent(end);
    expect(treeRoot().classList.contains("unfolding")).toBe(false);
  });

  it("unfolds at once, without the animation, under reduced motion", () => {
    // Why: reduced motion skips the animation, never the unfold.
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
    }));
    const { store, shell } = onApproach();
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(false);
    expect(treeRoot().classList.contains("unfolding")).toBe(false);
  });

  it("lands only once, and not at all on a view opened without an approach", () => {
    // Why: a creator who folds the rail after the landing keeps it folded;
    // nothing but the approach's own landing unfolds it, and only once.
    const { store, shell } = setUp();
    expect(treeFolded(store)).toBe(false);
    store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: true }),
    );
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(true);
    shell.hide();
    shell.show(fakeView(), { approach: true });
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(false);
    store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: true }),
    );
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(true);
  });

  it("leaves the tree as the creator set it during the flight", () => {
    // Why: a creator who opens and folds the rail mid-flight has decided;
    // the landing must not undo that.
    const { store, shell } = onApproach();
    document.getElementById("tree-fold")!.click();
    expect(treeFolded(store)).toBe(false);
    document.getElementById("tree-fold")!.click();
    expect(treeFolded(store)).toBe(true);
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(true);
  });

  it("keeps the tree a tab when the creator takes the camera mid-flight", () => {
    // Why: a takeover (a click, a wheel, "+") can come at any height; the
    // owner found the rail unfolding over the whole globe senseless. The
    // hold ends, so a later landing call does nothing; the creator opens
    // the rail.
    const { store, shell } = onApproach();
    shell.approachEnded("taken");
    expect(treeFolded(store)).toBe(true);
    expect(treeRoot().classList.contains("unfolding")).toBe(false);
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(true);
    shell.hide();
    expect(treeFolded(store)).toBe(true);
  });

  it("opens the list at the landing on a phone", () => {
    // Why: a phone opens on the list, so a landing ends there too; no tab
    // stands for the tree on a phone.
    vi.stubGlobal("innerWidth", 600);
    const { store, shell } = onApproach();
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(false);
  });

  it("keeps a tree the creator had folded when the view closes mid-flight", () => {
    // Why: closing mid-flight gives back the fold the tree had at the
    // open, not an unfolded tree; a creator who had folded the rail must
    // not find it opened by a flight they left.
    const set = setUp();
    set.store.dispatch(
      editorViewActions.dockFolded({ dock: "tree", folded: true }),
    );
    set.shell.hide();
    set.shell.show(fakeView(), { approach: true });
    expect(treeFolded(set.store)).toBe(true);
    set.shell.hide();
    expect(treeFolded(set.store)).toBe(true);
  });

  it("gives the fold back when the view closes mid-flight", () => {
    // Why: the fold was the approach's, not the creator's; the next open
    // (without an approach) starts with the tree as the creator left it.
    const { store, shell } = onApproach();
    shell.hide();
    expect(treeFolded(store)).toBe(false);
    shell.show(fakeView());
    shell.approachEnded("landed");
    expect(treeFolded(store)).toBe(false);
  });
});

// Why: a Save (Ctrl+S, the bar's button) writes the tour as the store
// holds it, and typing that has not been left or paused on yet - in an
// inspector field or in a long text's writer - is not in it. The page asks
// the shell to write that typing first (`flush`); without it a Save while
// typing saved the text without its last words.
describe("a save while typing", () => {
  it("writes the field being typed in when the page flushes", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the fountain");
    shell.flush();
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "By the fountain",
    });
    shell.hide();
  });

  it("writes a long text's typing that has not paused yet when the page flushes", () => {
    const { store, select, edits, shell } = setUp();
    store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [
            {
              ...station("a", 0),
              ...stationContent([
                {
                  id: "essay",
                  kind: "longText",
                  view: "reading",
                  title: "Essay",
                  body: "Old words.",
                  createdAtIso: AT,
                  pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
                },
              ]),
            },
          ],
        },
      }),
    );
    select("essay");
    const area = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="long-text-writer"]',
    );
    if (area === null) throw new Error("no writer");
    area.value = "Old words. New ones";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(edits.block).not.toHaveBeenCalled();
    shell.flush();
    expect(edits.block).toHaveBeenCalledWith(
      "essay",
      "body",
      "Old words. New ones",
    );
    shell.hide();
  });
});

// Why: the preview's head names the view the visitor sees the text in;
// the dock hands it the selected text's view on every draw, so a text
// set to a reading stand must not be headed "Reading sign".
describe("the long text's preview", () => {
  it("names the selected text's view in its head", () => {
    const { store, select, shell } = setUp();
    const essay = (id: string, view: string) =>
      ({
        id,
        kind: "longText",
        view,
        title: "Essay",
        body: "Words.",
        createdAtIso: AT,
        pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
      }) as unknown as TourBlock;
    store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [
            {
              ...station("a", 0),
              ...stationContent([
                essay("stand", "lectern"),
                essay("card", "card"),
              ]),
            },
          ],
        },
      }),
    );
    const head = () => document.querySelector(".lw-vn")?.textContent;
    select("stand");
    expect(head()).toBe("Reading stand");
    select("card");
    expect(head()).toBe("Station card");
    shell.hide();
  });
});

describe("the page keys next to a toolbar", () => {
  // Why: a toolbar moves its focus by the arrows, Home and End. Home on a
  // toolbar button reframed the whole tour behind the writer's toolbar.
  it("leaves Home on a toolbar button to the toolbar, and frames the tour on Home elsewhere", () => {
    const { shell, view } = setUp();
    const bar = document.createElement("div");
    bar.setAttribute("role", "toolbar");
    const bold = document.createElement("button");
    bar.append(bold);
    const plain = document.createElement("button");
    document.body.append(bar, plain);
    const home = () =>
      new KeyboardEvent("keydown", {
        key: "Home",
        code: "Home",
        bubbles: true,
      });
    bold.dispatchEvent(home());
    expect(view.frame).not.toHaveBeenCalled();
    plain.dispatchEvent(home());
    expect(view.frame).toHaveBeenCalledWith(null);
    shell.hide();
  });
});

describe("the bottom panel", () => {
  // Why: the panel's rules and drawing are tested on their own; what only
  // the shell can get wrong is the wiring - the tour's problems reaching
  // the toggle as the tour changes, a problem's row selecting its item and
  // flying to it, the view's tick feeding the numbers, and the page's key
  // handler handing it its keys.
  it("lists the open tour's problems, selects and flies to one, and takes Ctrl+J", () => {
    const { store, shell, view, edits, deps } = setUp();
    const far = station("c", 0.0008);
    store.dispatch(
      tourDocumentActions.opened({
        manifest: {
          ...createEmptyTourManifest(),
          stations: [
            {
              ...far,
              ...stationContent([
                {
                  ...(stationBlocks(far)[0] as object),
                  id: "far",
                  pose: { position: [40, 1.5, 0], rotation: [0, 0, 0, 1] },
                } as unknown as TourBlock,
              ]),
            },
          ],
        },
      }),
    );
    const badge = document.querySelector(
      '#shell-toggles [data-tab="problems"] .badge',
    );
    expect(badge?.textContent).toBe("1");
    const ctrlJ = new KeyboardEvent("keydown", {
      code: "KeyJ",
      key: "j",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ctrlJ);
    expect(document.getElementById("shell-panel")?.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#shell-panel .prow")?.click();
    expect(store.getState().editorView.selected).toBe("far");
    expect(view.flyTo).toHaveBeenCalledWith("far");
    // The row's fix link writes its edit as one step and says so.
    document
      .querySelector<HTMLButtonElement>("#shell-panel .prow .fix")
      ?.click();
    expect(edits.scene).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "item-pose", id: "far" }),
    );
    expect(deps.say).toHaveBeenCalledWith(
      expect.stringMatching(/^Moved ".+" inside its station's circle$/),
    );
    // A refused edit (the page's toast says why) is not announced as done.
    edits.scene.mockReturnValueOnce(false);
    vi.mocked(deps.say).mockClear();
    document
      .querySelector<HTMLButtonElement>("#shell-panel .prow .fix")
      ?.click();
    expect(edits.scene).toHaveBeenCalledTimes(2);
    expect(deps.say).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: the Map loading tab reads the shown view's tiles and asks it to
  // retry; without the wiring the table stays empty and Retry does nothing.
  it("lists the view's map tiles and asks it to retry", () => {
    const { shell, view } = setUp();
    document
      .querySelector<HTMLButtonElement>('#shell-toggles [data-tab="tiles"]')
      ?.click();
    vi.advanceTimersByTime(400);
    expect(
      document.querySelector("#shell-panel table.tiles td.k")?.textContent,
    ).toBe("15/17000/11000");
    document
      .querySelector<HTMLButtonElement>('#shell-panel [data-retry="map"]')
      ?.click();
    expect(view.retryMap).toHaveBeenCalledTimes(1);
    shell.hide();
    expect(document.getElementById("shell-panel")?.hidden).toBe(true);
  });

  it("feeds the view's numbers to the Performance tab on its tick", () => {
    const { shell } = setUp();
    document
      .querySelector<HTMLButtonElement>('#shell-toggles [data-tab="perf"]')
      ?.click();
    vi.advanceTimersByTime(400);
    expect(document.querySelector("#shell-panel .nums")?.textContent).toContain(
      "Average16.0 ms",
    );
    shell.hide();
  });

  // Why: the bottom bar's hint moved into the help; it must still follow
  // the selection.
  it("says in the help what the selection's click does", () => {
    const { select, shell } = setUp();
    const hint = () => document.getElementById("shell-help-hint")?.textContent;
    const none = hint();
    select("station:a");
    expect(hint()).not.toBe(none);
    expect(hint()).not.toBe("");
    shell.hide();
  });
});

describe("the inspector's station extras", () => {
  const openStation = (store: ReturnType<typeof setUp>["store"]) => {
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
  };
  const openPlace = () => {
    document
      .querySelector<HTMLButtonElement>(
        '#shell-inspector [data-act="position"]',
      )
      ?.click();
  };

  // Why: the ring is the 3D view's, the number the inspector's: the drag
  // must reach both, and the tour only once, at the release.
  it("follows the radius slider in the view and writes once", () => {
    const { store, edits, shell, view } = setUp();
    openStation(store);
    openPlace();
    const slider = document.querySelector<HTMLInputElement>(
      "#shell-inspector input[type=range]",
    ) as HTMLInputElement;
    slider.value = "40";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view.previewRadius).toHaveBeenLastCalledWith("a", 40);
    expect(edits.station).not.toHaveBeenCalled();
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(edits.station.mock.calls).toEqual([["a", { foundRadiusM: 40 }]]);
    expect(view.previewRadius).toHaveBeenLastCalledWith("a", null);
    shell.hide();
  });

  // Why: Escape during a drag drops the selection, and the slider with it;
  // no release ever comes, so the ring must be given back here.
  it("gives the ring back when the selection goes during a drag", () => {
    const { store, select, edits, shell, view } = setUp();
    openStation(store);
    openPlace();
    const slider = document.querySelector<HTMLInputElement>(
      "#shell-inspector input[type=range]",
    ) as HTMLInputElement;
    slider.value = "40";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    select(null);
    expect(view.previewRadius).toHaveBeenLastCalledWith("a", null);
    expect(edits.station).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: a tap on a listed item is the tree's tap: selected and flown to.
  it("selects and flies to an item of Contents", () => {
    const { store, shell, view } = setUp();
    openStation(store);
    document
      .querySelector<HTMLButtonElement>('#shell-inspector [data-act="goto:pa"]')
      ?.click();
    expect(store.getState().editorView.selected).toBe("pa");
    expect(view.flyTo).toHaveBeenCalledWith("pa");
    shell.hide();
  });

  it("folds Contents and keeps it folded for the next station", () => {
    const { store, shell } = setUp();
    openStation(store);
    const contents = () =>
      document.querySelector<HTMLButtonElement>(
        '#shell-inspector [data-act="contents"]',
      );
    contents()?.click();
    expect(contents()?.getAttribute("aria-expanded")).toBe("false");
    store.dispatch(editorViewActions.selected({ id: "station:b" }));
    expect(contents()?.getAttribute("aria-expanded")).toBe("false");
    shell.hide();
  });

  // Why: the add menu is the tree's, so the button must open that one
  // menu, for this station, and the choice must add there.
  it("opens the type menu from Add content, adding to the station", () => {
    const { store, edits, shell } = setUp();
    openStation(store);
    document
      .querySelector<HTMLButtonElement>(
        '#shell-inspector [data-act="add-content"]',
      )
      ?.click();
    const item = [
      ...document.querySelectorAll<HTMLElement>(
        '#tree-add-menu [role="menuitem"]',
      ),
    ][0];
    item?.click();
    expect(edits.addItem).toHaveBeenCalledWith("a", "shortText");
    shell.hide();
  });
});

describe("on a phone", () => {
  const sheetShare = () =>
    document.body.style.getPropertyValue("--s-sheet-share");
  const treeDock = () => document.getElementById("shell-tree") as HTMLElement;
  const act = (name: string) =>
    document.querySelector<HTMLButtonElement>(
      `#inspector-head [data-act="${name}"]`,
    );

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 390);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why: the prototype opens on the list; its height shapes the map.
  it("opens with the list as a sheet", () => {
    const { shell } = setUp();
    expect(treeDock().classList.contains("collapsed")).toBe(false);
    expect(sheetShare()).toBe("0.62");
    shell.hide();
    expect(sheetShare()).toBe("");
  });

  it("turns the sheet into the details and back to the list", () => {
    const { store, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    expect(treeDock().classList.contains("collapsed")).toBe(true);
    expect(sheetShare()).toBe("0.66");
    act("back")?.click();
    expect(store.getState().editorView.selected).toBeNull();
    expect(treeDock().classList.contains("collapsed")).toBe(false);
    expect(sheetShare()).toBe("0.62");
    shell.hide();
  });

  // Why: the tree is out of sight under the details, so the menu's way
  // back is the button that opened it, and the add draws that button away.
  it("keeps the focus in sight when the details open the add menu", () => {
    const { store, edits, select, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    const opener = () =>
      document.querySelector<HTMLButtonElement>(
        '#shell-inspector [data-act="add-content"]',
      );
    opener()?.focus();
    opener()?.click();
    const item = document.querySelector<HTMLElement>(
      '#tree-add-menu [role="menuitem"]',
    );
    item?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.activeElement).toBe(opener());
    opener()?.click();
    edits.addItem.mockImplementation(() => {
      select("pa");
    });
    item?.click();
    expect(document.activeElement).toBe(act("close"));
    shell.hide();
  });

  // Why: the close button leaves the map alone, so List is the only way
  // to the tree then.
  it("shows the map alone after a close, and the list on List", () => {
    const { store, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    act("close")?.click();
    expect(store.getState().editorView.selected).toBeNull();
    expect(sheetShare()).toBe("");
    document.getElementById("studio-list")?.click();
    expect(treeDock().classList.contains("collapsed")).toBe(false);
    expect(sheetShare()).toBe("0.62");
    shell.hide();
  });

  it("lets List drop a selection, as the back arrow does", () => {
    const { store, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    document.getElementById("studio-list")?.click();
    expect(store.getState().editorView.selected).toBeNull();
    expect(sheetShare()).toBe("0.62");
    shell.hide();
  });

  // Why: the sheet has no fold, so details folded on a wider window would
  // be a selection with nothing to show it.
  it("unfolds details folded on a wider window", () => {
    const { store, shell } = setUp();
    store.dispatch(
      editorViewActions.dockFolded({ dock: "inspector", folded: true }),
    );
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    expect(store.getState().editorView.foldedDocks.inspector).toBe(false);
    expect(sheetShare()).toBe("0.66");
    shell.hide();
  });

  it("writes no share on a wider window, and takes it when it narrows", () => {
    vi.stubGlobal("innerWidth", 844);
    const { shell } = setUp();
    expect(sheetShare()).toBe("");
    vi.stubGlobal("innerWidth", 390);
    window.dispatchEvent(new Event("resize"));
    expect(sheetShare()).toBe("0.62");
    shell.hide();
  });
});

describe("on a phone's side", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why: the prototype keeps both panels at 844 px, the map between them.
  it("keeps the list open beside the details", () => {
    vi.stubGlobal("innerWidth", 844);
    const { store, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    expect(store.getState().editorView.foldedDocks.tree).toBe(false);
    shell.hide();
  });

  // Why: a phone hides the list behind the details by folding it, and no
  // rule unfolds a dock; turned sideways with something selected, the list
  // stayed a tab where the prototype has it open beside the details.
  it("brings the list back beside the details when the phone turns", () => {
    vi.stubGlobal("innerWidth", 390);
    const { store, shell } = setUp();
    store.dispatch(editorViewActions.selected({ id: "station:a" }));
    expect(store.getState().editorView.foldedDocks.tree).toBe(true);
    vi.stubGlobal("innerWidth", 844);
    window.dispatchEvent(new Event("resize"));
    expect(store.getState().editorView.foldedDocks.tree).toBe(false);
    shell.hide();
  });
});

describe("the inspector's Delete, declined", () => {
  // Why: a station's delete asks first, as a story's does. Answered no,
  // the station stays selected, and the focus must stay on the Delete the
  // creator pressed: moved to a tree card it reads as the delete done, and
  // the next key acts on another row. Answered yes, the focus moves on.
  it.each([
    ["declined", false],
    ["confirmed", true],
  ])("a %s delete: the focus stays on Delete only for a no", (_, yes) => {
    const { deps, select, shell } = setUp();
    vi.mocked(deps.stations.remove).mockImplementation(() => {
      if (yes) select(null);
    });
    select("station:a");
    const del = document.querySelector<HTMLButtonElement>(
      '#shell-inspector [data-act="delete"]',
    );
    if (del === null) throw new Error("no Delete in the inspector");
    del.focus();
    del.click();
    expect(deps.stations.remove).toHaveBeenCalledWith("station:a");
    // On Delete after a no only.
    expect(document.activeElement === del).toBe(!yes);
    shell.hide();
  });
});
