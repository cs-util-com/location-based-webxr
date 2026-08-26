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

import { DEFAULT_CODE_DISCRIMINATOR } from "./code-param";

/**
 * The BARE host, not `/tour/` (ZD-9, and the PR #364 review caught the two
 * contradicting each other in one PR): the landing page owns `/` and
 * forwards any `?qr=` launch untouched to the viewer, precisely so printed
 * codes never spend payload bits on a path — a path in the printed base
 * would forfeit the densest QR encodings forever.
 */
export const PRINT_BASE_URL = "https://gps.csutil.com/";

/**
 * Printable-width budget (m) for a home printer: ~19 cm of printable width
 * on A4/Letter with default margins, divided by 1.16 (the 8% quiet zone on
 * each side). At the mandated 100% scale a larger symbol is CLIPPED — and a
 * clipped QR does not decode at all. Larger prints stay allowed (print
 * shops, tiling) but the panel warns in plain words.
 */
export const MAX_HOME_PRINTABLE_SIDE_M = 0.19 / 1.16;

/** A plain-words warning when `sizeM` will not fit a home printer's page,
 *  or `null` when it fits. */
export function homePrintWarning(sizeM: number): string | null {
  if (sizeM <= MAX_HOME_PRINTABLE_SIDE_M) return null;
  return (
    `Warning: ${printedSideCss(sizeM)} plus the quiet zone is wider than an ` +
    `A4/Letter page — at 100% scale the code would be cut off and will not ` +
    `scan. Use ${printedSideCss(Math.floor(MAX_HOME_PRINTABLE_SIDE_M * 1000) / 1000)} ` +
    `or less, or print on a larger sheet.`
  );
}

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
  // `&c=` is omitted when it equals the default: both readers fall back to
  // "1" when the parameter is absent, so printing it spends 4 bytes of a
  // payload the builder costs bit-by-bit — and any non-empty suffix
  // disqualifies the densest path-form candidates (PR #364 review).
  const plan = await buildQrLaunchUrl(
    PRINT_BASE_URL,
    dataUrl,
    c === DEFAULT_CODE_DISCRIMINATOR ? {} : { extraQuery: { c } },
  );
  return { url: plan.url, qrVersion: plan.estimate.version };
}

/** Metres → exact CSS centimetres for the print stylesheet. */
export function printedSideCss(sizeM: number): string {
  if (!Number.isFinite(sizeM) || sizeM <= 0) {
    throw new RangeError(
      `printed size must be a positive number of metres, got ${String(sizeM)}`,
    );
  }
  // Round to 0.1 mm — beyond print-registration accuracy either way. The
  // first cut rounded to a full millimetre while claiming 0.1 mm (PR #363
  // review): inert for step-aligned inputs, but a hand-typed off-step size
  // (the input's `step` only gates the spinner) would print ~0.3 % off the
  // sizeM the PnP solve assumes — a depth bias on the least-constrained axis.
  const cm = Math.round(sizeM * 10000) / 100;
  return `${String(cm)}cm`;
}
