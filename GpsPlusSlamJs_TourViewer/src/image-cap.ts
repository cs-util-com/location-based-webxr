/**
 * The tour pixel cap for a picture the browser decodes itself, in an <img>
 * (tour kit K4 review R2): its size is read from its header first
 * (`utils/image-header`), and a picture over `TOUR_MAX_IMAGE_PIXELS`, or
 * one whose size cannot be read, is not shown - the browser would decode
 * it at whatever size the file states. A figure and a model's textures
 * take the same cap on their own paths (`station-prefetch.ts`
 * `decodeFigure`, the framework's `checkGlbInert`).
 */

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { imageInfoOfBlob } from "gps-plus-slam-app-framework/utils/image-header";

/** Why this picture may not be shown, in plain words, or null. */
export async function pictureProblem(blob: Blob): Promise<string | null> {
  const info = await imageInfoOfBlob(blob);
  if (info === null) return "its size could not be read from its file";
  return info.width * info.height > TOUR_MAX_IMAGE_PIXELS
    ? `it is ${String(info.width)} x ${String(info.height)} pixels, more than a phone can safely decode`
    : null;
}
