/**
 * Why these tests matter: a part asks every frame whether the visitor
 * wants less motion. The answer must follow the setting while the page is
 * open, yet the media query is made once, not once a frame; and a page
 * without `matchMedia` still answers (no).
 */
import { describe, expect, it, vi } from "vitest";

import { reducedMotionReader } from "./reduced-motion.js";

describe("reducedMotionReader", () => {
  it("makes the query once and follows its answer", () => {
    const query = { matches: false };
    const matchMedia = vi.fn(() => query);
    const reduced = reducedMotionReader({ matchMedia });
    expect(matchMedia).not.toHaveBeenCalled();
    expect(reduced()).toBe(false);
    query.matches = true;
    expect(reduced()).toBe(true);
    expect(reduced()).toBe(true);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("answers no without a window or its matchMedia", () => {
    expect(reducedMotionReader(null)()).toBe(false);
    expect(reducedMotionReader({})()).toBe(false);
  });
});
