import { describe, expect, it } from "vitest";

import { pictureProblem } from "./image-cap";

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
