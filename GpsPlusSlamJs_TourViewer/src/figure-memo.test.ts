/**
 * Why this test matters: a die-cut figure takes hundreds of milliseconds to
 * paint, so a figure coming back must not paint again; the canvases it keeps
 * are also megabytes each, so what is remembered must stay bounded however
 * many figures a tour has.
 */
import { describe, expect, it } from "vitest";

import { createFigureMemo } from "./figure-memo.js";
import type { PaintedFigure } from "./character-canvas.js";

const poses = (n: number): readonly PaintedFigure[] =>
  Array.from({ length: n }, () => ({}) as PaintedFigure);

describe("createFigureMemo", () => {
  it("gives back what was painted for the same file", () => {
    const memo = createFigureMemo(4);
    const image = new Blob(["a"]);
    const painted = poses(1);
    expect(memo.get(image, false)).toBeNull();
    memo.set(image, false, painted);
    expect(memo.get(image, false)).toBe(painted);
    expect(memo.get(new Blob(["a"]), false)).toBeNull();
  });

  // Why: one file read as one pose and as a sheet of four are different
  // paintings.
  it("keeps a file's sheet apart from its one pose", () => {
    const memo = createFigureMemo(4);
    const image = new Blob(["a"]);
    memo.set(image, true, poses(4));
    expect(memo.get(image, false)).toBeNull();
  });

  // Why: the bound is in poses, since that is what costs memory.
  it("lets the least recently used go, counting poses", () => {
    const memo = createFigureMemo(3);
    const [a, b, c] = [new Blob(["a"]), new Blob(["b"]), new Blob(["c"])];
    memo.set(a, false, poses(1));
    memo.set(b, false, poses(1));
    memo.get(a, false);
    memo.set(c, false, poses(2));
    expect(memo.get(a, false)).not.toBeNull();
    expect(memo.get(b, false)).toBeNull();
    expect(memo.get(c, false)).not.toBeNull();
  });

  // Why: a sheet larger than the bound is not worth forgetting everything
  // else for.
  it("keeps nothing larger than the bound", () => {
    const memo = createFigureMemo(3);
    const a = new Blob(["a"]);
    const big = new Blob(["big"]);
    memo.set(a, false, poses(1));
    memo.set(big, true, poses(4));
    expect(memo.get(big, true)).toBeNull();
    expect(memo.get(a, false)).not.toBeNull();
  });

  it("forgets everything with the tour", () => {
    const memo = createFigureMemo(3);
    const a = new Blob(["a"]);
    memo.set(a, false, poses(1));
    memo.clear();
    expect(memo.get(a, false)).toBeNull();
  });
});
