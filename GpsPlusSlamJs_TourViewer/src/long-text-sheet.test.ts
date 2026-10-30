// @vitest-environment jsdom
/**
 * Why this test matters: the reading sheet is where a visitor reads a
 * long text on the screen. These pin what the prototype's "sound off"
 * sheet says (the line under the title, the readout, the credit), that
 * the reading mark moves only within the text and the readout follows
 * it, that a link asks before it leaves an AR session and opens only on
 * yes, and that closing the sheet gives back every picture's memory and
 * its reading mark - a sheet that kept them would leak on every open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLongTextSheet,
  LONG_TEXT_MARK,
  readMinutes,
  sheetMeta,
  SHEET_CREDIT,
  wordCount,
  type LongTextSheetDeps,
} from "./long-text-sheet.js";

const BODY = [
  "# The square",
  "",
  "The old hall burned in 1612. It was built again in stone.",
  "",
  "See [the town map](https://example.org/map) for the way.",
].join("\n");

function q(root: ParentNode, id: string): HTMLElement {
  const e = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (e === null) throw new Error(`no ${id}`);
  return e;
}

function make(over: Partial<LongTextSheetDeps> = {}) {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const opened: string[] = [];
  const closed: number[] = [];
  const sheet = createLongTextSheet({
    host,
    loadAsset: () => Promise.reject(new Error("no pictures here")),
    arActive: () => false,
    openLink: (href) => opened.push(href),
    onClose: () => closed.push(1),
    ...over,
  });
  return { host, sheet, opened, closed };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the words around the text", () => {
  it("reads at 200 words a minute, at least one minute", () => {
    expect(readMinutes(0)).toBe(1);
    expect(readMinutes(99)).toBe(1);
    expect(readMinutes(300)).toBe(2);
    expect(readMinutes(1928)).toBe(10);
    expect(readMinutes(Number.NaN)).toBe(1);
  });

  it("says the words, the minutes and that the sound is off", () => {
    expect(sheetMeta(1928)).toBe(
      "1,928 words · about 10 min to read · sound off",
    );
  });

  it("counts the words a visitor reads, not the markup", () => {
    expect(
      wordCount("# Two words\n\n*one* [two](https://example.org) three"),
    ).toBe(5);
  });
});

describe("the reading sheet", () => {
  it("is built closed, and opens on a text with its title, line and readout", () => {
    const { host, sheet } = make();
    expect(sheet.isOpen()).toBe(false);
    expect(q(host, "long-text-sheet").hidden).toBe(true);
    sheet.show({
      over: "Old square · Station 1",
      title: "The hall",
      body: BODY,
    });
    expect(q(host, "long-text-sheet").hidden).toBe(false);
    expect(q(host, "long-text-over").textContent).toBe(
      "Old square · Station 1",
    );
    expect(q(host, "long-text-title").textContent).toBe("The hall");
    expect(q(host, "long-text-meta").textContent).toBe(
      sheetMeta(wordCount(BODY)),
    );
    expect(q(host, "long-text-credit").textContent).toBe(SHEET_CREDIT);
    expect(q(host, "long-text-text").querySelector("h3")?.textContent).toBe(
      "The square",
    );
    // Four sentences in three blocks: the heading, two, one.
    expect(sheet.state()).toMatchObject({
      open: true,
      sentence: 0,
      sentences: 4,
      paragraph: 0,
      paragraphs: 3,
    });
    expect(q(host, "long-text-position").textContent).toBe("Sentence 1 of 4");
    expect(q(host, "long-text-paragraph").textContent).toBe("¶ 1/3");
    expect(q(host, "long-text-percent").textContent).toBe("25%");
    // A tick at the start of each paragraph after the first.
    expect(host.querySelectorAll(".lt-tick")).toHaveLength(2);
  });

  it("names an untitled text and hides an empty line above the title", () => {
    const { host, sheet } = make();
    sheet.show({ over: "", title: "", body: "Words." });
    expect(q(host, "long-text-title").textContent).toBe("Untitled");
    expect(q(host, "long-text-over").hidden).toBe(true);
  });

  it("moves the mark with the buttons and the bar's keys, never past the ends", () => {
    const { host, sheet } = make();
    sheet.show({ over: "", title: "T", body: BODY });
    q(host, "long-text-prev").click();
    expect(sheet.state().sentence).toBe(0);
    q(host, "long-text-next").click();
    q(host, "long-text-next").click();
    expect(sheet.state()).toMatchObject({ sentence: 2, paragraph: 1 });
    expect(q(host, "long-text-position").textContent).toBe("Sentence 3 of 4");
    expect(q(host, "long-text-paragraph").textContent).toBe("¶ 2/3");
    const bar = q(host, "long-text-bar");
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(sheet.state().sentence).toBe(3);
    q(host, "long-text-next").click();
    expect(sheet.state().sentence).toBe(3);
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(sheet.state().sentence).toBe(0);
  });

  it("keeps the place at a tapped sentence, but not on a tap on a link", () => {
    let at: { node: Node; offset: number } | null = null;
    const { host, sheet } = make({ caretAt: () => at });
    sheet.show({ over: "", title: "T", body: BODY });
    const second = q(host, "long-text-text").querySelectorAll("p")[0]
      ?.firstChild;
    if (second === null || second === undefined) throw new Error("no text");
    at = { node: second, offset: 40 };
    q(host, "long-text-text").click();
    expect(sheet.state().sentence).toBe(2);
    const link = q(host, "long-text-text").querySelector("a");
    at = { node: second, offset: 0 };
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(sheet.state().sentence).toBe(2);
  });

  it("asks before a link leaves an AR session, and opens it only on yes", async () => {
    const { host, sheet, opened } = make({ arActive: () => true });
    sheet.show({ over: "", title: "T", body: BODY });
    const link = q(host, "long-text-text").querySelector("a");
    if (link === null) throw new Error("no link");
    const tap = (): boolean =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    expect(tap()).toBe(false);
    const ask = q(host, "long-text-ask");
    expect(ask.hidden).toBe(false);
    expect(ask.textContent).toContain(
      "Open example.org? You may lose your place in the AR view.",
    );
    ask.querySelector<HTMLButtonElement>(".lt-ask-stay")?.click();
    await Promise.resolve();
    expect(ask.hidden).toBe(true);
    expect(opened).toEqual([]);
    tap();
    ask.querySelector<HTMLButtonElement>(".lt-ask-open")?.click();
    await Promise.resolve();
    expect(opened).toEqual(["https://example.org/map"]);
  });

  it("lets a link open by itself outside AR", () => {
    const { host, sheet, opened } = make();
    sheet.show({ over: "", title: "T", body: BODY });
    const link = q(host, "long-text-text").querySelector("a");
    const notPrevented = link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(notPrevented).toBe(true);
    expect(q(host, "long-text-ask").hidden).toBe(true);
    expect(opened).toEqual([]);
  });

  it("closes on its button and on Escape, and says so once each time", () => {
    const { host, sheet, closed } = make();
    sheet.show({ over: "", title: "T", body: BODY });
    q(host, "long-text-close").click();
    expect(sheet.isOpen()).toBe(false);
    expect(q(host, "long-text-sheet").hidden).toBe(true);
    expect(q(host, "long-text-text").childNodes).toHaveLength(0);
    sheet.close();
    expect(closed).toEqual([1]);
    sheet.show({ over: "", title: "T", body: BODY });
    q(host, "long-text-sheet").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(sheet.isOpen()).toBe(false);
    expect(closed).toEqual([1, 1]);
  });

  it("hides the controls for a text with no sentences", () => {
    const { host, sheet } = make();
    sheet.show({ over: "", title: "T", body: "" });
    expect(q(host, "long-text-foot").hidden).toBe(true);
    expect(sheet.state()).toMatchObject({ sentence: -1, sentences: 0 });
    sheet.goTo(3);
    expect(sheet.state().sentence).toBe(-1);
  });

  it("dispose takes the sheet out of the page", () => {
    const { host, sheet } = make();
    sheet.dispose();
    expect(host.querySelector('[data-testid="long-text-sheet"]')).toBeNull();
  });
});

describe("the reading mark and the pictures", () => {
  const registry = new Map<string, unknown>();
  class FakeHighlight {
    readonly ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }

  beforeEach(() => {
    registry.clear();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", FakeHighlight);
    // Every box overlaps the view, so a picture is near enough to show.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks the current sentence and lets the mark go on close", () => {
    const { host, sheet } = make();
    sheet.show({ over: "", title: "T", body: BODY });
    expect(sheet.state().marked).toBe(true);
    q(host, "long-text-next").click();
    const mark = registry.get(LONG_TEXT_MARK) as FakeHighlight | undefined;
    expect(mark?.ranges[0]?.toString()).toBe("The old hall burned in 1612.");
    sheet.close();
    expect(registry.has(LONG_TEXT_MARK)).toBe(false);
  });

  it("shows a near picture and gives its URL back on close", async () => {
    const urls: string[] = [];
    const revoked: string[] = [];
    const { host, sheet } = make({
      loadAsset: () => Promise.resolve(new Blob(["x"])),
      fit: () => Promise.resolve({ ok: true, pixels: 10_000 }),
      createUrl: () => {
        const u = `blob:picture-${String(urls.length)}`;
        urls.push(u);
        return u;
      },
      revokeUrl: (u) => revoked.push(u),
    });
    sheet.show({
      over: "",
      title: "T",
      body: "Before.\n\n![The front](asset:front)\n\nAfter.",
    });
    await vi.waitFor(() => {
      expect(
        q(host, "long-text-text").querySelector("img")?.getAttribute("src"),
      ).toBe("blob:picture-0");
    });
    sheet.close();
    expect(revoked).toEqual(["blob:picture-0"]);
  });
});
