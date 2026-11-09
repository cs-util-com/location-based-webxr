/**
 * Why these tests matter: a kind's own part of the item inspector (a
 * model's notes and sections, a long text's writer) is its panel, one row
 * per kind in `KIND_PANELS`, so the inspector draws no kind by name and a
 * new kind brings its inspector as one row. These hold that every kind of
 * the format has a row, that exactly the model and the long text have a
 * panel today, that each draws what the inspector used to draw itself and
 * answers its own buttons (and no other), and that the inspector puts a
 * panel's pieces in their places and draws no kind's parts without one.
 *
 * @vitest-environment jsdom
 */
import { tourBlockKinds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { describe, expect, it, vi } from "vitest";
import { drawInspector } from "../editor-shell/shell-inspector.js";
import type { ShellPictures } from "../editor-shell/shell-pictures.js";
import type { KindPanelDraw, PanelItem } from "./kind-panel.js";
import {
  KIND_PANELS,
  createKindPanels,
  type PanelContext,
} from "./kind-panels.js";

const PARTS: NonNullable<PanelItem["model"]> = {
  view: "placed",
  notes: [{ title: "Crown", text: "", position: [0, 1, 0] }],
  notesFull: false,
  sections: [{ name: "Cut", position: [0, 0.5, 0], normal: [0, 0, 1] }],
  sectionsFull: false,
  animation: { name: "Swing", autoplay: false },
  focus: null,
  pick: null,
};

function item(over: Partial<PanelItem> = {}): PanelItem {
  return {
    kind: "item",
    itemKind: "model",
    title: "Oak",
    sub: "3D model in Gate",
    stationId: "s",
    text: null,
    sizeM: 2,
    fields: [],
    model: PARTS,
    longText: null,
    offset: { northM: 0, upM: 0, eastM: 0 },
    headingDeg: 0,
    groundOffM: null,
    ...over,
  };
}

const LONG = item({
  itemKind: "longText",
  title: "The gate",
  sizeM: null,
  model: null,
  longText: {
    blockId: "t",
    view: "reading",
    title: "The gate",
    body: "It was built in 1410.",
    hasNarration: false,
    narrationKey: "null|",
    over: "Gate",
    pictures: [],
  },
});

const PIN = item({
  itemKind: "shortText",
  text: "Hi",
  sizeM: null,
  model: null,
});

function context() {
  const edits = {
    block: vi.fn((): "written" => "written"),
    view: vi.fn((): "written" => "written"),
    model: vi.fn((): "written" => "written"),
    narration: vi.fn(() =>
      Promise.resolve({ kind: "refused" as const, reason: "none" }),
    ),
    editNarration: vi.fn(() => Promise.resolve("written" as const)),
  };
  const ctx: PanelContext = {
    document,
    box: document.createElement("div"),
    inspectorRoot: document.createElement("div"),
    treeRoot: null,
    edits,
    loadPicture: () => Promise.reject(new Error("no pictures here")),
    say: vi.fn(),
    changed: vi.fn(),
    pickAsked: vi.fn(),
    focused: vi.fn(),
  };
  return { ctx, edits };
}

const acts = (nodes: readonly Element[]) =>
  nodes.map((n) => n.getAttribute("data-act"));

describe("KIND_PANELS", () => {
  it("has a row for every kind of the format, in its order", () => {
    expect(Object.keys(KIND_PANELS)).toEqual(tourBlockKinds());
  });

  it("gives a panel to the model and the long text only", () => {
    const with_ = Object.entries(KIND_PANELS)
      .filter(([, panel]) => panel !== null)
      .map(([kind]) => kind);
    expect(with_).toEqual(["longText", "model"]);
  });
});

describe("createKindPanels", () => {
  it("draws nothing for no selection and for a kind without a panel", () => {
    const panels = createKindPanels(context().ctx);
    expect(panels.sync(null)).toBeNull();
    expect(panels.sync(PIN)).toBeNull();
  });

  it("draws the selected kind's panel, even when another panel also draws", () => {
    // Why: every panel follows the selection, and one that draws without
    // being selected must not cover the selected kind's draw.
    const panel = (title: string) => () => ({
      sync: () => ({ title }) as unknown as KindPanelDraw,
      act: () => false,
      flush: () => undefined,
    });
    const panels = createKindPanels(context().ctx, {
      ...KIND_PANELS,
      shortText: panel("short"),
      model: panel("model"),
    });
    expect(panels.sync(PIN)).toEqual({ title: "short" });
  });

  it("draws a model's size, view, clip, notes and sections as its parts", () => {
    const draw = createKindPanels(context().ctx).sync(item());
    expect(draw).not.toBeNull();
    expect(draw?.kept).toBeNull();
    expect(draw?.ownsFields).toBe(false);
    expect(draw?.title()).toBeNull();
    expect(draw?.head()).toEqual([]);
    expect(draw?.parts().map((p) => p.className)).toEqual([
      "isec",
      "isec mview",
      "isec manim",
      "isec mnotes",
      "isec msections",
    ]);
  });

  it("answers a model's own buttons, and no other or another kind's", () => {
    const { ctx, edits } = context();
    const panels = createKindPanels(ctx);
    const model = item();
    panels.sync(model);
    expect(panels.act("view:ghost", model, "m")).toBe(true);
    expect(edits.model).toHaveBeenCalledWith("m", {
      kind: "view",
      view: "ghost",
    });
    expect(panels.act("note-add", model, "m")).toBe(true);
    expect(ctx.pickAsked).toHaveBeenCalledWith({ what: "note-add" });
    expect(panels.act("note:0", model, "m")).toBe(true);
    expect(ctx.focused).toHaveBeenCalledWith({ part: "note", index: 0 });
    expect(panels.act("delete", model, "m")).toBe(false);
    expect(panels.act("view:ghost", PIN, "p")).toBe(false);
    expect(edits.model).toHaveBeenCalledTimes(1);
  });

  it("draws a long text's writer, its typed title and its head buttons", () => {
    const panels = createKindPanels(context().ctx);
    const draw = panels.sync(LONG);
    expect(draw?.kept).toBeInstanceOf(HTMLElement);
    expect(draw?.ownsFields).toBe(true);
    const title = draw?.title();
    expect(title).toBeInstanceOf(HTMLInputElement);
    expect((title as HTMLInputElement).dataset["field"]).toBe("title");
    expect((title as HTMLInputElement).defaultValue).toBe("The gate");
    expect(acts(draw?.head() ?? [])).toEqual(["lt-preview", "lt-wide"]);
    const before = draw?.key;
    expect(panels.act("lt-wide", LONG, "t")).toBe(true);
    expect(panels.sync(LONG)?.key).not.toBe(before);
    expect(panels.act("lt-wide", item(), "m")).toBe(false);
  });
});

describe("the inspector and a panel", () => {
  const pictures = {
    show: vi.fn(),
    clear: vi.fn(),
  } as unknown as ShellPictures;

  function dock() {
    const root = document.createElement("div");
    const head = document.createElement("div");
    const body = document.createElement("div");
    root.append(head, body);
    document.body.replaceChildren(root);
    return { root, head, body };
  }

  it("draws no model parts of an item without its panel", () => {
    const d = dock();
    drawInspector(d, item(), { folded: false, positionOpen: false }, pictures);
    expect(d.body.querySelector(".mview, .mnotes, .msections")).toBeNull();
    expect(d.body.querySelector('[data-field="size"]')).toBeNull();
  });

  it("puts a panel's title, head buttons, kept node and parts in their places", () => {
    const d = dock();
    const kept = document.createElement("div");
    kept.className = "kept";
    const button = document.createElement("button");
    button.dataset["act"] = "own";
    const title = document.createElement("span");
    title.className = "own-title";
    const part = document.createElement("div");
    part.className = "own-part";
    const panel: KindPanelDraw = {
      key: "k",
      kept,
      ownsFields: true,
      title: () => title,
      head: () => [button],
      parts: () => [part],
    };
    drawInspector(
      d,
      item({
        fields: [
          {
            name: "title",
            label: "Title",
            value: "Oak",
            prose: false,
            max: 80,
            unit: "codePoints",
            required: false,
          },
        ],
      }),
      { folded: false, positionOpen: false },
      pictures,
      panel,
    );
    const head = [...d.head.children];
    expect(head.indexOf(title)).toBeGreaterThan(0);
    expect(acts(head).slice(head.indexOf(title) + 1)).toEqual([
      "own",
      "fold",
      "close",
    ]);
    const body = [...d.body.children];
    expect(body[0]?.className).toBe("sub");
    expect(body[1]).toBe(kept);
    const acted = body.findIndex((n) => n.classList.contains("acts"));
    expect(body.indexOf(part)).toBeGreaterThan(acted);
    expect(d.body.querySelector('[data-field="title"]')).toBeNull();
  });
});
