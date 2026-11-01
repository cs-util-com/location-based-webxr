/**
 * Why these tests matter: "Make it plain text" is the one editor action
 * besides typing that changes a creator's text, so each kind's fix is
 * pinned to its exact result, and most are checked to leave a part the
 * reader formats (the underline goes away). The parts themselves come
 * from the framework reader, so these cases also catch the two drifting
 * apart.
 */
import { describe, expect, it } from "vitest";

import {
  pictureAlt,
  plainTextEdit,
  TYPED_PART_TEXT,
  tourPictureEdit,
  typedParts,
  type PartEdit,
} from "./typed-parts.js";

const assetExists = (id: string): boolean => id.startsWith("pic");

function apply(body: string, edit: PartEdit): string {
  return body.slice(0, edit.from) + edit.text + body.slice(edit.to);
}

/** `body` after "Make it plain text" on its first part. */
function fixed(body: string): string {
  const [part] = typedParts(body, { assetExists });
  if (part === undefined) throw new Error(`no part in ${body}`);
  return apply(body, plainTextEdit(body, part));
}

describe("typedParts", () => {
  it("gives each part its text, its line and a key that survives edits around it", () => {
    const body = "Intro\n\nUse `code` here";
    const [part] = typedParts(body);
    expect(part).toMatchObject({ kind: "icode", text: "`code`", line: 3 });
    const moved = typedParts(`More words. ${body}`)[0];
    expect(moved?.key).toBe(part?.key);
  });

  it("marks the parts the creator kept", () => {
    const body = "A `x` and `y`";
    const parts = typedParts(body, { kept: new Set(["icode:`y`"]) });
    expect(parts.map((p) => p.kept)).toEqual([false, true]);
  });

  it("returns no parts for a value that is not a string", () => {
    expect(typedParts(7 as unknown as string)).toEqual([]);
  });

  it("has words for every kind", () => {
    for (const text of Object.values(TYPED_PART_TEXT)) {
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.why.length).toBeGreaterThan(0);
      expect(text.fixNote.length).toBeGreaterThan(0);
    }
  });
});

describe("plainTextEdit", () => {
  it.each([
    ["#### Deep", "Deep"],
    ["+ plus item", "- plus item"],
    ["1) paren item", "1. paren item"],
    ["Before\n```js\ncode line\n```\nAfter", "Before\njs\ncode line\nAfter"],
    ["Use `code` here", "Use code here"],
    ["| a | b |\n|---|:-:|\n| 1 | 2 |", "a, b:\n- 1: 2"],
    ["Name\tAge\nAnna\t31", "Name, Age:\n- Anna: 31"],
    ["A <b>bold</b> word", "A **bold** word"],
    ["Fish &amp; chips", "Fish & chips"],
    ["A &#169; sign", "A \u00a9 sign"],
    ["See <https://example.com>", "See https://example.com"],
    ["Was ~~old~~ new", "Was old new"],
    ["A claim[^1] here", "A claim (note 1) here"],
    ["Text\n[^1]: The note.", "Text\nNote 1: The note."],
    ["Text\n[home]: https://example.com", "Text\nhome: https://example.com"],
    ["![A view](https://example.com/a.jpg)", "A view"],
    ["![Gone](asset:gone-1)", "Gone"],
    [
      "Text ![In line](asset:pic-1) more",
      "Text\n\n![In line](asset:pic-1)\n\nmore",
    ],
    ["[x](javascript:alert(1))", "x"],
  ])("makes %j plain text", (body, expected) => {
    expect(fixed(body)).toBe(expected);
  });

  it("removes a divider with its line break", () => {
    expect(fixed("One\n---\nTwo")).toBe("One\nTwo");
    expect(fixed("Title\n=====")).toBe("Title\n");
  });

  it("leaves a part the reader formats, for the kinds it can", () => {
    for (const body of [
      "#### Deep",
      "+ plus item",
      "Before\n```\ncode\n```\nAfter",
      "Use `code` here",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "A <b>bold</b> word",
      "Was ~~old~~ new",
      "A claim[^1] here",
      "One\n---\nTwo",
      "![A view](https://example.com/a.jpg)",
      "Text ![In line](asset:pic-1) more",
      "[x](javascript:alert(1))",
    ]) {
      expect(typedParts(fixed(body), { assetExists }), body).toEqual([]);
    }
  });
});

describe("pictures", () => {
  it("reads a picture's description", () => {
    expect(pictureAlt({ text: "![ A view ](asset:x)" })).toBe("A view");
    expect(pictureAlt({ text: "not a picture" })).toBe("");
  });

  it("puts a tour picture in place of a web picture, on its own line", () => {
    const body = "See ![Old](https://e.com/a.png) here";
    const [part] = typedParts(body, { assetExists });
    if (part === undefined) throw new Error("no part");
    const out = apply(body, tourPictureEdit(body, part, "pic-2"));
    expect(out).toBe("See\n\n![Old](asset:pic-2)\n\nhere");
    expect(typedParts(out, { assetExists })).toEqual([]);
  });

  it("keeps brackets out of a given description", () => {
    const edit = tourPictureEdit(
      "![](x)",
      { from: 0, to: 6 },
      "pic-1",
      "a [b]",
    );
    expect(edit.text).toBe("![a  b](asset:pic-1)");
  });
});
