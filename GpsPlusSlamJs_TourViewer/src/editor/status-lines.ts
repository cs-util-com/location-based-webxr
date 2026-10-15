/**
 * Lines in a live region, put back only when their words change (QR-first
 * M1b-2 milestone review #5): the page redraws on every `refresh()`, and
 * identical lines put in as new nodes are announced again by a screen
 * reader. The region itself is never hidden - an empty one is zero-height -
 * so the first lines are announced too (a region shown and filled in one
 * task commonly is not).
 *
 * @see status-lines.ts.md
 */

/** The part of an element this module uses (structural, for tests). */
export interface LinesBox<N> {
  replaceChildren(...nodes: N[]): void;
}

export interface StatusLines {
  /** Show `lines`; whether the region's nodes were replaced. */
  show(lines: readonly string[]): boolean;
}

export function createStatusLines<N>(
  box: LinesBox<N>,
  make: (text: string) => N,
): StatusLines {
  /** What the region shows now; it starts empty. */
  let shown: readonly string[] = [];
  return {
    show(lines) {
      const same =
        lines.length === shown.length &&
        lines.every((line, i) => line === shown[i]);
      if (same) return false;
      shown = [...lines];
      box.replaceChildren(...lines.map(make));
      return true;
    },
  };
}
