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
  writer = createLongTextWriter({
    document,
    kept: createKeptStore(memory()),
    writeBody,
    writeView,
    loadPicture: () => Promise.resolve(new Blob(["x"])),
    say,
    onShow,
    createUrl: () => "blob:x",
    revokeUrl: () => undefined,
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
    // not report that as a failure.
    type("   ");
    vi.advanceTimersByTime(WRITER_SAVE_MS * 3);
    expect(writeBody).not.toHaveBeenCalled();
    writer.flush();
    expect(writeBody).toHaveBeenCalledWith("essay", "   ");
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
