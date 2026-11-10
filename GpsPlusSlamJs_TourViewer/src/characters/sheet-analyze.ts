/**
 * The character-sheet cut as one pipeline on a decoded picture: background,
 * poses, alignment, checks, and the steady-body variant of the talking
 * frames. Synchronous and DOM-free; the Worker (`character-cut.worker.ts`)
 * runs it off the page and reports each phase as it starts and ends.
 *
 * @see sheet-analyze.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import type { RgbaImage } from "./rgba-image.js";
import { alignFrames } from "./sheet-align.js";
import { checkFrames, steadyBody, type FrameCheck } from "./sheet-check.js";
import {
  countError,
  CutError,
  cutBackground,
  findFigures,
  type CutPhase,
} from "./sheet-cut.js";

/** The phases in order, with the words the page shows while each runs. */
export const CUT_PHASES: readonly { id: CutPhase; label: string }[] = [
  { id: "read", label: "Reading the picture" },
  { id: "background", label: "Removing the background" },
  { id: "poses", label: "Finding the four poses" },
  { id: "align", label: "Lining them up on one ground line" },
  { id: "check", label: "Checking the talking poses" },
];

export type PhaseState = "running" | "done" | "failed";

export type PhaseListener = (
  phase: CutPhase,
  state: PhaseState,
  note?: string,
) => void;

export interface SheetAnalysis {
  /** Idle, talk-a, talk-b, beckon, as drawn. */
  readonly frames: readonly RgbaImage[];
  /** The same four with the steady body in the talking frames. */
  readonly steadyFrames: readonly RgbaImage[];
  readonly check: FrameCheck;
  readonly mode: "alpha" | "white";
  readonly gaps: readonly number[];
  readonly size: { readonly w: number; readonly h: number };
}

/** Refuses a picture too big for the device or too small for four poses. */
export function checkPictureSize(w: number, h: number, s: CutSettings): void {
  if (w * h > s.maxPixels) {
    throw new CutError(
      "read",
      "too-big",
      "This picture is too big to cut on this device.",
      { w, h },
    );
  }
  if (w < 240 || h < 120) {
    throw new CutError(
      "read",
      "too-small",
      "This picture is too small to hold four poses.",
      { w, h },
    );
  }
}

function phase<T>(
  id: CutPhase,
  listener: PhaseListener,
  run: () => T,
  note: (result: T) => string,
): T {
  listener(id, "running");
  try {
    const result = run();
    listener(id, "done", note(result));
    return result;
  } catch (err) {
    listener(id, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Cuts `img` into the four aligned frames and checks them. Throws
 *  `CutError` (with the phase that refused) for any picture it cannot
 *  cut. The "read" phase is the decoder's, so it is not reported here. */
export function analyzeSheet(
  img: RgbaImage,
  s: CutSettings,
  listener: PhaseListener = () => {},
): SheetAnalysis {
  const { width: w, height: h } = img;
  checkPictureSize(w, h, s);
  const cut = phase(
    "background",
    listener,
    () => cutBackground(img, s),
    (c) =>
      c.mode === "alpha"
        ? "it was already transparent"
        : "flat background cut away",
  );
  const found = phase(
    "poses",
    listener,
    () => {
      const f = findFigures(cut.alpha, w, h, s);
      if (f.runs.length !== 4) {
        throw countError(f, w, h);
      }
      return f;
    },
    (f) => `gaps of ${f.gaps.join(", ")} px`,
  );
  const aligned = phase(
    "align",
    listener,
    () => alignFrames(cut, w, h, found.runs, s),
    () => `4 frames of ${s.cellW} x ${s.cellH}`,
  );
  const check = phase(
    "check",
    listener,
    () => checkFrames(aligned.frames, s),
    (c) => (c.jitter ? "the body moves while talking" : "the body stays still"),
  );
  return {
    frames: aligned.frames,
    steadyFrames: steadyBody(aligned.frames, check, s),
    check,
    mode: cut.mode,
    gaps: found.gaps,
    size: { w, h },
  };
}
