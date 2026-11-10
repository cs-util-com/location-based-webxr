/**
 * Decodes a picture file into RGBA pixels for the character-sheet cut,
 * with no DOM: `createImageBitmap` and an `OffscreenCanvas`, both available
 * in a Worker. Refuses, with words, a file that is no picture, one that
 * does not decode, and one too big or too small.
 *
 * @see decode-picture.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import type { RgbaImage } from "./rgba-image.js";
import { checkPictureSize } from "./sheet-analyze.js";
import { CutError } from "./sheet-cut.js";

/** Null when `file` looks like a picture (an `image/*` type, or a PNG,
 *  JPEG or WebP name when the type is missing), else the refusal. */
function notAPicture(file: Blob): CutError | null {
  const name = file instanceof File ? file.name : "";
  const type = file.type;
  if (type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(name)) {
    return null;
  }
  return new CutError("read", "not-image", "This file is not a picture.", {
    name,
    type,
  });
}

/** The device seam (not unit-tested: Node has no `createImageBitmap`).
 *  Colours are read as stored: no premultiplication, no colour-space
 *  conversion, so a transparent PNG's alpha and the cut's thresholds see
 *  the file's own values. */
export async function decodePicture(
  file: Blob,
  s: CutSettings,
): Promise<RgbaImage> {
  const refusal = notAPicture(file);
  if (refusal !== null) {
    throw refusal;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  } catch {
    throw new CutError(
      "read",
      "decode",
      "This picture could not be opened. PNG, JPEG and WebP work.",
    );
  }
  try {
    checkPictureSize(bitmap.width, bitmap.height, s);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) {
      throw new CutError(
        "read",
        "decode",
        "This device cannot read the picture's pixels.",
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
