/**
 * Why this test matters: the photo setting is the one value of the shelf
 * that was judged by eye. On the sample street photo, WebP at a longest
 * side of 1600 px and quality 0.6 (about 18 % of the original) kept small
 * text readable when zoomed in, and the next smaller step (about 16 %)
 * did not. A retune must be a deliberate change of this named value, not
 * a side effect, and the shelf's picture settings must be that value.
 */
import { describe, expect, it } from "vitest";

import { OPTIMIZER_SETTINGS, PHOTO_PICTURE } from "./optimizer-settings.js";

describe("the shelf's picture setting", () => {
  it("is the photo setting judged by eye: 1600 px, WebP at quality 0.6", () => {
    expect(PHOTO_PICTURE).toEqual({
      maxSidePx: 1600,
      type: "image/webp",
      quality: 0.6,
    });
    expect(OPTIMIZER_SETTINGS.picture).toBe(PHOTO_PICTURE);
  });
});
