/**
 * Why these tests matter: the chapter dots (v3 F6) are the story's only
 * always-visible progress affordance AND the first real consumer of the
 * chapters.ts labels (as aria-labels). If the mapping drifts, screen
 * readers announce the wrong chapter and clicks jump to the wrong
 * section — silently, because the rail is decorative to sighted users
 * who never click it.
 */
import { describe, expect, it, vi } from "vitest";
import { CHAPTERS } from "./chapters";
import {
  chapterDotsHtml,
  dotIndexFromClick,
  updateActiveDot,
} from "./chapter-dots";

describe("chapterDotsHtml", () => {
  it("renders one button per chapter with the label as aria-label", () => {
    const html = chapterDotsHtml(CHAPTERS);
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length).toBe(CHAPTERS.length);
    for (const chapter of CHAPTERS) {
      expect(html).toContain(`aria-label="${chapter.label}"`);
    }
  });

  it("indexes the buttons in chapter order for click delegation", () => {
    const html = chapterDotsHtml(CHAPTERS);
    CHAPTERS.forEach((_, index) => {
      expect(html).toContain(`data-index="${index}"`);
    });
  });

  it("escapes HTML in labels (labels are data, not markup)", () => {
    const html = chapterDotsHtml([{ id: "x", label: '<b>&"quoted"' }]);
    expect(html).toContain("&lt;b&gt;&amp;&quot;quoted&quot;");
  });

  it("escapes the apostrophe too, matching the canonical escaper", () => {
    // WHY THIS MATTERS: this escaper is a deliberate copy of the framework's
    // `utils/escape-html.ts`, and until 2026-08-24 it silently escaped only
    // four of the five characters — `'` was missing. That was safe by accident
    // of the single call site (a double-quoted attribute), not by design, and a
    // second call site would have inherited a hole. The copies are held
    // identical by `tests/repo-config/escape-html-copies.test.js`; this test is
    // the behavioural half of the same claim.
    const html = chapterDotsHtml([{ id: "x", label: "it's fine" }]);
    expect(html).toContain("it&#39;s fine");
  });
});

describe("updateActiveDot", () => {
  function fakeContainer(count: number) {
    const toggles: Array<ReturnType<typeof vi.fn>> = [];
    const children = Array.from({ length: count }, () => {
      const toggle = vi.fn();
      toggles.push(toggle);
      return { classList: { toggle } };
    });
    return { container: { children }, toggles };
  }

  it("marks exactly the active dot", () => {
    const { container, toggles } = fakeContainer(7);
    updateActiveDot(container, 3);
    toggles.forEach((toggle, index) => {
      expect(toggle).toHaveBeenCalledWith("active", index === 3);
    });
  });

  it("clears all dots for out-of-range indices (pre-boot -1)", () => {
    const { container, toggles } = fakeContainer(7);
    updateActiveDot(container, -1);
    for (const toggle of toggles) {
      expect(toggle).toHaveBeenCalledWith("active", false);
    }
  });
});

describe("dotIndexFromClick", () => {
  it("resolves a dot button to its chapter index", () => {
    expect(dotIndexFromClick({ dataset: { index: "4" } })).toBe(4);
  });

  it("returns null for clicks that miss a dot or malformed data", () => {
    expect(dotIndexFromClick(null)).toBeNull();
    expect(dotIndexFromClick({})).toBeNull();
    expect(dotIndexFromClick({ dataset: {} })).toBeNull();
    expect(dotIndexFromClick({ dataset: { index: "banana" } })).toBeNull();
    expect(dotIndexFromClick({ dataset: { index: "-2" } })).toBeNull();
  });
});
