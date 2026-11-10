/**
 * `decodePicture` refuses a picture whose header states more pixels than
 * the cut's cap before the browser decodes it: decoding first would
 * allocate the whole bitmap (4 bytes a pixel) on the strength of a number
 * in the file.
 *
 * Why these tests matter: a 50 MP photo decoded on a phone can take the
 * page down before any size check runs; only the header can refuse it in
 * time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import { decodePicture } from "./decode-picture.js";
import { crc32 } from "./png-text.js";
import { CutError } from "./sheet-cut.js";

/** A PNG with only its header (no pixels): what a size check reads. */
function headerOnlyPng(w: number, h: number): Blob {
  const ihdr = new Uint8Array(25);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 13);
  ihdr.set([73, 72, 68, 82], 4); // IHDR
  dv.setUint32(8, w);
  dv.setUint32(12, h);
  ihdr[16] = 8;
  ihdr[17] = 6;
  dv.setUint32(21, crc32(ihdr.subarray(4, 21)));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return new Blob([Uint8Array.from(sig), ihdr], { type: "image/png" });
}

const decoder = vi.fn(() => Promise.reject(new Error("no decoder here")));

afterEach(() => {
  vi.unstubAllGlobals();
  decoder.mockClear();
});

describe("decodePicture's size check before decoding", () => {
  // Swept over caps of 12 to 40 megapixels: whatever the cap, a header
  // one row over it is refused without a decode, and one at it is decoded.
  for (const mp of [12, 16, 20, 24, 32, 40]) {
    it(`with a cap of ${String(mp)} MP`, async () => {
      vi.stubGlobal("createImageBitmap", decoder);
      const s = { ...CUT_SETTINGS, maxPixels: mp * 1e6 };
      const w = 4000;
      const atCap = Math.floor(s.maxPixels / w);
      const over = decodePicture(headerOnlyPng(w, atCap + 1), s);
      await expect(over).rejects.toMatchObject({ code: "too-big" });
      expect(decoder).not.toHaveBeenCalled();
      await expect(decodePicture(headerOnlyPng(w, atCap), s)).rejects.toThrow(
        /could not be opened/,
      );
      expect(decoder).toHaveBeenCalledOnce();
    });
  }

  // Why: the cap the cut runs with must refuse a 24 MP camera photo
  // before decoding, and let the largest sheet a phone shows through.
  it("the cut's own cap", async () => {
    vi.stubGlobal("createImageBitmap", decoder);
    const big = decodePicture(headerOnlyPng(6000, 4000), CUT_SETTINGS);
    await expect(big).rejects.toBeInstanceOf(CutError);
    expect(decoder).not.toHaveBeenCalled();
    await expect(
      decodePicture(headerOnlyPng(4096, 4096), CUT_SETTINGS),
    ).rejects.toThrow(/could not be opened/);
  });
});
