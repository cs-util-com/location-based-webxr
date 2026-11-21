/**
 * What a finished stretch keeps of its last look at the model: a small
 * picture for its tile, and an encoded copy at the loupe's size that the
 * loupe decodes when it opens. A raw picture at the trainer's photo size
 * holds several MB until it is closed, so the full-size look is let go
 * once these are made. The browser's resize and encode come in, so the
 * sizes are testable without a canvas.
 *
 * @see kept-look.ts.md
 */

/** Longest side of the tile's picture (px): the tile canvas is 480 wide. */
export const TILE_LOOK_PX = 480;

/** Longest side of the loupe's copy (px): the loupe canvas is 1200 wide. */
export const LOUPE_LOOK_PX = 1200;

/** What a finished stretch keeps of its look. */
export interface KeptLook {
  /** The tile's picture: the look itself when it is small already. */
  readonly small: CanvasImageSource;
  /** The look encoded at up to {@link LOUPE_LOOK_PX}, for the loupe;
   *  null when the small picture is all there is, or it could not be
   *  encoded. */
  readonly sharp: Blob | null;
}

/** How the browser makes the two copies. */
export interface LookTools {
  /** A picture of `picture` at `width` x `height`. */
  shrink(
    picture: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<CanvasImageSource>;
  /** `picture` drawn at `width` x `height` and encoded as an image file. */
  encode(
    picture: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<Blob>;
}

/**
 * The size of a `width` x `height` picture scaled to `maxPx` on its longer
 * side, the aspect kept and each side at least 1 px; null when it is no
 * larger than that already (a picture is never enlarged). Throws a
 * RangeError for sizes or a limit that are not positive finite numbers.
 */
export function fitWithin(
  width: number,
  height: number,
  maxPx: number,
): { readonly width: number; readonly height: number } | null {
  for (const [name, v] of [
    ["width", width],
    ["height", height],
    ["maxPx", maxPx],
  ] as const) {
    if (!(Number.isFinite(v) && v > 0)) {
      throw new RangeError(
        `${name} must be a positive number, got ${String(v)}`,
      );
    }
  }
  const longest = Math.max(width, height);
  if (longest <= maxPx) return null;
  const scale = maxPx / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The pixel size of `picture`, or null when it has none to read. */
function sizeOf(
  picture: CanvasImageSource,
): { readonly width: number; readonly height: number } | null {
  const { width, height } = picture as { width?: unknown; height?: unknown };
  return typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

/**
 * Makes what a finished stretch keeps of `picture`. A picture of no
 * readable size, or no larger than {@link TILE_LOOK_PX}, is kept as it is
 * with no sharp copy. Otherwise the small picture is shrunk to
 * {@link TILE_LOOK_PX} and the sharp copy encoded at up to
 * {@link LOUPE_LOOK_PX}; a copy that cannot be encoded leaves `sharp`
 * null, a picture that cannot be shrunk rejects. `picture` itself is
 * never closed here.
 */
export function lookKeeper(
  tools: LookTools,
): (picture: CanvasImageSource) => Promise<KeptLook> {
  return async (picture) => {
    const size = sizeOf(picture);
    const tile =
      size === null ? null : fitWithin(size.width, size.height, TILE_LOOK_PX);
    if (size === null || tile === null) return { small: picture, sharp: null };
    const loupe = fitWithin(size.width, size.height, LOUPE_LOOK_PX) ?? size;
    const [small, sharp] = await Promise.all([
      tools.shrink(picture, tile.width, tile.height),
      tools
        .encode(picture, loupe.width, loupe.height)
        .catch((): Blob | null => null),
    ]);
    return { small, sharp };
  };
}

/** JPEG quality of the loupe's copy: about 0.2 MB at 1200 x 900. */
const LOUPE_JPEG_QUALITY = 0.9;

/** The page's tools: `createImageBitmap` for the small picture, an
 *  `OffscreenCanvas` for the loupe's copy. */
export const browserLookTools: LookTools = {
  shrink: (picture, width, height) =>
    createImageBitmap(picture, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "medium",
    }),
  encode: async (picture, width, height) => {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext("2d");
    if (g === null) throw new Error("no 2D canvas");
    g.drawImage(picture, 0, 0, width, height);
    return canvas.convertToBlob({
      type: "image/jpeg",
      quality: LOUPE_JPEG_QUALITY,
    });
  },
};

/** Lets go of a picture: an ImageBitmap holds its pixels until it is
 *  closed. Anything without `close`, or a close that throws, is left to
 *  the garbage collector. */
export function closePicture(picture: CanvasImageSource | undefined): void {
  const close = (picture as { close?: unknown } | undefined)?.close;
  if (typeof close === "function") {
    try {
      (close as () => void).call(picture);
    } catch {
      // A picture that cannot be closed is left to the garbage collector.
    }
  }
}
