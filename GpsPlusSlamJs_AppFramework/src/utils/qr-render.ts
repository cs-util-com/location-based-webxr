/**
 * `generateQr` — render an arbitrary URL as a scannable SVG QR code, and
 * `renderQrSvg` — the one DOM side effect that puts it on the page.
 *
 * This is deliberately unrelated to `qr-payload/` (which only shrinks a URL's
 * *text* for a denser scan): something still has to turn the resulting string
 * into an actual QR image, and nothing upstream did that.
 */

import QRCode, { type QRCodeToStringOptions } from 'qrcode';

/**
 * Pinned here rather than accepted from the caller: these trade off against
 * each other and the right balance depends on the payload, which is always
 * the same shape (a long URL, typically carrying a presigned link).
 *
 * `errorCorrectionLevel: 'M'` (~15% recovery) — a presigned URL already
 * pushes the symbol to a high version, and 'Q'/'H' would add modules to a
 * code that is dense enough to strain a phone camera. Print-on-a-weathered
 * -sign would justify 'H'; a screen or a fresh printout does not.
 */
export const QR_OPTIONS: QRCodeToStringOptions = {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 2, // quiet zone; scanners need it to find the symbol
  width: 512, // scans from ~30 cm on a phone
};

/**
 * Encode `url` as an SVG QR code.
 *
 * @returns the SVG markup as a string (render it with {@link renderQrSvg}).
 * @throws whatever the encoder throws (e.g. a payload too long to encode) —
 * never a blank SVG, which could be printed without anyone noticing.
 */
export function generateQr(url: string): Promise<string> {
  return QRCode.toString(url, QR_OPTIONS);
}

/**
 * Render `svg` inside `host`, replacing whatever was there.
 *
 * `innerHTML` is safe here specifically because the markup is produced
 * locally by {@link generateQr} from a URL string — it is never author- or
 * network-supplied HTML.
 */
export function renderQrSvg(host: HTMLElement, svg: string): void {
  host.innerHTML = svg;
}
