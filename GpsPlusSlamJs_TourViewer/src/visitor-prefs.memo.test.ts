import { describe, expect, it, vi } from "vitest";
import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import { bodyHasPictures } from "./visitor-prefs.js";

// The real parser, watched: each call is counted.
vi.mock("gps-plus-slam-app-framework/ar/tour-markdown", { spy: true });

describe("whether a body shows a picture, remembered", () => {
  // Why this test matters: the view switch asks on every camera frame and
  // every store dispatch in AR, and a long text's body may be tens of
  // thousands of characters; parsing it each time costs milliseconds a
  // frame on a phone. A body already judged is not parsed again, and two
  // long texts at one station do not push each other out.
  it("parses each body once, also with two bodies asked in turn", () => {
    const parsed = vi.mocked(parseTourMarkdown);
    const pictures = "Before.\n\n![The gate](asset:gate)";
    const plain = "Only words.";
    expect(parsed).not.toHaveBeenCalled();
    expect(bodyHasPictures(pictures)).toBe(true);
    expect(bodyHasPictures(plain)).toBe(false);
    expect(parsed).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i += 1) {
      expect(bodyHasPictures(pictures)).toBe(true);
      expect(bodyHasPictures(plain)).toBe(false);
    }
    expect(parsed).toHaveBeenCalledTimes(2);
  });

  // Why this test matters: the memo is bounded (a tour's bodies are
  // many, and an editor may produce endless edits of one); when it is
  // full it empties, so a body judged before is parsed again rather than
  // kept forever.
  it("parses a body again after seventeen others filled the memo", () => {
    const parsed = vi.mocked(parseTourMarkdown);
    const bodies = Array.from(
      { length: 17 },
      (_, i) => `Body number ${String(i)}.`,
    );
    for (const body of bodies) bodyHasPictures(body);
    const before = parsed.mock.calls.length;
    expect(bodyHasPictures(bodies[0] ?? "")).toBe(false);
    expect(parsed.mock.calls.length).toBe(before + 1);
  });
});
