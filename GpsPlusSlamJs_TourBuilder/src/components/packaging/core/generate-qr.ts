/**
 * `generateQr` — render a viewing-mode tour URL as a scannable SVG QR code
 * (Component 5).
 *
 * This is the authoring→visitor hand-off: the author uploads `tour.zip`, pastes
 * its URL, and prints or shows the resulting code. The wrapper deliberately does
 * no URL work — `buildTourUrl` owns that — so the string handed to the encoder
 * is exactly the string that was scanned.
 *
 * @see plans/2026-07-14-packaging-plan.md (decision 7)
 */

import QRCode, { type QRCodeToStringOptions } from "qrcode";

/**
 * Pinned here rather than accepted from the caller: these trade off against each
 * other and the right balance depends on the payload, which is always the same
 * shape (a long `?tour=<presigned url>` link).
 *
 * `errorCorrectionLevel: "M"` (~15% recovery) — a presigned URL already pushes
 * the symbol to a high version, and "Q"/"H" would add modules to a code that is
 * dense enough to strain a phone camera. Print-on-a-weathered-sign would justify
 * "H"; a screen or a fresh printout does not.
 */
export const QR_OPTIONS: QRCodeToStringOptions = {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2, // quiet zone; scanners need it to find the symbol
  width: 512, // scans from ~30 cm on a phone
};

/**
 * Encode `tourUrl` as an SVG QR code.
 *
 * @param tourUrl the finished viewing URL — build it with `buildTourUrl`.
 * @returns the SVG markup as a string (render it with `view/qr-view.ts`).
 * @throws whatever the encoder throws (e.g. a payload too long to encode) —
 * never a blank SVG, which could be printed without anyone noticing.
 */
export function generateQr(tourUrl: string): Promise<string> {
  return QRCode.toString(tourUrl, QR_OPTIONS);
}
