/**
 * Why these tests matter: the writer's buttons and keys are how a creator
 * formats a long text without knowing Markdown. Each must write exactly
 * the marks the tour's reader formats, take them off again on a second
 * press, keep the creator's words and leave the selection where the next
 * keystroke expects it. The cases are the prototype's
 * (`public/prototypes/longtext-editor-1-in-the-inspector/`).
 */
import { describe, expect, it } from "vitest";

import {
  applied,
  continueList,
  indentLines,
  insertBlock,
  lineRange,
  linkEdit,
  linkTarget,
  toggleHeading,
  toggleList,
  touchesList,
  wrapInline,
  type WriterEdit,
} from "./writer-edits.js";

/** `value` with the edit applied (null: unchanged), as text with the
 *  selection marked by `[` and `]` (a caret by `|`). */
function after(value: string, edit: WriterEdit | null): string {
  if (edit === null) return "(none)";
  const { value: out, selection } = applied(value, edit);
  const [a, b] = selection;
  return a === b
    ? `${out.slice(0, a)}|${out.slice(a)}`
    : `${out.slice(0, a)}[${out.slice(a, b)}]${out.slice(b)}`;
}

describe("lineRange", () => {
  it("spans the whole lines a selection touches", () => {
    const v = "one\ntwo\nthree";
    expect(lineRange(v, 5, 5)).toEqual([4, 7]);
    expect(lineRange(v, 1, 9)).toEqual([0, 13]);
    expect(lineRange(v, 0, 0)).toEqual([0, 3]);
  });

  it("holds a selection outside the text inside it", () => {
    expect(lineRange("ab", -4, 99)).toEqual([0, 2]);
    expect(lineRange("ab", Number.NaN, 1)).toEqual([0, 2]);
  });
});

describe("wrapInline", () => {
  it("wraps the selection, its spaces left outside", () => {
    const v = "a bold word";
    expect(after(v, wrapInline(v, 1, 7, "**"))).toBe("a **[bold]** word");
  });

  it("takes the marks off words already marked", () => {
    const v = "a **bold** word";
    expect(after(v, wrapInline(v, 4, 8, "**"))).toBe("a [bold] word");
    expect(after(v, wrapInline(v, 2, 10, "**"))).toBe("a [bold] word");
  });

  it("does not read a bold's star as italic's mark", () => {
    const v = "a **bold** word";
    expect(after(v, wrapInline(v, 4, 8, "*"))).toBe("a ***[bold]*** word");
  });

  it("puts the two marks round the caret with no selection", () => {
    expect(after("ab", wrapInline("ab", 1, 1, "*"))).toBe("a*|*b");
  });
});

describe("toggleList", () => {
  it("makes lines a bulleted list, keeping blank lines", () => {
    const v = "one\n\ntwo";
    expect(after(v, toggleList(v, 0, 8, "bullet"))).toBe("- one\n\n- two|");
  });

  it("numbers lines and takes a heading's marks off", () => {
    const v = "## one\ntwo";
    expect(after(v, toggleList(v, 0, 10, "number"))).toBe("1. one\n2. two|");
  });

  it("makes a list plain again when every line already is one", () => {
    const v = "- one\n  - two";
    expect(after(v, toggleList(v, 0, 13, "bullet"))).toBe("one\n  two|");
  });

  it("turns a numbered list bulleted rather than plain", () => {
    const v = "1. one";
    expect(after(v, toggleList(v, 0, 0, "bullet"))).toBe("- one|");
  });
});

describe("toggleHeading", () => {
  it("makes a line a heading and a subheading", () => {
    expect(after("Title", toggleHeading("Title", 2, 2, 2))).toBe("## Title|");
    expect(after("## Title", toggleHeading("## Title", 2, 2, 3))).toBe(
      "### Title|",
    );
  });

  it("makes a heading plain again", () => {
    expect(after("### Sub", toggleHeading("### Sub", 0, 0, 3))).toBe("Sub|");
  });

  it("does not count a subheading as a heading", () => {
    expect(after("### Sub", toggleHeading("### Sub", 0, 0, 2))).toBe("## Sub|");
  });

  it("changes nothing on an empty line", () => {
    expect(toggleHeading("", 0, 0, 2)).toBeNull();
  });
});

describe("indentLines", () => {
  it("moves list lines in and out, other lines left", () => {
    const v = "intro\n- one";
    expect(after(v, indentLines(v, 0, 11, "in"))).toBe("intro\n  - one|");
    const w = "  - one";
    expect(after(w, indentLines(w, 0, 0, "out"))).toBe("- one|");
  });

  it("does nothing outside a list, which touchesList tells", () => {
    expect(indentLines("plain", 0, 0, "in")).toBeNull();
    expect(touchesList("plain", 0, 0)).toBe(false);
    expect(touchesList("a\n- b", 0, 3)).toBe(true);
  });
});

describe("continueList", () => {
  it("starts the next line with the same bullet or the next number", () => {
    expect(after("- one", continueList("- one", 5))).toBe("- one\n- |");
    expect(after("  9) nine", continueList("  9) nine", 9))).toBe(
      "  9) nine\n  10) |",
    );
  });

  it("ends the list on a line with no words", () => {
    expect(after("- one\n- ", continueList("- one\n- ", 8))).toBe("- one\n|");
  });

  it("is an ordinary line break before the mark's end and outside a list", () => {
    expect(continueList("- one", 1)).toBeNull();
    expect(continueList("plain", 5)).toBeNull();
  });
});

describe("insertBlock", () => {
  it("puts a picture on a paragraph of its own after the caret's line", () => {
    const v = "One.\nTwo.";
    expect(after(v, insertBlock(v, 1, "![A](asset:a)"))).toBe(
      // A blank line after it too: "Two." on the next line would join the
      // picture's paragraph.
      "One.\n\n[![A](asset:a)]\n\nTwo.",
    );
  });

  it("uses an empty line where the caret is, without extra blank lines", () => {
    const v = "One.\n\n\n\nTwo.";
    expect(after(v, insertBlock(v, 6, "P"))).toBe("One.\n\n[P]\n\nTwo.");
    expect(after("", insertBlock("", 0, "P"))).toBe("[P]");
  });
});

describe("linkTarget and linkEdit", () => {
  it("puts https:// in front of a bare address", () => {
    expect(linkTarget(" example.org ")).toBe("https://example.org");
    expect(linkTarget("//example.org")).toBe("https://example.org");
    expect(linkTarget("http://a.b")).toBe("http://a.b");
    expect(linkTarget("mailto:x@y.z")).toBe("mailto:x@y.z");
    expect(linkTarget("  ")).toBeNull();
  });

  it("makes the selected words the link, else the address", () => {
    const v = "see the archive";
    expect(after(v, linkEdit(v, 8, 15, "example.org"))).toBe(
      "see the [[archive]](https://example.org)",
    );
    expect(after("", linkEdit("", 0, 0, "a.b"))).toBe(
      "[[https://a.b]](https://a.b)",
    );
    expect(linkEdit(v, 0, 3, "")).toBeNull();
  });
});
