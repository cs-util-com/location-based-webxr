import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createFigureMemo } from "./figure-memo.js";
import type { PaintedFigure } from "./character-canvas.js";

describe("createFigureMemo (properties)", () => {
  // Why: the bound is what keeps a phone's memory safe: through any order
  // of figures the poses kept never exceed it, and the one just kept is
  // there whenever it fits.
  it("never keeps more poses than its bound", () => {
    const step = fc.record({
      file: fc.integer({ min: 0, max: 7 }),
      size: fc.constantFrom(1, 4),
      read: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(step, { maxLength: 60 }),
        (limit, steps) => {
          const memo = createFigureMemo(limit);
          const files = Array.from({ length: 8 }, () => new Blob(["x"]));
          for (const { file, size, read } of steps) {
            const image = files[file]!;
            if (read) {
              memo.get(image, size === 4);
              continue;
            }
            memo.set(
              image,
              size === 4,
              Array.from({ length: size }, () => ({}) as PaintedFigure),
            );
            const stored = memo.get(image, size === 4);
            expect(size > limit || stored !== null).toBe(true);
            const kept = files.flatMap((f) => [
              memo.get(f, false)?.length ?? 0,
              memo.get(f, true)?.length ?? 0,
            ]);
            expect(kept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});
