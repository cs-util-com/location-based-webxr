/**
 * Why this test matters: the words plate is painted at 2.5 to 3 device
 * px a CSS px, so it stays sharp when the sign grows 1.6 times and on a
 * 3x phone, without the texture outgrowing a weak GPU on a 4x screen. A
 * scale under 2.5 blurs the grown plate; one over 3 wastes texture
 * memory on every repaint.
 */
import { describe, expect, it } from "vitest";

import { wordsPaintScale } from "./travelling-box-check";

describe("wordsPaintScale", () => {
  it("keeps the scale between 2.5 and 3, and survives a broken ratio", () => {
    expect(wordsPaintScale(1)).toBe(2.5);
    expect(wordsPaintScale(2.75)).toBe(2.75);
    expect(wordsPaintScale(4)).toBe(3);
    expect(wordsPaintScale(Number.NaN)).toBe(2.5);
  });
});
