// @vitest-environment jsdom
/**
 * Why this test matters: the rich text e2e reads the check page's query
 * and leans on its body holding every form the sheet renders, with the
 * pictures far enough down that they are decoded only after a scroll. A
 * query that silently fell back to the plain text, or a body that lost
 * its list or a picture, would leave the e2e testing less than it says.
 */
import { describe, expect, it } from "vitest";

import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import { CHECK_RICH_BODY, longTextCheckOptions } from "./long-text-check.js";

describe("longTextCheckOptions", () => {
  it("reads the rich text and the AR switch from the query, off by default", () => {
    expect(longTextCheckOptions("")).toEqual({ rich: false, ar: false });
    expect(longTextCheckOptions("?text=rich&ar=1")).toEqual({
      rich: true,
      ar: true,
    });
    expect(longTextCheckOptions("?text=plain&ar=true")).toEqual({
      rich: false,
      ar: false,
    });
  });
});

describe("CHECK_RICH_BODY", () => {
  it("holds two headings, a nested list, a link and two pictures, the pictures last", () => {
    const { blocks } = parseTourMarkdown(CHECK_RICH_BODY);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(2);
    const list = blocks.find((b) => b.kind === "list");
    expect(
      list?.kind === "list" &&
        list.items.some((item) => item.some((b) => b.kind === "list")),
    ).toBe(true);
    expect(CHECK_RICH_BODY).toContain("](https://town.example/map)");
    const pictures = blocks.flatMap((b, i) =>
      b.kind === "picture" ? [{ i, asset: b.asset }] : [],
    );
    expect(pictures.map((p) => p.asset)).toEqual(["mill", "bell"]);
    // At least three long paragraphs before the first picture.
    expect(pictures[0]!.i).toBeGreaterThan(kinds.indexOf("list") + 3);
  });
});
