/**
 * `rasterizeQrSvg` — turn the QR SVG markup `core/generate-qr.ts` produced
 * into a PNG or JPEG `Blob`, so the author can save/share it as an image
 * instead of only printing the SVG-filled `.qr-host`.
 *
 * canvas/`Image` are DOM APIs, so this stays in `view/`, not `core/` — the
 * pixel pattern is still entirely `generateQr`'s job; this only rasterizes
 * the markup it already produced.
 */

export type QrImageFormat = "png" | "jpeg";

/**
 * Export resolution — well above the 512px the on-screen SVG renders at, so
 * a saved file or a print doesn't look soft next to the crisp on-screen code.
 */
const EXPORT_SIZE = 1024;

/** JPEG has no lossless setting; 0.92 keeps QR module edges clean at this
 * export size without the file size of a near-1.0 quality. */
const JPEG_QUALITY = 0.92;

const MIME: Record<QrImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

/**
 * @param svg the markup from `generateQr` (already carries a white
 *   background rect, so JPEG's lack of transparency support is a non-issue —
 *   the explicit fill below is only a guard against that assumption changing).
 * @param format "png" for a lossless, crisper code; "jpeg" for a smaller file.
 * @returns a `Blob` ready for `downloadBlob`/`shareOrDownloadBlob`.
 * @throws if the browser can't decode the SVG or encode the canvas.
 */
export async function rasterizeQrSvg(
  svg: string,
  format: QrImageFormat,
): Promise<Blob> {
  const svgUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
    context.drawImage(image, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
    return await canvasToBlob(canvas, format);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the QR code"));
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: QrImageFormat,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the QR image"));
      },
      MIME[format],
      format === "jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}
