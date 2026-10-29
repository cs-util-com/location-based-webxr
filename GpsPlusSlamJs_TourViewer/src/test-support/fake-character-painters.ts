/**
 * Character-look painters with no canvas (node has none): sizes only, and
 * a record of the bubble footers painted so a test can see what a bubble
 * said. For `character-look.test.ts` and `scene-stage.test.ts`.
 */

import type { BubbleSide, Painted, PaintedTail } from "../character-canvas";
import type { CharacterPainters } from "../character-look";

export function fakeCharacterPainters(): {
  painters: CharacterPainters;
  painted: { bubbles: (string | null)[] };
} {
  const painted: { bubbles: (string | null)[] } = { bubbles: [] };
  const img = (w: number, h: number) =>
    ({ width: w, height: h }) as unknown as HTMLCanvasElement;
  const flat = (w: number, h: number): Painted => ({ image: img(w, h), w, h });
  const tail = (w: number, h: number, side: BubbleSide): PaintedTail => ({
    ...flat(w, h),
    tipX: side === "right" ? 30 : w - 30,
  });
  const painters: CharacterPainters = {
    figure: () => ({
      front: img(106, 206),
      back: img(106, 206),
      figureW: 100,
      figureH: 200,
      pad: 3,
    }),
    bubble: (c) => {
      painted.bubbles.push(c.footer);
      return tail(600, 300, c.side);
    },
    pip: (_name, side) => tail(560, 150, side),
    scroll: () => flat(1024, 300),
    stageTop: () => flat(1024, 560),
    backdrop: () => flat(1024, 1080),
    blob: () => flat(256, 128),
    chevrons: () => flat(128, 512),
    fade: () => flat(8, 256),
  };
  return { painters, painted };
}
