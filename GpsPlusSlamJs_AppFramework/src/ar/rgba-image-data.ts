/**
 * The one "adopt or copy" rule for wrapping an RGBA frame in `ImageData`.
 * See rgba-image-data.ts.md.
 */

/** Pixels of a frame: top-left-origin RGBA, `width * height * 4` bytes. */
export interface RgbaPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Wrap `frame` in `ImageData`, adopting its array when possible (no copy) and
 * copying only when `ImageData` cannot take it - a view over shared memory.
 * Frames from `captureToRgba` are plain-ArrayBuffer-backed owned copies, so
 * they are always adopted. The caller must not mutate the array afterwards.
 */
export function rgbaToImageData(frame: RgbaPixels): ImageData {
  const { data, width, height } = frame;
  const pixels =
    data.buffer instanceof ArrayBuffer
      ? (data as Uint8ClampedArray<ArrayBuffer>)
      : new Uint8ClampedArray(data);
  return new ImageData(pixels, width, height);
}
