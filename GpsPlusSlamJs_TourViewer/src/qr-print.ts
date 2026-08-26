/**
 * The creator's "Print a code" step (owner-requested 2026-08-26, extending
 * the QR-pose plan's M5 prep): paste the tour's hosting URL, pick the
 * `&c=` code number and the printed size, and get a QR rendered at the TRUE
 * physical size — print CSS centimetre units are exact at 100% scale, which
 * removes the field test's flakiest manual step (a generic generator's
 * unknown print scale vs the size the author types when minting).
 *
 * The launch URL comes from the framework's MEASURED builder
 * (`buildQrLaunchUrl`): every candidate form is costed by the oracle-locked
 * size estimator with the `&c=` suffix INSIDE the estimate, so the printed
 * string is guaranteed to fit a scannable QR (≤ v25 at EC Q).
 *
 * SIZE CONTRACT (the number the author later types into the mint panel):
 * the printed side length is the QR SYMBOL — the dark module area WITHOUT
 * the quiet zone. The detector's corners outline the symbol, and the PnP
 * solve scales by it. The renderer therefore draws the canvas with margin
 * 0 and the page adds the mandatory quiet zone as CSS padding around it.
 */

import { buildQrLaunchUrl } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-url";

/** The deployed viewer the printed codes launch. */
export const PRINT_BASE_URL = "https://gps.csutil.com/tour/";

export interface QrPrintPlan {
  /** The full printable launch URL (the QR's payload). */
  url: string;
  /** The measured QR version (≤ 25 by the builder's guarantee). */
  qrVersion: number;
}

export async function planPrintCode(
  dataUrl: string,
  c: string,
): Promise<QrPrintPlan> {
  const plan = await buildQrLaunchUrl(PRINT_BASE_URL, dataUrl, {
    extraQuery: { c },
  });
  return { url: plan.url, qrVersion: plan.estimate.version };
}

/** Metres → exact CSS centimetres for the print stylesheet. */
export function printedSideCss(sizeM: number): string {
  if (!Number.isFinite(sizeM) || sizeM <= 0) {
    throw new RangeError(
      `printed size must be a positive number of metres, got ${String(sizeM)}`,
    );
  }
  // Round to 0.1 mm — beyond print-registration accuracy either way.
  const cm = Math.round(sizeM * 1000) / 10;
  return `${String(cm)}cm`;
}
