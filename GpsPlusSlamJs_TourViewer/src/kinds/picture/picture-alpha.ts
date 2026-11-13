/**
 * Whether a picture has see-through parts: what a cut-out needs to stand
 * as its shape rather than as its rectangle. The editor asks it when a
 * creator picks the cut-out view, and warns when the answer is no. The
 * reader never asks: a picture without alpha is still a valid cut-out.
 *
 * @see picture-alpha.ts.md
 */

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { imageInfoOfBlob } from "gps-plus-slam-app-framework/utils/image-header";

/** An alpha below this (of 255) is see-through. A few points under full
 *  so the soft edge an encoder leaves on an opaque picture is not one. */
export const SEE_THROUGH_BELOW = 250;

/** The share of pixels that must be see-through: a cut-out's background
 *  is a real part of it, never a handful of stray pixels. */
export const SEE_THROUGH_SHARE = 0.01;

/** The side the picture is read at: a share does not need every pixel. */
const SAMPLE_SIDE_PX = 128;

/**
 * Whether `rgba` (RGBA bytes, 4 a pixel) has see-through parts: at least
 * `SEE_THROUGH_SHARE` of its pixels with an alpha below
 * `SEE_THROUGH_BELOW`. No pixels: no.
 */
export function hasSeeThrough(rgba: ArrayLike<number>): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return false;
  let clear = 0;
  for (let i = 3; i < pixels * 4; i += 4) {
    if ((rgba[i] ?? 255) < SEE_THROUGH_BELOW) clear++;
  }
  return clear >= pixels * SEE_THROUGH_SHARE;
}

/**
 * Whether the picture file `blob` has see-through parts; null when it
 * cannot tell (not an image it reads, over the tour's pixel cap, a page
 * without `createImageBitmap` or a 2D canvas). A JPEG has no alpha: no,
 * without a decode. The device seam: not unit-tested (Node has no
 * `createImageBitmap`); `hasSeeThrough` is.
 */
export async function pictureSeeThrough(blob: Blob): Promise<boolean | null> {
  const header = await imageInfoOfBlob(blob);
  if (header === null) return null;
  if (header.type === "jpeg") return false;
  if (header.width * header.height > TOUR_MAX_IMAGE_PIXELS) return null;
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas !== "function"
  ) {
    return null;
  }
  const scale = Math.min(
    1,
    SAMPLE_SIDE_PX / Math.max(header.width, header.height),
  );
  const w = Math.max(1, Math.round(header.width * scale));
  const h = Math.max(1, Math.round(header.height * scale));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      resizeWidth: w,
      resizeHeight: h,
      premultiplyAlpha: "none",
    });
  } catch {
    return null;
  }
  try {
    const g = new OffscreenCanvas(w, h).getContext("2d");
    if (g === null) return null;
    g.drawImage(bitmap, 0, 0);
    return hasSeeThrough(g.getImageData(0, 0, w, h).data);
  } finally {
    bitmap.close();
  }
}
