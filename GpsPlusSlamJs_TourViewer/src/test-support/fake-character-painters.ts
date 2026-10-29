/**
 * Character-look painters with no canvas (node has none): sizes only, and
 * a record of the bubble footers painted so a test can see what a bubble
 * said, which word it read along, and the frames sheets sliced. For
 * `character-look.test.ts` and `scene-stage.test.ts`.
 */

import type {
  BubbleSide,
  Painted,
  PaintedFigure,
  PaintedTail,
} from "../character-canvas";
import type { CharacterPainters } from "../character-look";

export function fakeCharacterPainters(): {
  painters: CharacterPainters;
  painted: {
    bubbles: (string | null)[];
    /** The word each bubble read along (`undefined`: plain). */
    actives: (number | undefined)[];
    /** The frames each sliced sheet gave. */
    sheets: PaintedFigure[][];
  };
} {
  const painted = {
    bubbles: [] as (string | null)[],
    actives: [] as (number | undefined)[],
    sheets: [] as PaintedFigure[][],
  };
  const img = (w: number, h: number) =>
    ({ width: w, height: h }) as unknown as HTMLCanvasElement;
  const flat = (w: number, h: number): Painted => ({ image: img(w, h), w, h });
  const tail = (w: number, h: number, side: BubbleSide): PaintedTail => ({
    ...flat(w, h),
    tipX: side === "right" ? 30 : w - 30,
  });
  const figure = (): PaintedFigure => ({
    front: img(106, 206),
    back: img(106, 206),
    figureW: 100,
    figureH: 200,
    pad: 3,
  });
  const painters: CharacterPainters = {
    figure,
    frames: () => {
      const cells = [figure(), figure(), figure(), figure()];
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
