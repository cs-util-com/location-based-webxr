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

/** A picture's verdict: its pixel count when it may be shown, else why
 *  not, in plain words (`tooLarge`: its header states more pixels than
 *  the cap, as opposed to a size that could not be read). */
export type PictureFit =
  | { readonly ok: true; readonly pixels: number }
  | { readonly ok: false; readonly why: string; readonly tooLarge: boolean };

/** Whether this picture may be shown, and its size in pixels when it may
 *  (the long text's decode budget counts them). */
export async function pictureFit(blob: Blob): Promise<PictureFit> {
  const info = await imageInfoOfBlob(blob);
  if (info === null) {
    return {
      ok: false,
      why: "its size could not be read from its file",
      tooLarge: false,
    };
  }
  const pixels = info.width * info.height;
  return pixels > TOUR_MAX_IMAGE_PIXELS
    ? {
        ok: false,
        why: `it is ${String(info.width)} x ${String(info.height)} pixels, more than a phone can safely decode`,
        tooLarge: true,
      }
    : { ok: true, pixels };
}

/** Why this picture may not be shown, in plain words, or null. */
export async function pictureProblem(blob: Blob): Promise<string | null> {
  const fit = await pictureFit(blob);
  return fit.ok ? null : fit.why;
}
