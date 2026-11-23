/**
 * The benchmark's canvas helpers: a video frame as a Frame, a Frame on a
 * canvas, a Frame as a plain PNG and a stored PNG back as a Frame. Shared
 * by the photo test and the flat target capture.
 *
 * @see bench-dom.ts.md
 */
import { assertPlainPng } from "./bench-export";
import { fitInside, makeFrame, type Frame } from "./bench-image";

/** The current video frame, shrunk to at most `maxLongEdge` on its long side. */
export function captureFrame(
  video: HTMLVideoElement,
  maxLongEdge: number,
): Frame {
  const size = fitInside(
    video.videoWidth,
    video.videoHeight,
    maxLongEdge,
    maxLongEdge,
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("camera: no 2D canvas");
  }
  ctx.drawImage(video, 0, 0, size.width, size.height);
  const img = ctx.getImageData(0, 0, size.width, size.height);
  return makeFrame(size.width, size.height, img.data);
}

/** The frame's pixels drawn onto `canvas` (a new one when none is given). */
export function frameCanvas(
  f: Frame,
  canvas: HTMLCanvasElement = document.createElement("canvas"),
): HTMLCanvasElement {
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("no 2D canvas");
  }
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height),
    0,
    0,
  );
  return canvas;
}

/**
 * A frame as PNG bytes: the canvas encoder writes pixels only (no EXIF,
 * text or time), and assertPlainPng refuses the file if that ever changes.
 */
export async function framePng(f: Frame, label: string): Promise<Blob> {
  const canvas = frameCanvas(f);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    throw new Error(`${label}: PNG encoding failed`);
  }
  assertPlainPng(new Uint8Array(await blob.arrayBuffer()), label);
  return blob;
}

/**
 * A stored image (a photo's PNG) decoded back into a Frame, pixel for
 * pixel: no colour space conversion and no premultiplied alpha, so a PNG
 * of `framePng` gives back the frame it was made from.
 */
export async function blobFrame(blob: Blob): Promise<Frame> {
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
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
