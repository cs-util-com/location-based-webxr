import type { Chapter } from "./chapters";

/**
 * Chapter progress dots (v3 F6): a fixed rail of one clickable dot per
 * chapter — finally a real consumer for the `chapters.ts` labels, which
 * become the dots' aria-labels. Pure string/render helpers here; the
 * bootstrap owns the DOM container, click delegation and smooth scroll
 * (reusing the jump-to-demos scroll mechanism).
 */

/** Id of the static `<nav>` rail in index.html. */
export const CHAPTER_DOTS_CONTAINER_ID = "chapter-dots";

const ACTIVE_CLASS = "active";

/**
 * A DELIBERATE COPY of the framework's `utils/escape-html.ts`, which is the
 * canonical escaper for this workspace.
 *
 * Landing does not depend on `gps-plus-slam-app-framework` — its dependencies
 * are three, animejs, postprocessing and uqr — and adding that edge to a
 * marketing site so it can share ten lines of string replacement is the worse
 * trade. So the copy stays, and
 * `tests/repo-config/escape-html-copies.test.js` fails if the two ever escape
 * different characters.
 *
 * It used to escape FOUR characters, missing `'`. That was safe only by
 * accident of its single call site — an `aria-label="…"` attribute, where an
 * apostrophe cannot break out. Two implementations mean two chances to miss a
 * character class, which is the whole reason the guard exists.
 */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => REPLACEMENTS[char] ?? char);
}

/**
 * The rail's inner HTML: one button per chapter, `data-index` for click
 * delegation, the chapter label as aria-label (screen readers get real
 * names, not "dot 3").
 */
export function chapterDotsHtml(chapters: readonly Chapter[]): string {
  return chapters
    .map(
      (chapter, index) =>
        `<button type="button" data-index="${index}" ` +
        `aria-label="${escapeHtml(chapter.label)}"></button>`,
    )
    .join("");
}

/** The minimal element surface `updateActiveDot` needs (testable). */
export interface DotsContainerLike {
  readonly children: ArrayLike<{
    classList: { toggle(name: string, force: boolean): unknown };
  }>;
}

/**
 * Mark exactly the dot at `activeIndex` as active. Out-of-range indices
 * (e.g. -1 before the first measurement) simply clear all dots.
 */
export function updateActiveDot(
  container: DotsContainerLike,
  activeIndex: number,
): void {
  for (let i = 0; i < container.children.length; i += 1) {
    container.children[i]?.classList.toggle(ACTIVE_CLASS, i === activeIndex);
  }
}

/**
 * Resolve a click inside the rail to a chapter index, or null when the
 * click missed a dot. Defensive: a malformed data-index yields null.
 */
export function dotIndexFromClick(target: unknown): number | null {
  const dataset = (target as { dataset?: { index?: string } } | null)?.dataset;
  if (!dataset || typeof dataset.index !== "string") {
    return null;
  }
  const index = Number.parseInt(dataset.index, 10);
  return Number.isFinite(index) && index >= 0 ? index : null;
}
