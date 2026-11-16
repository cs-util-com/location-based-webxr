/**
 * The picture step of the asset optimizer's Worker: a photo or graphic
 * made smaller - its longest side at most the settings' limit (never
 * enlarged), written as WebP at the settings' quality. A GIF stays as it
 * is (a canvas keeps only an animation's first frame). The device part
 * (decode with the photo's own orientation, resize, encode) is injected,
 * so the decisions are unit-tested; `PICTURE_DEVICE` is the real one.
 *
 * @see picture-step.ts.md
 */

import type { OptimizerSettings } from "./optimizer-settings.js";
import {
  stoppedError,
  type WorkerStepAnswer,
  type WorkerStepControl,
} from "./optimizer-protocol.js";

/** Said when a GIF is kept. */
export const GIF_KEPT =
  "Kept as it is: an animated picture would lose its movement.";

/** A decoded picture, upright (its orientation applied). */
export interface DecodedPicture {
  readonly width: number;
  readonly height: number;
  /** Gives its memory back. */
  close(): void;
}

/** What a picture is written as: its MIME type, and the encoder's
 *  quality 0..1 (PNG ignores it). */
export interface PictureFormat {
  readonly type: "image/webp" | "image/jpeg" | "image/png";
  readonly quality: number;
}

/** How a picture is decoded: a `photo` as a viewer shows it; a
 *  `texture` (a 3D model's) as three.js reads one - no colour profile
 *  applied and its alpha not premultiplied, so the numbers a shader reads
 *  stay what the file holds. */
type PicturePurpose = "photo" | "texture";

/** The browser's part: decode, then resize and encode. */
export interface PictureDevice<P extends DecodedPicture = DecodedPicture> {
  decode(source: Blob, purpose?: PicturePurpose): Promise<P>;
  /** `picture` at `width` x `height`, written as `format`. */
  encode(
    picture: P,
    width: number,
    height: number,
    format: PictureFormat,
  ): Promise<Blob>;
}

const isWhole = (n: number) => Number.isSafeInteger(n) && n > 0;

/** `width` x `height` with its longest side at most `maxSide`, in the
 *  same proportions; never larger than it was, and no side under 1. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { readonly width: number; readonly height: number } {
  if (!isWhole(width) || !isWhole(height) || !isWhole(maxSide)) {
    throw new Error(
      `a picture size of ${width} x ${height} (at most ${maxSide})`,
    );
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function isGif(source: Blob): Promise<boolean> {
  const head = new Uint8Array(await source.slice(0, 4).arrayBuffer());
  return head.length === 4 && String.fromCharCode(...head) === "GIF8";
}

/** The step: `payload` is the picture's file as it came in. */
export async function optimizePicture<P extends DecodedPicture>(
  payload: unknown,
  settings: OptimizerSettings,
  control: WorkerStepControl,
  device: PictureDevice<P>,
): Promise<WorkerStepAnswer> {
  if (!(payload instanceof Blob)) throw new Error("no picture was handed over");
  if (await isGif(payload)) return { type: "kept", reason: GIF_KEPT };
  let picture: P;
  try {
    picture = await device.decode(payload);
  } catch {
    throw new Error("it could not be read as a picture");
  }
  try {
    if (control.signal.aborted) throw stoppedError();
    control.progress(0.3);
    const { picture: wanted } = settings;
    const size = fitWithin(picture.width, picture.height, wanted.maxSidePx);
    const blob = await device.encode(picture, size.width, size.height, {
      type: wanted.type,
      quality: wanted.quality,
    });
    if (blob.type !== wanted.type) {
      throw new Error("this browser cannot write WebP pictures");
    }
    control.progress(1);
    return { type: "done", blob, extension: "webp", ...size };
  } finally {
    picture.close();
  }
}

/** `createImageBitmap`'s options for a purpose: the file's own
 *  orientation always (three.js's loader keeps the browser's default,
 *  which applies it); for a texture also its raw colours and alpha. */
function decodeOptions(purpose: PicturePurpose): ImageBitmapOptions {
  return purpose === "texture"
    ? {
        imageOrientation: "from-image",
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      }
    : { imageOrientation: "from-image" };
}

/** The real device: `createImageBitmap` (the photo's orientation applied,
 *  resized with high quality) and an `OffscreenCanvas`, both available in
 *  a Worker. Not unit-tested (it needs a browser); the e2e runs it. */
export const PICTURE_DEVICE: PictureDevice<
  DecodedPicture & {
    readonly bitmap: ImageBitmap;
    readonly purpose: PicturePurpose;
  }
> = {
  async decode(source, purpose = "photo") {
    const bitmap = await createImageBitmap(source, decodeOptions(purpose));
    return {
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
      bitmap,
      purpose,
    };
  },
  async encode({ bitmap, purpose }, width, height, { type, quality }) {
    const resized =
      width === bitmap.width && height === bitmap.height
        ? null
        : await createImageBitmap(bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "high",
            // A texture keeps its straight alpha through the resize. Only
            // for a texture: on a photo this option made Chromium's resize
            // visibly worse (lower similarity, larger files).
            ...(purpose === "texture"
              ? { premultiplyAlpha: "none" as const }
              : {}),
          });
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2D canvas in this browser");
      context.drawImage(resized ?? bitmap, 0, 0);
      return await canvas.convertToBlob({ type, quality });
    } finally {
      resized?.close();
    }
  },
};
