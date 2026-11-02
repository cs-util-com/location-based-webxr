// @vitest-environment jsdom
/**
 * Why these tests matter: the writer is where a creator's words live
 * while they type, so three things are pinned here, outside a browser.
 * First the invariant the plan makes the writer's promise: no action but
 * writing (typing, the toolbar and its shortcuts, "Make it plain text",
 * a tour picture in place of a part) ever changes the text - not the view
 * picker, not keeping a part as typed, not the list, the help or the
 * preview's flash. Second the save line's states for a write the tour
 * takes and one it refuses (the async-feedback rule): "Saving..." while
 * typing pauses, then "Saved" or "Not saved". Third the parts shown as
 * typed: counted, explained at the cursor, kept on request.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { InspectorLongText } from "../editor-shell/inspector-model.js";
import { createKeptStore, type KeptStorage } from "./kept-store.js";
import {
  createLongTextWriter,
  WRITER_SAVE_MS,
  type LongTextWriter,
  type LongTextWriterDeps,
} from "./long-text-writer.js";

const BODY = "## Gate\nUse `code` here.\n\n- one\n- two\n\n#### Small";

function model(over: Partial<InspectorLongText> = {}): InspectorLongText {
  return {
    blockId: "essay",
    view: "reading",
    title: "The gate",
    body: BODY,
    hasNarration: false,
    narrationKey: "null|",
    over: "Gate · Station 1",
    pictures: [
      {
        id: "tower-photo",
        path: "content/tower-photo.jpg",
        label: "tower-photo.jpg",
      },
    ],
    ...over,
  };
}

function memory(): KeptStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

let writer: LongTextWriter;
let writeBody: Mock<LongTextWriterDeps["writeBody"]>;
let writeView: Mock<LongTextWriterDeps["writeView"]>;
let say: Mock<(text: string) => void>;
let onShow: Mock<(from: number, to: number, body: string) => void>;
let createUrl: Mock<(blob: Blob) => string>;
let revokeUrl: Mock<(url: string) => void>;

const q = <E extends Element = HTMLElement>(sel: string): E => {
  const e = writer.node.querySelector<E>(sel);
  if (e === null) throw new Error(`no ${sel}`);
  return e;
};
const click = (act: string) => {
  q(`[data-lw="${act}"]`).click();
};
const saveText = () => q(".lw-save").textContent;
const type = (value: string) => {
  writer.area.value = value;
  writer.area.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  writer.area.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  writeBody = vi.fn((): "written" => "written");
  writeView = vi.fn((): "written" => "written");
  say = vi.fn();
  onShow = vi.fn();
  let urls = 0;
  createUrl = vi.fn(() => `blob:${String(++urls)}`);
  revokeUrl = vi.fn();
  writer = createLongTextWriter({
    document,
    kept: createKeptStore(memory()),
    writeBody,
    writeView,
    loadPicture: () => Promise.resolve(new Blob(["x"])),
    say,
    onShow,
    createUrl,
    revokeUrl,
  });
  document.body.replaceChildren(writer.node);
  writer.update(model());
});

afterEach(() => {
  writer.destroy();
  vi.useRealTimers();
});

describe("the writer's text", () => {
  it("shows the tour's text and counts its words", () => {
    expect(writer.area.value).toBe(BODY);
    expect(q(".lw-stat").textContent).toMatch(/\d+ words · 1 min read/);
  });

  it("says Saving... while typing pauses, then Saved once the tour took it", () => {
    type(`${BODY} more`);
    expect(saveText()).toBe("Saving...");
    expect(writeBody).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WRITER_SAVE_MS);
    expect(writeBody).toHaveBeenCalledWith("essay", `${BODY} more`);
    expect(saveText()).toBe("Saved");
  });

  it("says Not saved when the tour refuses the text", () => {
    writeBody.mockReturnValue("refused");
    type(`${BODY} more`);
    vi.advanceTimersByTime(WRITER_SAVE_MS);
    expect(saveText()).toBe("Not saved");
  });

  it("writes an emptied text only when it is left, not on a pause", () => {
    // Why: the tour refuses an empty text; a pause while rewriting must
    // not report that as a failure. Written as the tour keeps a text
    // (`norm`): the spaces alone are an empty text.
    type("   ");
    vi.advanceTimersByTime(WRITER_SAVE_MS * 3);
    expect(writeBody).not.toHaveBeenCalled();
    writer.flush();
    expect(writeBody).toHaveBeenCalledWith("essay", "");
  });

  it("writes typed text at once when it is flushed, and once only", () => {
    type(`${BODY}!`);
    writer.flush();
    vi.advanceTimersByTime(WRITER_SAVE_MS);
    expect(writeBody).toHaveBeenCalledTimes(1);
  });

  it("keeps a space typed at the end while the tour stores the text without it", () => {
    // Why: the tour trims a text it stores; the store's answer arrives
    // during the write, and showing it would eat the space under the
    // creator's cursor at every pause.
    writeBody.mockImplementation((_id: string, body: string) => {
      writer.update(model({ body: body.trim() }));
      return "written";
    });
    type(`${BODY} more `);
    vi.advanceTimersByTime(WRITER_SAVE_MS);
    expect(writer.area.value).toBe(`${BODY} more `);
    expect(saveText()).toBe("Saved");
    writer.update(model({ body: `${BODY} more` }));
    expect(writer.area.value).toBe(`${BODY} more `);
    type(`${BODY} more  `);
    vi.advanceTimersByTime(WRITER_SAVE_MS);
    expect(writeBody).toHaveBeenCalledTimes(1);
  });

  it("follows a change from outside (the tour's undo)", () => {
    writer.update(model({ body: "Undone." }));
    expect(writer.area.value).toBe("Undone.");
  });

  it("starts afresh for another text, writing the first one's typing first", () => {
    type(`${BODY}!`);
    writer.update(model({ blockId: "other", body: "Other." }));
    expect(writeBody).toHaveBeenCalledWith("essay", `${BODY}!`);
    expect(writer.area.value).toBe("Other.");
    expect(saveText()).toBe("Saved");
  });
});

describe("writing with the toolbar and the keys", () => {
  it("makes the selected words bold", () => {
    writer.area.setSelectionRange(3, 7);
    click("bold");
    expect(writer.area.value.startsWith("## **Gate**")).toBe(true);
  });

  it("continues a list on Enter", () => {
    const at = BODY.indexOf("- two") + 5;
    writer.area.setSelectionRange(at, at);
    const event = key({ key: "Enter" });
    expect(event.defaultPrevented).toBe(true);
    expect(writer.area.value).toContain("- two\n- ");
  });

  it("nests a list line on Tab, but leaves the writer on Esc then Tab", () => {
    const at = BODY.indexOf("- two") + 3;
    writer.area.setSelectionRange(at, at);
    expect(key({ key: "Tab" }).defaultPrevented).toBe(true);
    expect(writer.area.value).toMatch(/\n\s+- two/);
    const before = writer.area.value;
    key({ key: "Escape" });
    expect(key({ key: "Tab" }).defaultPrevented).toBe(false);
    expect(writer.area.value).toBe(before);
  });

  it("keeps Esc in the writer: the page, which deselects on Esc, never sees it", () => {
    // Why: the page's Esc deselects the item, which closed the writer
    // under the creator's hands; an input method's Esc (ending a
    // composition) did the same.
    const page = vi.fn();
    document.addEventListener("keydown", page);
    key({ key: "Escape" });
    key({ key: "Escape", isComposing: true });
    document.removeEventListener("keydown", page);
    expect(page).not.toHaveBeenCalled();
    expect(writer.node.isConnected).toBe(true);
  });

  it("does not leave on Tab after an input method's Esc", () => {
    // Why: that Esc ends a composition; it is no request to leave, so the
    // Tab after it still nests the list line.
    const at = BODY.indexOf("- two") + 3;
    writer.area.setSelectionRange(at, at);
    key({ key: "Escape", isComposing: true });
    expect(key({ key: "Tab" }).defaultPrevented).toBe(true);
  });

  it("leaves on Esc then Shift+Tab: the Shift key's own keydown keeps the Esc", () => {
    // Why: Shift is pressed before Tab and fires a keydown of its own,
    // which reset the Esc, so Shift+Tab outdented instead of leaving.
    const at = BODY.indexOf("- two") + 3;
    writer.area.setSelectionRange(at, at);
    key({ key: "Escape" });
    key({ key: "Shift", shiftKey: true });
    expect(key({ key: "Tab", shiftKey: true }).defaultPrevented).toBe(false);
    expect(writer.area.value).toBe(BODY);
  });

  it("explains indent outside a list instead of writing", () => {
    writer.area.setSelectionRange(1, 1);
    click("indent");
    expect(writer.area.value).toBe(BODY);
    expect(say).toHaveBeenCalledWith(
      expect.stringMatching(/Put the cursor in a list/),
    );
  });

  it("puts in a tour picture with its name's words selected to type over", () => {
    writer.area.setSelectionRange(BODY.length, BODY.length);
    click("picture");
    click("pic:tower-photo");
    expect(writer.area.value).toContain("![tower photo](asset:tower-photo)");
    const { selectionStart, selectionEnd, value } = writer.area;
    expect(value.slice(selectionStart, selectionEnd)).toBe("tower photo");
  });
});

describe("the parts shown as typed", () => {
  it("counts them in the chip and lists them by line", () => {
    expect(q(".lw-chip").textContent).toMatch(/^2 parts shown as typed/);
    click("parts");
    const rows = [...writer.node.querySelectorAll(".lw-list button.lw-iss")];
    expect(rows.map((r) => r.querySelector(".lw-l")?.textContent)).toEqual([
      "line 2",
      "line 7",
    ]);
  });

  it("explains the part at the cursor, and goes to the next one", () => {
    const at = BODY.indexOf("`code`") + 2;
    writer.area.focus();
    writer.area.setSelectionRange(at, at);
    writer.area.dispatchEvent(new Event("keyup"));
    expect(q(".lw-callout").hidden).toBe(false);
    expect(q(".lw-callout").textContent).toMatch(/line 2/);
    click("part-next");
    expect(q(".lw-callout").textContent).toMatch(/line 7/);
    expect(onShow).toHaveBeenCalledWith(
      BODY.indexOf("#### Small"),
      BODY.length,
      BODY,
    );
  });

  it("makes a part plain text, keeping its words", () => {
    click("parts");
    click("part:0");
    click("part-fix");
    expect(writer.area.value).toContain("code");
    expect(writer.area.value).not.toContain("`code`");
    expect(q(".lw-chip").textContent).toMatch(/^1 part shown as typed/);
  });

  it("keeps a part as typed without touching the text, and marks it again", () => {
    click("parts");
    click("part:0");
    click("part-keep");
    expect(writer.area.value).toBe(BODY);
    expect(q(".lw-chip").textContent).toMatch(/^1 part shown as typed/);
    // The list, still open, names it under "Kept as typed".
    expect(q(".lw-list").hidden).toBe(false);
    expect(q(".lw-list").textContent).toMatch(/Kept as typed, on purpose/);
    click("unkeep:0");
    expect(q(".lw-chip").textContent).toMatch(/^2 parts shown as typed/);
  });
});

describe("the view picker", () => {
  it("writes Reading sign for a text on a stand", () => {
    writer.update(model({ view: "lectern" }));
    click("view:reading");
    expect(writeView).toHaveBeenCalledWith("essay", "reading");
  });

  it("explains a dimmed Captions and offers a narration's spot", () => {
    click("view:captions");
    expect(writeView).not.toHaveBeenCalled();
    expect(q(".lw-vdesc").textContent).toMatch(/need a narration/);
    click("add-narration");
    expect(q(".lw-nbody").hidden).toBe(false);
    expect(document.activeElement).toBe(q('[data-lw="narration"]'));
  });

  it("moves along the segments with the arrow keys, focus following", () => {
    q('[data-lw="view:reading"]').focus();
    q('[data-lw="view:reading"]').dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement).toBe(q('[data-lw="view:silent"]'));
    expect(writeView).not.toHaveBeenCalled();
  });
});

describe("one form of the text", () => {
  // Why: the writer, the tour and every other field must agree on when two
  // texts are the same. The tour keeps a text in NFC (as every field the
  // editor writes, `input-text.ts`), with plain line ends and without the
  // spaces around it; compared or written in another form, a text that
  // reads the same was written again (a change to save) merely by being
  // selected.
  it("writes the text in NFC, as every other field", () => {
    type("Café au lait");
    writer.flush();
    expect(writeBody).toHaveBeenCalledWith("essay", "Café au lait");
  });

  it("writes nothing for a text stored with Windows line ends that is only selected and left", () => {
    writer.update(model({ blockId: "crlf", body: "One\r\nTwo" }));
    // As a browser's text area holds it: its value has plain line ends.
    writer.area.value = "One\nTwo";
    writer.flush();
    expect(writeBody).not.toHaveBeenCalled();
    expect(saveText()).toBe("Saved");
  });

  it("writes nothing for a text stored decomposed that is only selected and left", () => {
    writer.update(model({ blockId: "nfd", body: "Café" }));
    writer.area.value = "Café";
    writer.flush();
    expect(writeBody).not.toHaveBeenCalled();
  });
});

describe("the length cap", () => {
  it("counts toward the 32,000 near the cap, and says nothing well below it", () => {
    expect(q(".lw-stat").textContent).not.toMatch(/of 32,000/);
    type("x".repeat(31_000));
    expect(q(".lw-stat").textContent).toMatch(/31,000 of 32,000/);
  });

  it("keeps a refused text for its block until it is written: leaving and coming back shows it again", () => {
    // Why: a text over the cap is refused when it is left, and was then
    // thrown away: coming back showed the tour's older text, the typing
    // lost without a word.
    writeBody.mockReturnValue("refused");
    const long = "x".repeat(32_001);
    type(long);
    writer.update(model({ blockId: "other", body: "Other." }));
    expect(writeBody).toHaveBeenCalledWith("essay", long);
    writer.update(null);
    writer.update(model());
    expect(writer.area.value).toBe(long);
    expect(saveText()).toBe("Not saved");
    // Shortened and written, it is the tour's again.
    writeBody.mockReturnValue("written");
    type("Short now.");
    writer.flush();
    writer.update(model({ blockId: "other", body: "Other." }));
    writer.update(model());
    expect(writer.area.value).toBe(BODY);
  });

  it("never keeps an emptied text: coming back shows the tour's text again", () => {
    // Why: the tour refuses an empty text, and a kept refused text hides
    // the tour's text with no way back; for an emptied text that is a
    // creator who cleared the field and finds it still empty (the r1011
    // review's finding 2), so only a text with words in it is kept.
    writeBody.mockReturnValue("refused");
    type("  \n ");
    writer.update(model({ blockId: "other", body: "Other." }));
    expect(writeBody).toHaveBeenCalledWith("essay", "");
    writer.update(model());
    expect(writer.area.value).toBe(BODY);
    expect(saveText()).toBe("Saved");
  });

  it("drops a kept refused text once the tour's own text changed (an undo, another tour)", () => {
    writeBody.mockReturnValue("refused");
    type("x".repeat(32_001));
    writer.update(model({ blockId: "other", body: "Other." }));
    writer.update(model({ body: "Changed meanwhile." }));
    expect(writer.area.value).toBe("Changed meanwhile.");
    expect(saveText()).toBe("Saved");
  });
});

describe("the formatting toolbar", () => {
  // Why: a toolbar is one tab stop with arrow keys inside it (the ARIA
  // toolbar pattern); eleven tab stops before the text made the keyboard
  // path to the writing slow.
  it("is one tab stop, moved along by the arrow keys, Home and End", () => {
    const tools = q('[role="toolbar"]');
    const buttons = [...tools.querySelectorAll<HTMLButtonElement>(".lw-wb")];
    const stops = () => buttons.filter((b) => b.tabIndex === 0);
    expect(stops()).toEqual([buttons[0]]);
    const press = (k: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    buttons[0]?.focus();
    press("ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops()).toEqual([buttons[1]]);
    press("End");
    expect(document.activeElement).toBe(buttons.at(-1));
    press("ArrowRight");
    expect(document.activeElement).toBe(buttons[0]);
    press("ArrowLeft");
    expect(document.activeElement).toBe(buttons.at(-1));
    press("Home");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("names the list the parts chip opens", () => {
    const chip = q('[data-lw="parts"]');
    const list = q(".lw-list");
    expect(list.id).not.toBe("");
    expect(chip.getAttribute("aria-controls")).toBe(list.id);
  });
});

describe("the Narration section without a narration editor", () => {
  it("says in the creator's words that a narration is not added here", () => {
    // Why: the placeholder spoke of "a voice and its timing" being "not
    // offered", a developer's wording a creator cannot act on.
    expect(writer.node.textContent).toContain(
      "A narration cannot be added on this page.",
    );
    expect(writer.node.textContent).not.toContain("not offered");
  });
});

describe("picture thumbnails", () => {
  it("are released when the writer is emptied and when the tour's pictures change", async () => {
    // Why: a thumbnail is a blob address kept by the picture's path; kept
    // for the page's life, a picture replaced under the same path showed
    // its old look, and every address stayed allocated.
    const loaded = async () => {
      click("picture");
      await vi.waitFor(() => {
        expect(createUrl).toHaveBeenCalled();
      });
      click("pic-cancel");
    };
    await loaded();
    expect(revokeUrl).not.toHaveBeenCalled();
    writer.update(
      model({
        pictures: [
          { id: "tower-photo", path: "content/tower-2.jpg", label: "t.jpg" },
        ],
      }),
    );
    expect(revokeUrl).toHaveBeenCalledWith("blob:1");
    createUrl.mockClear();
    await loaded();
    writer.update(null);
    expect(revokeUrl).toHaveBeenCalledWith("blob:2");
  });

  it("never keeps a thumbnail that finished loading after they were released", async () => {
    // Why: a picture read that lands after the writer was emptied made a
    // blob address no release would ever see again, so it stayed
    // allocated for the page's life.
    let land: ((blob: Blob) => void) | undefined;
    writer.destroy();
    writer = createLongTextWriter({
      document,
      kept: createKeptStore(memory()),
      writeBody,
      writeView,
      loadPicture: () =>
        new Promise<Blob>((resolve) => {
          land = resolve;
        }),
      say,
      onShow,
      createUrl,
      revokeUrl,
    });
    document.body.replaceChildren(writer.node);
    writer.update(model());
    click("picture");
    await vi.waitFor(() => {
      expect(land).toBeDefined();
    });
    writer.update(null);
    land?.(new Blob(["x"]));
    await Promise.resolve();
    await Promise.resolve();
    const made = createUrl.mock.results.map((r) => r.value as string);
    for (const url of made) expect(revokeUrl).toHaveBeenCalledWith(url);
    // A read after the release is kept as before.
    land = undefined;
    writer.update(model());
    click("picture");
    await vi.waitFor(() => {
      expect(land).toBeDefined();
    });
    land?.(new Blob(["x"]));
    await vi.waitFor(() => {
      expect(createUrl).toHaveBeenCalledTimes(made.length + 1);
    });
  });
});

describe("only writing changes the text", () => {
  it("leaves the text alone for every other action", () => {
    // Why: the plan's invariant. Each of these opens, explains, navigates
    // or chooses; none may edit the creator's words or write them.
    const actions: (() => void)[] = [
      () => click("view:reading"),
      () => click("view:silent"),
      () => click("view:captions"),
      () => click("add-narration"),
      () => click("narration"),
      () => click("narration"),
      () => click("help"),
      () => click("help"),
      () => click("link"),
      () => click("link-cancel"),
      () => click("picture"),
      () => click("pic-cancel"),
      () => click("parts"),
      () => click("part:0"),
      () => click("part-next"),
      () => click("part-prev"),
      () => click("part-keep"),
      () => click("unkeep:0"),
      () => click("parts"),
      () => key({ key: "Escape" }),
      () => key({ key: "Tab" }),
      () => key({ key: "ArrowDown" }),
    ];
    for (const act of actions) {
      act();
      expect(writer.area.value).toBe(BODY);
    }
    writer.flush();
    vi.advanceTimersByTime(WRITER_SAVE_MS * 2);
    expect(writeBody).not.toHaveBeenCalled();
    expect(saveText()).toBe("Saved");
  });
});
