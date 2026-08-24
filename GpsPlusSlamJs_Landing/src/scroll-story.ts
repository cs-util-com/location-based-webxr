/**
 * Scroll → story-state mapping (the page's chapter state machine).
 *
 * The reference point is the *viewport-center line* in document
 * coordinates (`scrollY + viewportHeight / 2`): a chapter is active while
 * that line is inside its `<section>`, which matches what a reader
 * perceives as "the chapter I am looking at". Gaps between sections (from
 * margins) belong to the previous section with progress clamped at 1, so
 * the story never flickers back and forth at boundaries.
 *
 * `storyProgress` is PIECEWISE per section (round-13 follow-up): the
 * center line at fraction f of section i maps to `(i + f) / N`. Because
 * every chapter owns exactly 1/N of the timeline no matter how tall its
 * section rendered, the copy↔3D-beat pairing is viewport-independent —
 * the previous linear mapping ran the 3D beats up to a chapter ahead of
 * the copy on a landscape phone (the CTA section is far taller than the
 * rest). The trade-off is accepted: taller sections scrub their chapter
 * window slower.
 *
 * All outputs are clamped: chapterIndex ∈ [0, sections.length-1],
 * chapterProgress and storyProgress ∈ [0, 1], and the mapping is
 * monotone AND continuous in scrollY (pinned by property tests) — the 3D
 * timeline scrub relies on all of it.
 */

import { clamp01 } from "./clamp01";

export interface SectionMetrics {
  /** Document-space top offset of the section in px. */
  readonly top: number;
  /** Section height in px (> 0). */
  readonly height: number;
}

export interface ChapterScrollState {
  /** Index of the active chapter section. */
  readonly chapterIndex: number;
  /** Progress of the viewport-center line through that section, 0..1. */
  readonly chapterProgress: number;
  /** Piecewise story progress `(chapterIndex + chapterProgress) / N`,
   * 0..1 — what the 3D timeline scrub consumes. */
  readonly storyProgress: number;
}

const INERT_STATE: ChapterScrollState = {
  chapterIndex: 0,
  chapterProgress: 0,
  storyProgress: 0,
};

/**
 * Last section whose top is at or above the center line; the line being
 * above every section clamps to the first chapter.
 */
function findActiveChapterIndex(
  centerLine: number,
  sections: readonly SectionMetrics[],
): number {
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (section !== undefined && centerLine >= section.top) {
      return i;
    }
  }
  return 0;
}

/**
 * Map a scroll position to the active chapter and story progress.
 *
 * `sections` must be sorted by `top` (the DOM order of the chapter
 * sections). Non-finite scroll/viewport inputs are treated as 0 and an
 * empty section list yields an inert zero state — the landing page must
 * degrade, never crash, on unexpected layout states.
 */
export function computeScrollState(
  scrollY: number,
  viewportHeight: number,
  sections: readonly SectionMetrics[],
): ChapterScrollState {
  if (sections.length === 0) {
    return INERT_STATE;
  }
  const safeScrollY = Number.isFinite(scrollY) ? scrollY : 0;
  const safeViewport = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  const centerLine = safeScrollY + safeViewport / 2;

  const first = sections[0];
  if (first === undefined) {
    return INERT_STATE;
  }

  const chapterIndex = findActiveChapterIndex(centerLine, sections);
  const active = sections[chapterIndex] ?? first;
  const chapterProgress =
    active.height > 0 ? clamp01((centerLine - active.top) / active.height) : 0;

  const storyProgress = clamp01(
    (chapterIndex + chapterProgress) / sections.length,
  );

  return { chapterIndex, chapterProgress, storyProgress };
}
