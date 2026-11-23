/**
 * A stored PNG decoded back into a Frame, pixel for pixel: no colour space
 * conversion and no premultiplied alpha, so the PNG of a frame gives back
 * the frame it was made from. Uses `OffscreenCanvas`, so it runs on the
 * page and in the measuring worker alike.
 *
 * @see png-frame.ts.md
 */
import { makeFrame, type Frame } from "./bench-image";

export async function pngFrame(blob: Blob): Promise<Frame> {
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("no 2D canvas");
    }
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return makeFrame(bmp.width, bmp.height, img.data);
  } finally {
    bmp.close();
  }
}
