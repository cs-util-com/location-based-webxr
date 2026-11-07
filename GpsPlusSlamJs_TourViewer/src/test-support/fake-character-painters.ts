/**
 * Character-look painters with no canvas (node has none): sizes only, and
 * a record of the bubble footers painted so a test can see what a bubble
 * said, which word it read along, and the frames sheets sliced. For
 * `character-look.test.ts` and `scene-stage.test.ts`.
 */

import type {
  BubbleSide,
  FigureSource,
  Painted,
  PaintedFigure,
  PaintedTail,
} from "../character-canvas";
import type { CharacterPainters } from "../character-look";

/** What the fake `upright` hands back, so a test can see who received it. */
export const UPRIGHT_MARK = { upright: true } as unknown as FigureSource;

export function fakeCharacterPainters(): {
  painters: CharacterPainters;
  painted: {
    bubbles: (string | null)[];
    /** The word each bubble read along (`undefined`: plain). */
    actives: (number | undefined)[];
    /** The frames each sliced sheet gave. */
    sheets: PaintedFigure[][];
    /** Figures turned upright. */
    flips: number;
    /** The sources `figure` and `frames` were painted from. */
    sources: FigureSource[];
  };
} {
  const painted = {
    bubbles: [] as (string | null)[],
    actives: [] as (number | undefined)[],
    sheets: [] as PaintedFigure[][],
    flips: 0,
    sources: [] as FigureSource[],
  };
  const img = (w: number, h: number) =>
    ({ width: w, height: h }) as unknown as HTMLCanvasElement;
  const flat = (w: number, h: number): Painted => ({ image: img(w, h), w, h });
  const tail = (w: number, h: number, side: BubbleSide): PaintedTail => ({
    ...flat(w, h),
    tipX: side === "right" ? 30 : w - 30,
  });
  const cell = (): PaintedFigure => ({
    front: img(106, 206),
    back: img(106, 206),
    figureW: 100,
    figureH: 200,
    pad: 3,
  });
  const painters: CharacterPainters = {
    upright: () => {
      painted.flips += 1;
      return UPRIGHT_MARK;
    },
    figure: (source) => {
      painted.sources.push(source);
      return cell();
    },
    frames: (sheet) => {
      painted.sources.push(sheet);
      const cells = [cell(), cell(), cell(), cell()];
      painted.sheets.push(cells);
      return cells;
    },
    bubble: (c) => {
      painted.bubbles.push(c.footer);
      painted.actives.push(c.active);
      return tail(600, 300, c.side);
    },
    pip: (_name, side) => tail(560, 150, side),
    scroll: () => flat(1024, 300),
    stageTop: () => flat(1024, 560),
    backdrop: () => flat(1024, 1080),
    blob: () => flat(256, 128),
  };
  return { painters, painted };
}
