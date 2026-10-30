import { describe, expect, it } from "vitest";

import { pictureFit, pictureProblem } from "./image-cap";

/**
 * Why these tests matter (tour kit K4 review R2): a tour's picture goes
 * into an <img>, which the browser decodes at whatever size the file
 * states; a few kilobytes of crafted header could make a phone allocate
 * gigabytes. The story panel and the gallery ask this first.
 */

/** A PNG signature plus IHDR stating `width` x `height` (no pixels). */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe("pictureProblem", () => {
  it("passes a picture within the tour pixel cap", async () => {
    expect(await pictureProblem(new Blob([pngHeader(4032, 3024)]))).toBeNull();
  });

  it("names a picture over the cap, and one whose size cannot be read", async () => {
    expect(await pictureProblem(new Blob([pngHeader(8064, 6048)]))).toBe(
      "it is 8064 x 6048 pixels, more than a phone can safely decode",
    );
    expect(await pictureProblem(new Blob(["<svg/>"]))).toBe(
      "its size could not be read from its file",
    );
  });
});

/**
 * Why this test matters: the long text's pictures are held to a decode
 * budget in megapixels, so the sheet needs each picture's size as well as
 * the verdict; one reading of the header must give both, or the budget and
 * the cap could disagree about the same file.
 */
describe("pictureFit", () => {
  it("gives a picture's pixel count within the cap", async () => {
    expect(await pictureFit(new Blob([pngHeader(4032, 3024)]))).toEqual({
      ok: true,
      pixels: 4032 * 3024,
    });
  });

  it("gives the same reason as pictureProblem over the cap or unreadable", async () => {
    expect(await pictureFit(new Blob([pngHeader(8064, 6048)]))).toEqual({
      ok: false,
      why: "it is 8064 x 6048 pixels, more than a phone can safely decode",
      tooLarge: true,
    });
    expect(await pictureFit(new Blob(["<svg/>"]))).toEqual({
      ok: false,
      why: "its size could not be read from its file",
      tooLarge: false,
    });
  });
});
