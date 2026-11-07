/**
 * The die-cut figures painted so far, by the file they came from: painting
 * one takes hundreds of milliseconds on the main thread, so a figure coming
 * back, or a second figure of the same file, stands from the first painting.
 * Bounded in poses, since each keeps two canvases of megabytes.
 *
 * @see figure-memo.ts.md
 */

import type { PaintedFigure } from "./character-canvas.js";

/** What is kept at most: a station's figures and those of the way there
 *  (twelve single poses, or three frames sheets). */
const FIGURE_MEMO_POSES = 12;

export interface FigureMemo {
  /** What was painted of `image` read as a sheet or as one pose, or null.
   *  A hit counts as a use. */
  get(image: Blob, sheet: boolean): readonly PaintedFigure[] | null;
  /** Keeps a painting; what was used longest ago goes to make room, and one
   *  larger than the whole bound is not kept. */
  set(image: Blob, sheet: boolean, poses: readonly PaintedFigure[]): void;
  clear(): void;
}

interface Kept {
  readonly sheet: boolean;
  readonly poses: readonly PaintedFigure[];
}

export function createFigureMemo(limit = FIGURE_MEMO_POSES): FigureMemo {
  /** In order of use, the oldest first. One entry per file: a file is read
   *  one way, so the other way simply replaces it. */
  const kept = new Map<Blob, Kept>();

  function total(): number {
    let poses = 0;
    for (const entry of kept.values()) poses += entry.poses.length;
    return poses;
  }

  return {
    get(image, sheet) {
      const entry = kept.get(image);
      if (entry?.sheet !== sheet) return null;
      kept.delete(image);
      kept.set(image, entry);
      return entry.poses;
    },
    set(image, sheet, poses) {
      if (poses.length > limit) return;
      kept.delete(image);
      kept.set(image, { sheet, poses });
      while (total() > limit) {
        const oldest = kept.keys().next().value;
        if (oldest === undefined) return;
        kept.delete(oldest);
      }
    },
    clear() {
      kept.clear();
    },
  };
}
