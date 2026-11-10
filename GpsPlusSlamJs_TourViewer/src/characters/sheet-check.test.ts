import { describe, expect, it } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import { alignFrames } from "./sheet-align.js";
import { checkFrames, diffShare, steadyBody } from "./sheet-check.js";
import { cutBackground, findFigures } from "./sheet-cut.js";
import {
  syntheticSheet,
  type SheetSpec,
} from "./test-support/synthetic-sheet.js";

const S = CUT_SETTINGS;

function framesOf(spec: Partial<SheetSpec>) {
  const sheet = syntheticSheet({ width: 800, height: 520, ...spec });
  const cut = cutBackground(sheet.image, S);
  const { runs } = findFigures(cut.alpha, 800, 520, S);
  return alignFrames(cut, 800, 520, runs, S).frames;
}

// Why these tests matter: an author must never save a character whose body
// jumps while it talks without having seen it; the check is what puts the
// choice in front of them, and the steady body is the remedy it offers.
describe("checkFrames", () => {
  it("sees a still body and a moving mouth", () => {
    const c = checkFrames(framesOf({}), S);
    expect(c.jitter).toBe(false);
    expect(c.bodyDiff).toBeLessThan(0.02);
    expect(c.headDiff).toBeGreaterThan(S.mouthMin);
    expect(c.warnings).not.toContain("mouth");
    expect(c.warnings).not.toContain("beckon-same");
    expect(c.warnings).not.toContain("beckon-left");
    expect(c.figH).toBeGreaterThan(0.6 * S.cellH);
  });

  it("flags a body that jumps while talking", () => {
    const c = checkFrames(framesOf({ talkJitter: 14 }), S);
    expect(c.jitter).toBe(true);
    expect(c.bodyDiff).toBeGreaterThan(S.jitterWarn);
  });
});

describe("steadyBody", () => {
  it("keeps the idle body in the talking frames", () => {
    const frames = framesOf({ talkJitter: 14 });
    const c = checkFrames(frames, S);
    const steady = steadyBody(frames, c, S);
    expect(steady[0]).toBe(frames[0]);
    expect(steady[3]).toBe(frames[3]);
    expect(checkFrames(steady, S).bodyDiff).toBeLessThan(0.01);
  });
});

describe("diffShare", () => {
  it("is 0 for a frame against itself and counts only figure pixels", () => {
    const f = framesOf({})[0]!;
    expect(diffShare(f, f, 0, 0, 0, f.height - 1, 48)).toBe(0);
  });
});
